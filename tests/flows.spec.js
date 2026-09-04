// End-to-end flows against a fully mocked network (see mock.js). Each test
// guards either a documented past bug (HANDOFF.md) or a promise the UI makes.
const { test, expect } = require('@playwright/test');
const { mockServices } = require('./mock');

const HASH = '#37.2,-112.9';
const doneStatus = page => expect(page.locator('#status')).toHaveText(/^Done\./, { timeout: 15000 });

test('NLDI fallback path: basin renders with the reach caveat, no false warnings', async ({ page }) => {
  await mockServices(page, { streamstats: 'decline' });
  await page.goto('/' + HASH + ',Test Spot');
  await expect(page.locator('#status')).toHaveText(/^Done\. Drainage of the stream segment/, { timeout: 15000 });
  await expect(page.locator('#basin-info')).toContainText('mi²');
  await expect(page.locator('#basin-info .warn')).toHaveCount(0);   // tap is inside, snap is 66 m, area is big
  await expect(page.locator('#title')).toHaveText('Drainage — Test Spot');
  for (const id of ['btn-geojson', 'btn-kml', 'btn-share', 'btn-pin']) {
    await expect(page.locator('#' + id)).toBeEnabled();
  }
});

test('StreamStats exact path wins and says so', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.goto('/' + HASH);
  await expect(page.locator('#status')).toHaveText(/^Done\. Exact drainage/, { timeout: 15000 });
  const title = await page.locator('#basin-info div').first().getAttribute('title');
  expect(title).toContain('exact');
});

test('forecast: hourly max renders with peak line in the basin’s timezone units', async ({ page }) => {
  await mockServices(page);
  await page.goto('/' + HASH);
  await doneStatus(page);
  // 12.7 mm over 6 h → 0.08 in/hr; 60% chance envelope
  await expect(page.locator('#forecast')).toContainText('Peak rain: 0.08 in/hr', { timeout: 15000 });
  await expect(page.locator('#forecast')).toContainText('60% chance');
  await expect(page.locator('#forecast svg')).toBeVisible();
});

test('units toggle converts area and rain without a re-delineation', async ({ page }) => {
  const { requests } = await mockServices(page);
  await page.goto('/' + HASH);
  await doneStatus(page);
  await expect(page.locator('#forecast')).toContainText('Peak rain', { timeout: 15000 });
  const before = requests.filter(r => r.url.includes('linked-data')).length;
  await page.locator('#chk-metric').check();
  await expect(page.locator('#basin-info')).toContainText('km²');
  await expect(page.locator('#forecast')).toContainText('mm/hr');
  expect(requests.filter(r => r.url.includes('linked-data')).length).toBe(before);
});

test('zone-based alert with null geometry is resolved and shown — the silent-all-clear trap', async ({ page }) => {
  await mockServices(page, { alerts: 'zone' });
  await page.goto('/' + HASH);
  await doneStatus(page);
  const item = page.locator('.alert-item');
  await expect(item).toHaveCount(1, { timeout: 15000 });
  await expect(item).toContainText('Flood Watch (Severe)');
  // when a real alert shows, the "no alerts ≠ safe" footer line hides
  await expect(page.locator('#no-alerts-note')).toBeHidden();
});

test('each alert offers its full CAP text in a <details> expander', async ({ page }) => {
  // regression: an accidental line-join once put the append calls behind an
  // inline // comment, and the expander silently vanished from the page
  await mockServices(page, { alerts: 'zone' });
  await page.goto('/' + HASH);
  await doneStatus(page);
  const det = page.locator('.alert-item details');
  await expect(det).toContainText('Full alert text', { timeout: 15000 });
  await expect(det).toContainText('Heavy rain expected.');
});

test('no alerts says "not the same as safe"; alert-check failure says UNKNOWN, never all-clear', async ({ page }) => {
  const { opts } = await mockServices(page, { alerts: 'none' });
  await page.goto('/' + HASH);
  await doneStatus(page);
  await expect(page.locator('#alerts')).toContainText('No active alerts touch this drainage (UT). Not the same as safe.', { timeout: 15000 });
  await expect(page.locator('#no-alerts-note')).toBeVisible();

  opts.alerts = 'fail';
  await page.locator('#alerts button[title="Re-check alerts"]').click();
  await expect(page.locator('#alerts')).toContainText('ALERTS UNKNOWN', { timeout: 15000 });
  await expect(page.locator('#no-alerts-note')).toBeVisible();
});

