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

test('multi-pin import: dialog offers only new pins; accept saves and delineates the first', async ({ page }) => {
  await mockServices(page);
  await page.addInitScript(() => {
    localStorage.setItem('drainage:pins', JSON.stringify([{ lat: 38, lon: -109, name: 'Already' }]));
  });
  let dialogMsg = '';
  page.on('dialog', d => { dialogMsg = d.message(); d.accept(); });
  await page.goto('/#pins:37.2,-112.9,First;38,-109,Already;39.5,-110.5,Third');
  await doneStatus(page);
  expect(dialogMsg).toContain('Add 2 new pins');
  expect(dialogMsg).toContain('First');
  expect(dialogMsg).not.toContain('Already');
  await expect(page.locator('#pins-msg')).toContainText('Added 2 pins from this link. 1 was already saved.');
  const pins = await page.evaluate(() => JSON.parse(localStorage.getItem('drainage:pins')));
  expect(pins).toHaveLength(3);
  expect(page.url()).toContain('#37.2,-112.9,First');   // rewritten to the single-pin form
});

test('multi-pin import: declining writes nothing but still shows the first drainage', async ({ page }) => {
  await mockServices(page);
  // Playwright auto-dismisses dialogs — same as confirm() returning false
  await page.goto('/#pins:37.2,-112.9,First;39.5,-110.5,Third');
  await doneStatus(page);
  await expect(page.locator('#pins-msg')).toContainText('Pins from this link were not added.');
  expect(await page.evaluate(() => localStorage.getItem('drainage:pins'))).toBeNull();
});

test('multi-pin import: all duplicates → no dialog at all', async ({ page }) => {
  await mockServices(page);
  await page.addInitScript(() => {
    localStorage.setItem('drainage:pins', JSON.stringify([{ lat: 37.2, lon: -112.9, name: 'Mine' }]));
  });
  let dialogs = 0;
  page.on('dialog', d => { dialogs++; d.accept(); });
  await page.goto('/#pins:37.2,-112.9,Theirs');
  await doneStatus(page);
  expect(dialogs).toBe(0);
  await expect(page.locator('#pins-msg')).toContainText('Every pin in this link was already saved.');
  const pins = await page.evaluate(() => JSON.parse(localStorage.getItem('drainage:pins')));
  expect(pins).toEqual([{ lat: 37.2, lon: -112.9, name: 'Mine' }]);   // local name survived
});

test('invalid share link shows the error, not silence', async ({ page }) => {
  await mockServices(page);
  await page.goto('/#garbage');
  await expect(page.locator('#status')).toHaveText('Invalid share link — expected #lat,lon,name.');
  await expect(page.locator('#status')).toHaveClass('err');
});

test('a link with a broken percent-escape shows the invalid-link error instead of throwing', async ({ page }) => {
  await mockServices(page);
  await page.goto('/#37.2,-112.9,100%');
  await expect(page.locator('#status')).toHaveText('Invalid share link — expected #lat,lon,name.');
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
