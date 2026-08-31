// Unit tests for the app's pure functions. index.html is one classic <script>,
// so its top-level `function` declarations land on window — testable via
// page.evaluate with zero refactoring. (`const` arrows like fmtRain are not on
// window; those are covered through UI text in flows.spec.js.)
const { test, expect } = require('@playwright/test');
const { mockServices } = require('./mock');

test.beforeEach(async ({ page }) => {
  await mockServices(page);
  await page.goto('/');
  await page.waitForFunction(() => typeof window.parseHash === 'function');
});

// replaceState changes the hash without firing hashchange, so parseHash can be
// pointed at a fragment without triggering a delineation
const parseWith = (page, hash) => page.evaluate(h => {
  history.replaceState(null, '', h);
  return parseHash();
}, hash);

test('parseHash: valid link, name keeps its commas', async ({ page }) => {
  expect(await parseWith(page, '#37.1,-112.2,My Spot')).toEqual({ lat: 37.1, lon: -112.2, name: 'My Spot' });
  expect(await parseWith(page, '#37,-112,a,b,c')).toEqual({ lat: 37, lon: -112, name: 'a,b,c' });
  expect(await parseWith(page, '#37,-112')).toEqual({ lat: 37, lon: -112 });
});

test('parseHash: rejects blanks (Number("") is 0 — the Null Island bug), NaN, out of range', async ({ page }) => {
  for (const h of ['#,-112', '#37,', '#,', '#abc,-112', '#91,0', '#-91,0', '#0,181', '#0,-181', '#']) {
    expect(await parseWith(page, h), h).toBeNull();
  }
});

test('parseHash: UTM, with and without a zone, either field order', async ({ page }) => {
  // the app's default map centre is Zion → zone 12 when the paste omits it
  const want = { lat: 37.23709, lon: -112.94958 };
  for (const h of ['#327065mE 4122955mN', '#327065mE, 4122955mN', '#4122955mN 327065mE',
                   '#12 327065mE 4122955mN', '#12S 327065 4122955', '#327065 4122955']) {
    const got = await parseWith(page, h);
    expect({ lat: got.lat, lon: got.lon }, h).toEqual(want);
  }
  expect((await parseWith(page, '#327065mE 4122955mN')).note).toContain('zone 12, WGS84');
  expect((await parseWith(page, '#327065mE 4122955mN')).note).toContain('assumed from the map view');
  expect((await parseWith(page, '#12S 327065 4122955')).note).not.toContain('assumed');
  expect(await parseWith(page, '#12 327065mE 4122955mN,Pine Creek')).toMatchObject({ name: 'Pine Creek' });
  // invariants of the projection itself, independent of any reference point
  expect(await page.evaluate(() => utmToLatLon(31, 500000, 0))).toEqual([0, 3]);
  // on the central meridian the northing is purely the meridian arc, so the latitude can be
  // checked against a numerically integrated arc — an independent route to the same number
  // (37.2531434756, agreeing to ~0.1 mm) rather than a value copied out of this code
  const [lat] = await page.evaluate(() => utmToLatLon(12, 500000, 4122955));
  expect(lat).toBeCloseTo(37.2531435, 6);
  // southern latitude bands are refused, not silently flipped into the wrong hemisphere
  expect(await parseWith(page, '#12H 327065 4122955')).toBeNull();
});

test('parseHash: a malformed percent-escape (a link truncated by a messaging app) reads as invalid, not a crash', async ({ page }) => {
  expect(await parseWith(page, '#37.2,-112.9,100%')).toBeNull();
});

test('fetchRetry: a 4xx is not retried', async ({ page }) => {
  let hits = 0;
  await page.route('https://mock.test/**', r => { hits++; r.fulfill({ status: 404, body: '' }); });
  const msg = await page.evaluate(() => fetchRetry('https://mock.test/x').then(() => 'ok', e => e.message));
  expect(msg).toContain('HTTP 404');
  expect(hits).toBe(1);
});

test('parsePinsHash: per-field decoding, bad entries dropped, no dedupe (that is freshPins’ job)', async ({ page }) => {
  const parse = h => page.evaluate(x => { history.replaceState(null, '', x); return parsePinsHash(); }, h);
  // encoded ; and , inside a name must not split fields
  expect(await parse('#pins:37,-112,Bad%3B%20Canyon%2C%20Upper;38,-113')).toEqual([
    { lat: 37, lon: -112, name: 'Bad; Canyon, Upper' }, { lat: 38, lon: -113 },
  ]);
  // duplicates survive the parser; junk chunks and blank fields are dropped, not fatal
  expect(await parse('#pins:37,-112,A;37,-112,A;xx,yy;,;39,-110')).toEqual([
    { lat: 37, lon: -112, name: 'A' }, { lat: 37, lon: -112, name: 'A' }, { lat: 39, lon: -110 },
  ]);
  // a broken percent-escape in a NAME loses the name, not the pin
  expect(await parse('#pins:37,-112,100%')).toEqual([{ lat: 37, lon: -112 }]);
  expect(await parse('#37,-112')).toBeNull();
});