test('counting: exactly ONE delineate event per tap, no coordinates on the wire', async ({ page }) => {
  // the historical double-count: NLDI and StreamStats both call renderBasin for
  // the same tap, so run the scenario where both succeed
  await page.addInitScript(() => {
    window.__gc = [];
    window.Image = class { set src(v) { window.__gc.push(v); } };
  });
  await mockServices(page, { streamstats: 'exact' });
  await page.goto('/' + HASH);
  await doneStatus(page);
  await expect.poll(() => page.evaluate(() => window.__gc.length), { timeout: 5000 }).toBe(1);
  await page.waitForTimeout(750);   // give a late second event time to appear
  const sent = await page.evaluate(() => window.__gc);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatch(/goatcounter\.com\/count\?p=delineate-UT&e=true/);
  expect(sent[0]).not.toMatch(/37\.2|112\.9/);
});

// The offer is IN THE PAGE, never a dialog: a PWA/webview suppresses confirm() and the
// import would evaporate with no trace. `page.on('dialog')` asserts none is used.
test('multi-pin import: the offer names only new pins; Add saves and the first is already delineated', async ({ page }) => {
  await mockServices(page);
  await page.addInitScript(() => {
    localStorage.setItem('drainage:pins', JSON.stringify([{ lat: 38, lon: -109, name: 'Already' }]));
  });
  let dialogs = 0;
  page.on('dialog', d => { dialogs++; d.accept(); });
  await page.goto('/#pins:37.2,-112.9,First;38,-109,Already;39.5,-110.5,Third');
  await doneStatus(page);
  const offer = page.locator('#ask');
  await expect(offer).toContainText('This link has 2 new pins');
  await expect(offer).toContainText('First');
  await expect(offer).not.toContainText('Already,');   // the dup is counted, not listed
  await expect(offer).toContainText('1 was already saved.');
  expect(page.url()).toContain('#37.2,-112.9,First');   // rewritten to the single-pin form
  await offer.getByRole('button', { name: 'Add 2 pins' }).click();
  await expect(offer).toHaveText('Added 2 pins from this link. 1 was already saved.');
  const pins = await page.evaluate(() => JSON.parse(localStorage.getItem('drainage:pins')));
  expect(pins).toHaveLength(3);
  expect(dialogs).toBe(0);
});

test('multi-pin import: No thanks writes nothing but still shows the first drainage', async ({ page }) => {
  await mockServices(page);
  await page.goto('/#pins:37.2,-112.9,First;39.5,-110.5,Third');
  await doneStatus(page);
  await page.locator('#ask').getByRole('button', { name: 'No thanks' }).click();
  await expect(page.locator('#ask')).toHaveText('Pins from this link were not added.');
  expect(await page.evaluate(() => localStorage.getItem('drainage:pins'))).toBeNull();
});

test('multi-pin import: nothing is written before the reader answers', async ({ page }) => {
  await mockServices(page);
  await page.goto('/#pins:37.2,-112.9,First');
  await doneStatus(page);
  await expect(page.locator('#ask')).toContainText('This link has 1 new pin');
  expect(await page.evaluate(() => localStorage.getItem('drainage:pins'))).toBeNull();
});

test('multi-pin import: all duplicates → nothing to ask', async ({ page }) => {
  await mockServices(page);
  await page.addInitScript(() => {
    localStorage.setItem('drainage:pins', JSON.stringify([{ lat: 37.2, lon: -112.9, name: 'Mine' }]));
  });
  await page.goto('/#pins:37.2,-112.9,Theirs');
  await doneStatus(page);
  await expect(page.locator('#ask')).toHaveText('Every pin in this link was already saved.');
  await expect(page.locator('#ask button')).toHaveCount(0);
  const pins = await page.evaluate(() => JSON.parse(localStorage.getItem('drainage:pins')));
  expect(pins).toEqual([{ lat: 37.2, lon: -112.9, name: 'Mine' }]);   // local name survived
});

