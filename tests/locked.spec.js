// ?locked — the app pinned to the pour point in the fragment, for a beta site
// embedding one canyon's drainage in that canyon's page.
const { test, expect } = require('@playwright/test');
const { mockServices } = require('./mock');

const HASH = '#37.2,-112.9,Pine Creek';
const doneStatus = page => expect(page.locator('#basin-info')).not.toBeEmpty({ timeout: 15000 });

test('locked: panel gone, forecast and alerts move into the map, clicks do not re-select', async ({ page }) => {
  const { requests } = await mockServices(page, { streamstats: 'exact', alerts: 'none' });
  await page.goto('/?locked' + HASH);
  await doneStatus(page);

  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#divider')).toBeHidden();
  // the two sections are children of the bar now, not of the panel
  await expect(page.locator('#lockbar #forecast')).toContainText('Peak rain', { timeout: 15000 });
  await expect(page.locator('#lockbar #alerts')).toContainText('No active alerts');
  await expect(page.locator('#lockbar')).toBeVisible();
  // idle status stays hidden — "tap a point" is a lie in this mode
  await expect(page.locator('#status')).toBeHidden();

  const before = requests.filter(r => r.url.includes('linked-data')).length;
  await page.locator('#map canvas').click({ position: { x: 500, y: 300 } });
  await page.waitForTimeout(500);
  expect(page.url()).toContain(encodeURI(HASH));                      // fragment untouched
  expect(requests.filter(r => r.url.includes('linked-data')).length).toBe(before);
});

test('locked: sub-flags switch sections off, and off means no network call', async ({ page }) => {
  const { requests } = await mockServices(page, { streamstats: 'exact' });
  await page.goto('/?locked&forecast=0&alerts=0&open=0' + HASH);
  await doneStatus(page);
  await page.waitForTimeout(1000);

  await expect(page.locator('#lockbar #forecast')).toHaveCount(0);
  await expect(page.locator('#lockbar #alerts')).toHaveCount(0);
  await expect(page.locator('#openfull')).toHaveCount(0);
  expect(requests.filter(r => r.url.includes('api.weather.gov'))).toHaveLength(0);
  // exact path, no warnings, nothing switched on → no empty white strip
  await expect(page.locator('#lockbar')).toBeHidden();
});

test('locked: the way back to the full app drops the query, keeps the point', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.goto('/?locked&forecast=0&alerts=0' + HASH);
  await doneStatus(page);
  const href = await page.locator('#openfull').getAttribute('href');
  expect(href).toContain(encodeURI(HASH));
  expect(href).not.toContain('locked');
  expect(await page.locator('#openfull').getAttribute('target')).toBe('_blank');
});

test('locked: a failed delineation still says so — the map must never go silently blank', async ({ page }) => {
  await mockServices(page, { streamstats: 'decline', nldi: 'fail' });
  await page.goto('/?locked' + HASH);
  await expect(page.locator('#status')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#status')).toHaveText(/UNKNOWN, not empty/);
});

test('locked: an embed with no pour point says the embed is broken', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.goto('/?locked');
  await expect(page.locator('#status')).toHaveText(/no pour point/);
});

test('locked: the NLDI fallback caveat survives the hidden status line', async ({ page }) => {
  await mockServices(page, { streamstats: 'decline' });
  await page.goto('/?locked' + HASH);
  await doneStatus(page);
  await expect(page.locator('#lockbar #basin-info .warn')).toContainText('Approximate', { timeout: 15000 });
  // the plain area line is noise here, and "zoom in and tap a blue line" would be a lie
  await expect(page.locator('#lockbar #basin-info > div').first()).toBeHidden();
});

test('no query string: the full app is untouched, iframe or not', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.goto('/' + HASH);
  await expect(page.locator('#status')).toHaveText(/^Done\./, { timeout: 15000 });
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#lockstack')).toHaveCount(0);
  await expect(page.locator('#panel #forecast')).toContainText('Peak rain', { timeout: 15000 });
});

test('locked: a sandboxed frame that blocks popups gets the URL, not a dead link', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  // what sandbox-without-allow-popups does to target=_blank, minus the iframe
  await page.addInitScript(() => { window.open = () => null; });
  await page.goto('/?locked&forecast=0&alerts=0' + HASH);
  await doneStatus(page);
  await page.locator('#openfull').click();
  await expect(page.locator('#openfull')).toHaveText(/^Copy this link: http.*#37\.2,-112\.9,Pine%20Creek$/);
  expect(await page.locator('#openfull').getAttribute('href')).toContain('#37.2,-112.9');
});

test('locked: the click through to the full app is counted, once, by name only', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.addInitScript(() => {
    window.__sent = [];
    window.Image = class { set src(v) { window.__sent.push(v); } };
  });
  await page.goto('/?locked&forecast=0&alerts=0' + HASH);
  await doneStatus(page);
  await page.locator('#openfull').click();
  const sent = await page.evaluate(() => window.__sent.filter(u => u.includes('goatcounter')));
  expect(sent.filter(u => u.includes('p=open'))).toHaveLength(1);
  // the mode is counted in its own right — not inferred from the click, which open=0 kills
  expect(sent.filter(u => u.includes('p=locked'))).toHaveLength(1);
  for (const u of sent) expect(u.replace(/&rnd=.*/, '')).not.toMatch(/37|112|Pine/);
});