test('freshPins: dedupes against storage and itself; local pin wins on a coordinate collision', async ({ page }) => {
  const out = await page.evaluate(() => {
    lsSet('pins', [{ lat: 37.2, lon: -112.9, name: 'Mine' }]);
    return freshPins([
      { lat: 37.2, lon: -112.9, name: 'Theirs' },   // collision — dropped, local name survives
      { lat: 38, lon: -109, name: 'New' },
      { lat: 38, lon: -109, name: 'New again' },    // repeat within the link — counted once
    ]);
  });
  expect(out).toEqual([{ lat: 38, lon: -109, name: 'New' }]);
});

test('durationHours: NWS ISO durations', async ({ page }) => {
  const d = s => page.evaluate(x => durationHours(x), s);
  expect(await d('PT1H')).toBe(1);
  expect(await d('PT6H')).toBe(6);
  expect(await d('P1D')).toBe(24);
  expect(await d('P1DT6H')).toBe(30);
  expect(await d('PT30M')).toBe(1);   // sub-hour floors to 1 — documented behavior
  expect(await d(undefined)).toBe(1);
});

test('sampleHourly: spreads accumulations, keeps null as unknown, clips before t0', async ({ page }) => {
  const t0 = Date.UTC(2026, 0, 1, 0);
  const run = (values, hours, spread) =>
    page.evaluate(([v, t, h, s]) => sampleHourly(v, t, h, s), [values, t0, hours, spread]);
  // QPF: 6 mm over PT3H → 2 mm in each of 3 hours; the rest stays null, not 0
  expect(await run([{ validTime: '2026-01-01T00:00:00+00:00/PT3H', value: 6 }], 6, true))
    .toEqual([2, 2, 2, null, null, null]);
  // instantaneous series are not divided
  expect(await run([{ validTime: '2026-01-01T02:00:00+00:00/PT2H', value: 50 }], 4, false))
    .toEqual([null, null, 50, 50]);
  // null value means unknown — never written into the axis
  expect(await run([{ validTime: '2026-01-01T00:00:00+00:00/PT6H', value: null }], 3, true))
    .toEqual([null, null, null]);
  // an interval straddling t0 contributes only its in-window hours
  expect(await run([{ validTime: '2025-12-31T22:00:00+00:00/PT4H', value: 8 }], 4, true))
    .toEqual([2, 2, null, null]);
});

test('fmtHour / compass', async ({ page }) => {
  // 19:00 UTC on 2026-01-15 = 12pm in Denver (MST)
  const t = Date.UTC(2026, 0, 15, 19);
  expect(await page.evaluate(x => fmtHour(x, 'America/Denver'), t)).toBe('12pm');
  expect(await page.evaluate(x => fmtHour(x, 'America/Denver', true), t)).toBe('Thu 12pm');
  expect(await page.evaluate(() => [0, 90, 225, -45].map(compass))).toEqual(['N', 'E', 'SW', 'NW']);
});

test('countEvent: only the fixed vocabulary ever leaves, and never a coordinate', async ({ page }) => {
  const sent = await page.evaluate(() => {
    const out = [];
    window.Image = class { set src(v) { out.push(v); } };
    for (const name of [
      'delineate-UT', 'delineate-unknownstate', 'export-geojson', 'export-kml',
      'share', 'pin', 'locked', 'open', 'feedback-up', 'feedback-down',   // the whole allowed vocabulary
      'delineate-37.2,-112.9', 'delineate-utah', 'lookup', '', // must all be dropped
    ]) countEvent(name);
    return out;
  });
  expect(sent).toHaveLength(10);
  expect(sent[0]).toMatch(/^https:\/\/drainage\.goatcounter\.com\/count\?p=delineate-UT&e=true&rnd=/);
  // strip the random cache-buster first: it is random, and a 37 landing in it used to fail
  // this ~1 run in 8 — the promise under test is about the event NAME, not that noise
  for (const u of sent) expect(u.replace(/&rnd=.*/, '')).not.toMatch(/37|112/);
});

test('countEvent: the analytics-off choice sends nothing', async ({ page }) => {
  const sent = await page.evaluate(() => {
    const out = [];
    window.Image = class { set src(v) { out.push(v); } };
    lsSet('analytics', false);
    countEvent('share');
    return out;
  });
  expect(sent).toHaveLength(0);
});