// The PWA has no address bar, so the paste box is the only way in for a link on a phone.
test('paste box: a whole multi-pin link goes through the same import prompt', async ({ page }) => {
  await mockServices(page);
  let dialogMsg = '';
  page.on('dialog', d => { dialogMsg = d.message(); d.accept(); });
  await page.goto('/');
  await page.fill('#paste-in', 'https://example.com/drainage/#pins:37.2,-112.9,First;39.5,-110.5,Third');
  await page.click('#btn-paste');
  await doneStatus(page);
  expect(dialogMsg).toBe('');   // no modal: this is the PWA case, where they are suppressed
  const offer = page.locator('#ask');
  await expect(offer).toContainText('This link has 2 new pins');
  await offer.getByRole('button', { name: 'Add 2 pins' }).click();
  await expect(offer).toHaveText('Added 2 pins from this link.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drainage:pins')))).toHaveLength(2);
  expect(page.url()).toContain('#37.2,-112.9,First');
  await expect(page.locator('#paste-in')).toHaveValue('');
});

test('paste box: a DMS coordinate delineates and the URL is rewritten to decimal', async ({ page }) => {
  await mockServices(page);
  await page.goto('/');
  await page.fill('#paste-in', `37°12'00"N 112°54'00"W, Pine Creek`);
  await page.press('#paste-in', 'Enter');
  await doneStatus(page);
  expect(page.url()).toContain('#37.2,-112.9,Pine%20Creek');
  await expect(page.locator('#title')).toHaveText('Drainage — Pine Creek');
});

test('paste box: junk is refused, leaving the URL and the text alone', async ({ page }) => {
  await mockServices(page);
  await page.goto('/');
  await page.fill('#paste-in', 'somewhere near the big rock');
  await page.click('#btn-paste');
  await expect(page.locator('#paste-note')).toHaveClass('warn');
  await expect(page.locator('#paste-note')).toContainText('Not a coordinate');
  expect(page.url()).not.toContain('#');
  await expect(page.locator('#paste-in')).toHaveValue('somewhere near the big rock');
});

test('invalid share link shows the error, not silence', async ({ page }) => {
  await mockServices(page);
  await page.goto('/#garbage');
  await expect(page.locator('#status')).toHaveText('Invalid share link — expected #lat,lon,name, in decimal degrees.');
  await expect(page.locator('#status')).toHaveClass('err');
});

test('a link with a broken percent-escape shows the invalid-link error instead of throwing', async ({ page }) => {
  await mockServices(page);
  await page.goto('/#37.2,-112.9,100%');
  await expect(page.locator('#status')).toHaveText('Invalid share link — expected #lat,lon,name, in decimal degrees.');
  await expect(page.locator('#status')).toHaveClass('err');
});

test('a zone that arrives without geometry is not cached to disk', async ({ page }) => {
  // a transient wobble persisted as "no geometry" would silently exclude the
  // zone from every future alert check on this device — the false-all-clear trap
  await mockServices(page, { alerts: 'zone', zone: 'missing' });
  await page.goto('/' + HASH);
  await doneStatus(page);
  await expect(page.locator('#alerts')).toContainText('No active alerts', { timeout: 15000 });
  expect(await page.evaluate(() =>
    Object.keys(localStorage).filter(k => k.startsWith('drainage:zone:')))).toEqual([]);
});

test('delineation failure is loud, and says the drainage is UNKNOWN', async ({ page }) => {
  test.slow();   // fetchRetry backs off 1s+2s twice before giving up
  await mockServices(page, { nldi: 'fail' });
  await page.goto('/' + HASH);
  await expect(page.locator('#status')).toHaveText(/^FAILED: .*UNKNOWN, not empty/, { timeout: 25000 });
});

test('after a failure, requesting the same point again retries', async ({ page }) => {
  test.slow();
  const { opts } = await mockServices(page, { nldi: 'fail' });
  await page.goto('/' + HASH);
  await expect(page.locator('#status')).toHaveText(/^FAILED/, { timeout: 25000 });
  opts.nldi = 'ok';   // the service recovers
  // same-hash tap: the click handler calls routeFromHash directly, since no
  // hashchange fires when the hash is unchanged
  await page.evaluate(() => routeFromHash());
  await doneStatus(page);
});