test('locked: the mode is counted even with the open link switched off', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.addInitScript(() => {
    window.__sent = [];
    window.Image = class { set src(v) { window.__sent.push(v); } };
  });
  await page.goto('/?locked&forecast=0&alerts=0&open=0' + HASH);
  await doneStatus(page);
  const sent = await page.evaluate(() => window.__sent.filter(u => u.includes('goatcounter')));
  expect(sent.filter(u => u.includes('p=locked'))).toHaveLength(1);
  expect(sent.filter(u => u.includes('p=open'))).toHaveLength(0);
  for (const u of sent) expect(u.replace(/&rnd=.*/, '')).not.toMatch(/37|112|Pine/);
});

test('no query string: nothing counts a mode that is not on', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.addInitScript(() => {
    window.__sent = [];
    window.Image = class { set src(v) { window.__sent.push(v); } };
  });
  await page.goto('/' + HASH);
  await expect(page.locator('#status')).toHaveText(/^Done\./, { timeout: 15000 });
  const sent = await page.evaluate(() => window.__sent.filter(u => u.includes('goatcounter')));
  expect(sent.filter(u => u.includes('p=locked'))).toHaveLength(0);
});

test('locked: the pane takes the edge asked for, and an unknown value falls back to bottom', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  for (const [q, want] of [['', 'bottom'], ['&pane=top', 'top'], ['&pane=left', 'left'],
                           ['&pane=right', 'right'], ['&pane=sideways', 'bottom']]) {
    await page.goto('/?locked' + q + HASH);
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\bpane-${want}\\b`));
    const cls = await page.locator('html').getAttribute('class');
    expect(cls.match(/pane-\w+/g), q).toHaveLength(1);   // exactly one edge, never two
  }
});

test('locked: the basin is fitted clear of the pane, not under it', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.goto('/?locked&pane=bottom' + HASH);
  await doneStatus(page);
  await expect(page.locator('#lockbar #forecast')).toContainText('Peak rain', { timeout: 15000 });
  // let the ResizeObserver settle after the forecast lands
  await page.waitForTimeout(1500);
  const box = await page.evaluate(() => {
    const b = turf.bbox(cur.basin);
    const pts = [map.project([b[0], b[1]]), map.project([b[2], b[3]])];
    const pane = document.getElementById('lockstack').getBoundingClientRect();
    return {
      basinBottom: Math.max(pts[0].y, pts[1].y),
      paneTop: pane.top,
      basinTop: Math.min(pts[0].y, pts[1].y),
    };
  });
  expect(box.basinBottom).toBeLessThanOrEqual(box.paneTop);   // wholly above the pane
  expect(box.basinTop).toBeGreaterThan(0);                    // and not pushed off the top
});

test('locked: a reader who pans the map keeps their view — no auto-refit fights them', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.goto('/?locked' + HASH);
  await doneStatus(page);
  await page.waitForTimeout(1500);

  // a REAL drag — programmatic panBy carries no originalEvent and would not set the flag
  const map = page.locator('#map canvas');
  const b = await map.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 200, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => userPanned)).toBe(true);

  const after = await page.evaluate(() => map.getCenter().lng);
  // resizing the frame resizes the pane, which is what normally triggers a refit
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => map.getCenter().lng)).toBeCloseTo(after, 4);
});

test('locked: before anyone touches the map, a pane resize does re-fit the basin', async ({ page }) => {
  await mockServices(page, { streamstats: 'exact' });
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto('/?locked&pane=left' + HASH);
  await doneStatus(page);
  await page.waitForTimeout(1500);
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => userPanned)).toBe(false);
  const box = await page.evaluate(() => {
    const bb = turf.bbox(cur.basin);
    const pts = [map.project([bb[0], bb[1]]), map.project([bb[2], bb[3]])];
    return { basinLeft: Math.min(pts[0].x, pts[1].x),
             paneRight: document.getElementById('lockstack').getBoundingClientRect().right };
  });
  expect(box.basinLeft).toBeGreaterThanOrEqual(box.paneRight);   // refitted clear of the strip
});

test('locked: a dropped track file changes nothing — the pour point comes from the URL', async ({ page }) => {
  const { requests } = await mockServices(page, { streamstats: 'exact', alerts: 'none' });
  await page.goto('/?locked' + HASH);
  await doneStatus(page);
  const before = requests.filter(r => r.url.includes('linked-data') || r.url.includes('getSamples')).length;
  // the button rides along with the hidden panel; the drop handler is on the document, so
  // it needs its own `locked` guard and this is what proves the guard is there
  await expect(page.locator('#btn-import')).toBeHidden();
  const kml = require('fs').readFileSync('tests/fixtures/canyon.kml', 'utf8');
  await page.evaluate(text => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'canyon.kml', { type: 'application/xml' }));
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, kml);
  await page.waitForTimeout(500);
  expect(page.url()).toContain(encodeURI(HASH));                      // fragment untouched
  expect(await page.evaluate(() => [route, segs.length])).toEqual([null, 0]);
  expect(requests.filter(r => r.url.includes('linked-data') || r.url.includes('getSamples')).length).toBe(before);
});