test('exports: GeoJSON matches the Gaia-proven shape; KML escapes the attacker-controlled name', async ({ page }) => {
  await mockServices(page);
  await page.goto('/' + HASH + ',A %26 B %3CCanyon%3E');   // name: A & B <Canyon>
  await doneStatus(page);

  const [gj] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-geojson').click()]);
  expect(gj.suggestedFilename()).not.toMatch(/[<>\/\\]/);
  const gjBody = JSON.parse(require('fs').readFileSync(await gj.path(), 'utf8'));
  expect(gjBody.bbox).toHaveLength(4);
  expect(gjBody.features.map(f => f.geometry.type)).toEqual(['Point', 'Polygon']);
  expect(gjBody.features[1].properties.name).toBe('A & B <Canyon> Drainage');
  for (const v of Object.values(gjBody.features[1].properties)) {
    expect(['string', 'number']).toContain(typeof v);   // flat scalars only — arrays broke Gaia
  }

  const [kml] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-kml').click()]);
  const kmlBody = require('fs').readFileSync(await kml.path(), 'utf8');
  expect(kmlBody).toContain('A &amp; B &lt;Canyon&gt; Drainage');
  expect(kmlBody).not.toMatch(/<Canyon>|<Style|styleUrl/);
  expect(kmlBody).toContain('<outerBoundaryIs>');
});

test('feedback: thumb opens the form, Send posts rating + shown spot to Web3Forms', async ({ page }) => {
  const { requests } = await mockServices(page);
  await page.goto('/' + HASH + ',My Canyon');
  await doneStatus(page);
  await expect(page.locator('#fb-more')).toBeHidden();
  await page.locator('#fb-up').click();
  await expect(page.locator('#fb-more')).toBeVisible();
  await expect(page.locator('#fb-loc-val')).toContainText('37.2, -112.9 · My Canyon');
  await page.locator('#fb-comment').fill('Great tool');
  await page.locator('#fb-more button[type=submit]').click();
  await expect(page.locator('#fb-ask')).toHaveText('Sent — thanks.');
  const post = requests.find(r => r.url.includes('web3forms'));
  const body = JSON.parse(post.post);
  expect(body.rating).toBe('up');
  expect(body.comment).toBe('Great tool');
  expect(body.spot).toContain('My Canyon');
});

test('saving and deleting pins round-trips through localStorage', async ({ page }) => {
  await mockServices(page);
  await page.goto('/' + HASH + ',Keeper');
  await doneStatus(page);
  await page.locator('#btn-pin').click();
  await expect(page.locator('#pins li a')).toHaveText('Keeper');
  await page.locator('#btn-pin').click();   // re-pinning must not duplicate
  await expect(page.locator('#pins li')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drainage:pins')))).toEqual([
    { lat: 37.2, lon: -112.9, name: 'Keeper' },
  ]);
  await page.locator('#pins li .pin-del').click();
  await expect(page.locator('#pins li')).toHaveText('None yet.');
});

test('unpublished: Ω rides in the name, groups at the bottom, and gates both share paths', async ({ page, context }) => {
  // config denies all by default; read is here to prove the write actually landed
  await context.grantPermissions(['clipboard-write', 'clipboard-read']);
  await mockServices(page);
  await page.addInitScript(() => {
    localStorage.setItem('drainage:pins', JSON.stringify([
      { lat: 38, lon: -109, name: 'Ω Secret' }, { lat: 39, lon: -110, name: 'Zion Public' },
    ]));
  });
  await page.goto('/' + HASH);
  await doneStatus(page);
  // sorted into blocks, not by collation: Z before Ω even though Ω is alphabetically nowhere
  await expect(page.locator('#pins li a')).toHaveText(['Zion Public', 'Ω Secret']);
  await expect(page.locator('#pins li').nth(1)).toHaveClass('unpub');

  // ticking the box rewrites the name box, the title and the URL
  await page.locator('#pin-name').fill('Neon');
  await page.locator('#chk-unpub').check();
  await expect(page.locator('#pin-name')).toHaveValue('Ω Neon');
  await expect(page.locator('#title')).toHaveText('Drainage — Ω Neon');
  expect(decodeURIComponent(page.url())).toContain('#37.2,-112.9,Ω Neon');

  // The gate is in the page, never a dialog: a dialog is suppressed in an installed PWA,
  // where it would make sharing an unpublished spot impossible rather than deliberate.
  let dialogs = 0;
  page.on('dialog', d => { dialogs++; d.dismiss(); });

  // single share: Cancel copies nothing
  await page.locator('#btn-share').click();
  await expect(page.locator('#ask')).toContainText('1 unpublished spot');
  await page.locator('#ask').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#status')).toHaveText('Link not copied.');

  // group share: only the ticked Ω pins are named, and the copy goes through from the
  // question's own button — the clipboard needs that click's user gesture
  await page.locator('#btn-pin').click();
  await page.locator('#pins-all').click();
  await page.locator('#pins-share').click();
  const ask = page.locator('#pins-msg');
  await expect(ask).toContainText('2 unpublished spots');
  await expect(ask).toContainText('Ω Secret');
  await expect(ask).not.toContainText('Zion Public');
  await ask.getByRole('button', { name: 'Copy the link' }).click();
  await expect(ask).toHaveText('Link to 3 pins copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('#pins:');

  // and unticking strips it again
  await page.locator('#chk-unpub').uncheck();
  await expect(page.locator('#pin-name')).toHaveValue('Neon');
  await page.locator('#btn-share').click();          // nothing to answer now
  await expect(page.locator('#status')).toHaveText('Share link copied.');
  expect(dialogs).toBe(0);
});

test('bulk delete asks in the page, and Keep them keeps them', async ({ page }) => {
  await mockServices(page);
  await page.addInitScript(() => {
    localStorage.setItem('drainage:pins', JSON.stringify([
      { lat: 38, lon: -109, name: 'One' }, { lat: 39, lon: -110, name: 'Two' },
    ]));
  });
  let dialogs = 0;
  page.on('dialog', d => { dialogs++; d.dismiss(); });
  await page.goto('/');
  await page.locator('#pins-all').click();
  await page.locator('#pins-del').click();
  const ask = page.locator('#pins-msg');
  await expect(ask).toContainText('Delete 2 saved pins? This cannot be undone.');
  await ask.getByRole('button', { name: 'Keep them' }).click();
  await expect(ask).toHaveText('Nothing deleted.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drainage:pins')))).toHaveLength(2);
  await page.locator('#pins-del').click();
  await ask.getByRole('button', { name: 'Delete 2' }).click();
  await expect(ask).toHaveText('Deleted 2 pins.');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drainage:pins')))).toEqual([]);
  expect(dialogs).toBe(0);
});

test('shift-click selects a range of saved pins', async ({ page }) => {
  await mockServices(page);
  await page.addInitScript(() => {
    localStorage.setItem('drainage:pins', JSON.stringify(
      ['A', 'B', 'C', 'D'].map((n, i) => ({ lat: 38 + i, lon: -109, name: n }))));
  });
  await page.goto('/');
  await expect(page.locator('#pins li')).toHaveCount(4);
  await page.locator('.pin-cb').nth(0).check();
  await page.locator('.pin-cb').nth(2).click({ modifiers: ['Shift'] });
  await expect(page.locator('#pins-share')).toHaveText('Share 3');
  // shift-unclick clears the range the same way
  await page.locator('.pin-cb').nth(0).click({ modifiers: ['Shift'] });
  await expect(page.locator('#pins-share')).toHaveText('Share');
});

test('pasted coordinates: spaces, missing comma, degrees — and the URL is canonicalized', async ({ page }) => {
  await mockServices(page);
  await page.goto('/#37.2, -112.9, My Spot');       // the shape people actually paste
  await doneStatus(page);
  expect(page.url()).toContain('#37.2,-112.9,My%20Spot');   // no %20 left in the coordinates
  await expect(page.locator('#title')).toHaveText('Drainage — My Spot');
  await page.goto('/#(+37.2° -112.9°)');            // no comma at all, degrees, parens
  await doneStatus(page);
  expect(page.url()).toContain('#37.2,-112.9');
  await page.goto('/#37°13\'17\"N 112°57\'36\"W');   // DMS, converted and canonicalized
  await doneStatus(page);
  expect(page.url()).toContain('#37.22139,-112.96');
  // without the ° it is indistinguishable from a decimal or a UTM pair — refused, not guessed
  await page.goto('/#37 13 17 N 112 57 36 W');
  await expect(page.locator('#status')).toHaveText(/^Invalid share link/);
});

test('pasted UTM: converted, noted, and canonicalized to decimal degrees', async ({ page }) => {
  await mockServices(page);
  await page.goto('/#327065mE 4122955mN,Pine Creek');
  await doneStatus(page);
  expect(page.url()).toContain('#37.23709,-112.94958,Pine%20Creek');
  // which zone was assumed has to survive delineate() overwriting the status line
  await expect(page.locator('#coord-note')).toContainText('UTM zone 12, WGS84 → 37.23709, -112.94958');
  await expect(page.locator('#coord-note')).toContainText('assumed from the map view');
  await page.locator('#btn-clear').click();
  await expect(page.locator('#coord-note')).toHaveText('');
});

test('saving a name that is already taken overrides that pin', async ({ page }) => {
  await mockServices(page);
  await page.goto('/' + HASH + ',Keeper');
  await doneStatus(page);
  await page.locator('#btn-pin').click();
  await page.goto('/#37.5,-112.5,keeper');       // different spot, same name (other case)
  await doneStatus(page);
  await page.locator('#btn-pin').click();
  await expect(page.locator('#pins li')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drainage:pins')))).toEqual([
    { lat: 37.5, lon: -112.5, name: 'keeper' },
  ]);
});

// ---- tracing the canyon (polyline → pour point) ----
// Helper: click real map pixels for a list of [lon,lat], the way a person traces.
async function traceOnMap(page, coords) {
  const box = await page.locator('#map canvas').boundingBox();
  const px = await page.evaluate(cs => cs.map(c => { const p = map.project(c); return [p.x, p.y]; }), coords);
  for (const [x, y] of px) await page.mouse.click(box.x + x, box.y + y);
}

test('traced line delineates at its BOTTOM end, and tracing does not delineate mid-trace', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.goto('/');
  await page.evaluate(() => map.jumpTo({ center: [-112.9, 37.22], zoom: 9 }));
  await page.locator('#btn-draw').click();
  // top of the canyon first, bottom (the mocked tap point) last — all inside the mock basin
  await traceOnMap(page, [[-112.9, 37.28], [-112.9, 37.24], [-112.9, 37.2]]);
  expect(page.url()).not.toContain('#');            // vertices are vertices, not taps
  await expect(page.locator('#basin-info')).toHaveText('Nothing delineated yet.');
  await expect(page.locator('#btn-draw')).toHaveText('Done — 3 points');
  const traced = await page.evaluate(() => drawPts.slice());
  await page.locator('#btn-draw').click();
  // the pour point is the LAST vertex, not the first — pixel rounding means we assert
  // against what was actually traced rather than the nominal coordinates
  const [lon, lat] = traced[traced.length - 1];
  expect(page.url()).toContain(`#${lat},${lon}`);
  expect(lat).toBeLessThan(traced[0][1]);            // and that end is the downhill one
  await expect(page.locator('#status')).toHaveText(/^Done\. Exact drainage/, { timeout: 15000 });
  await expect(page.locator('#basin-info .warn')).toHaveCount(0);   // route is inside the basin
  await expect(page.locator('#btn-draw')).toHaveText(/Draw the canyon/);
});

test('a line traced bottom-to-top is caught: most of the route falls outside the drainage', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.goto('/');
  await page.evaluate(() => map.jumpTo({ center: [-112.9, 37.3], zoom: 8 }));
  // mock basin spans lat 37.15–37.3, so 37.45/37.5 are outside it: the shape a
  // backwards trace makes — the pour point lands at the top and the canyon is elsewhere
  await page.locator('#btn-draw').click();
  await traceOnMap(page, [[-112.9, 37.5], [-112.9, 37.45], [-112.9, 37.2]]);
  await page.locator('#btn-draw').click();
  await expect(page.locator('#basin-info .warn'))
    .toContainText('2 of the 3 points you traced are OUTSIDE', { timeout: 15000 });
  await expect(page.locator('#basin-info .warn')).toContainText('traced from the bottom up');
  // and a plain tap afterwards drops the stale trace along with its warning
  await page.locator('#btn-clear').click();
  expect(await page.evaluate(() => route)).toBeNull();
});

// ---- importing a canyon's KML / GPX ----
// tests/fixtures/canyon.{kml,gpx} hold the same 5 sections against mock.js's synthetic
// terrain (north = higher, 300 m per 0.01 deg). Approach climbs; Slot drops 180 m at 26%;
// Big Drop drops 360 m at 27%; Exit drops 60 m at 14%; Shuttle drops 600 m — the LARGEST
// total drop in the file — but at only ~3.6%, because it is a road. Two documented traps
// are encoded here:
//   * the route's GLOBAL low point is lat 37.190, in Approach and Exit. Keyhole's real
//     file behaves the same way, where taking the global minimum lands in the exit walk by
//     Clear Creek and inflates the drainage 19x.
//   * Shuttle wins on total drop and must lose to MIN_GRADE. Ranking by drop alone picked
//     a road or shuttle in 14% of 178 archived ropewiki files.
// Big Drop's far end, 37.192, is the right answer.
for (const ext of ['kml', 'gpx']) {
  test(`import ${ext}: the steepest descent is picked, and the pour point is its low end — not the route's global minimum`, async ({ page }) => {
    await mockServices(page, { streamstats: 'exact' });
    await page.goto('/');
    await page.locator('#file-track').setInputFiles(`tests/fixtures/canyon.${ext}`);
    await expect(page.locator('#seg-pick')).toBeVisible();
    // every LineString/trkseg becomes a section; the Parking waypoint is not one
    await expect(page.locator('#seg-pick option')).toHaveCount(6);   // 5 + the header
    await expect(page.locator('#seg-pick')).toContainText('Big Drop');
    expect(await page.locator('#seg-pick').inputValue()).toBe('2');  // Big Drop
    // the Shuttle drops further than anything else and must still lose, on gradient alone
    await expect(page.locator('#seg-pick option').nth(5)).toHaveText(/Shuttle .*↓ 1969 ft \(3%\)/);
    await expect(page.locator('#seg-pick option').nth(3)).toHaveText(/Big Drop .*↓ 1181 ft \(27%\)/);
    await expect(page.locator('#import-note')).toContainText('steepest descent');
    expect(page.url()).toContain('#37.192,-112.904');                // NOT 37.19, the global min
    await expect(page.locator('#status')).toHaveText(/^Done\./, { timeout: 15000 });
    await expect(page.locator('#basin-info .warn')).toHaveCount(0);  // the section is inside its own basin
  });
}

test('import: the section picker moves the pour point, and Clear puts the importer away', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.goto('/');
  await page.locator('#file-track').setInputFiles('tests/fixtures/canyon.kml');
  await expect(page.locator('#status')).toHaveText(/^Done\./, { timeout: 15000 });
  await page.locator('#seg-pick').selectOption('1');                 // Slot instead
  expect(page.url()).toContain('#37.204,-112.902');                  // Slot's low end
  expect(await page.evaluate(() => route.length)).toBe(3);
  await page.locator('#btn-clear').click();
  await expect(page.locator('#import-box')).toBeHidden();
  expect(await page.evaluate(() => [route, segs.length])).toEqual([null, 0]);
});

test('import: with no elevation to rank by, the app asks instead of guessing', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact', elev: 'nodata' });
  await page.goto('/');
  await page.locator('#file-track').setInputFiles('tests/fixtures/canyon.kml');
  await expect(page.locator('#import-note')).toContainText('choose the descending section yourself');
  await expect(page.locator('#import-note')).toHaveClass('warn');
  expect(await page.locator('#seg-pick').inputValue()).toBe('');     // nothing pre-selected
  expect(page.url()).not.toContain('#');                             // and nothing delineated
  // labels still carry name and length, but no drop — there is none to show
  await expect(page.locator('#seg-pick option').nth(1)).toHaveText(/^Test Canyon - Approach — [\d.]+ mi$/);
});

test('import: a file with no tracks fails loudly and by name', async ({ page }) => {
  await mockServices(page);
  await page.goto('/');
  await page.locator('#file-track').setInputFiles({
    name: 'empty.kml', mimeType: 'application/xml',
    buffer: Buffer.from('<?xml version="1.0"?><kml><Document><name>x</name></Document></kml>'),
  });
  await expect(page.locator('#import-note')).toContainText('Could not use empty.kml: no tracks or routes');
  await expect(page.locator('#import-note')).toHaveClass('warn');
});
