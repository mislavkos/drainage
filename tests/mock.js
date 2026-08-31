// Hermetic network for the app: every external service gets a canned response.
// Scenario knobs let a test pick which path the app takes (opts is read live,
// so a test can flip a knob mid-test to simulate a service recovering).
//
// Geometry: tap at 37.2,-112.9 (Utah), snap ~66 m away, basin = a ~296 km²
// square that contains the tap. Small enough moves and big enough area that
// the happy path renders no warnings.

const TAP = { lat: 37.2, lon: -112.9 };
const SNAP = [-112.9005, 37.2005];
const SS_SNAP = [-112.9004, 37.2004];
const COMID = 12345;
const BASIN_RING = [[-113.0, 37.15], [-112.8, 37.15], [-112.8, 37.3], [-113.0, 37.3], [-113.0, 37.15]];
const basinFeature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [BASIN_RING] } };

// grid values start at the top of the current UTC hour, like real NWS data
const topOfHour = () => new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString();

const FIXTURES = {
  hydrolocation: () => ({ features: [
    { type: 'Feature', properties: { source: 'provided' }, geometry: { type: 'Point', coordinates: [TAP.lon, TAP.lat] } },
    { type: 'Feature', properties: { source: 'indexed', comid: COMID }, geometry: { type: 'Point', coordinates: SNAP } },
  ] }),
  position: () => ({ features: [
    { type: 'Feature', properties: { comid: COMID }, geometry: { type: 'LineString', coordinates: [[-112.95, 37.25], SNAP] } },
  ] }),
  basin: () => ({ type: 'FeatureCollection', features: [basinFeature] }),
  // snap point is the LAST coordinate → nothing downstream → no reach-head warning
  flowline: () => ({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-112.95, 37.25], SNAP] } },
  ] }),
  ssSnap: () => ({ scope: 'stream', output: { type: 'Point', coordinates: SS_SNAP } }),
  ssDecline: () => ({ scope: null }),
  ssDelineate: () => ({ bcrequest: { wsresp: { featurecollection: [
    [{ name: 'globalwatershed', feature: { features: [basinFeature] } }],
  ] } } }),
  points: () => ({ properties: {
    gridId: 'SLC',
    forecastGridData: 'https://api.weather.gov/gridpoints/SLC/100,200',
    timeZone: 'America/Denver',
  } }),
  // 12.7 mm over 6 h = 0.0833 in/hr → displays as a 0.08 in/hr peak
  grid: () => ({ properties: {
    quantitativePrecipitation: { uom: 'wmoUnit:mm', values: [{ validTime: `${topOfHour()}/PT6H`, value: 12.7 }] },
    probabilityOfPrecipitation: { uom: 'wmoUnit:percent', values: [{ validTime: `${topOfHour()}/PT12H`, value: 60 }] },
    temperature: { uom: 'wmoUnit:degC', values: [{ validTime: `${topOfHour()}/P1D`, value: 20 }] },
  } }),
  alert: () => ({ type: 'Feature', geometry: null, properties: {
    event: 'Flood Watch', severity: 'Severe', headline: 'Flood Watch until 6 AM MDT',
    affectedZones: ['https://api.weather.gov/zones/forecast/UTZ123'],
    description: 'Heavy rain expected.', instruction: 'Turn around, don’t drown.',
  } }),
  zone: () => ({ geometry: { type: 'Polygon', coordinates: [BASIN_RING] } }),
};

// opts: { streamstats: 'decline'|'exact', alerts: 'zone'|'none'|'fail',
//         nldi: 'ok'|'fail', zone: 'ok'|'missing' }
// Returns { opts, requests } — opts is live-mutable, requests logs {url, post}.
async function mockServices(page, opts = {}) {
  const o = Object.assign({ streamstats: 'decline', alerts: 'zone', nldi: 'ok', zone: 'ok' }, opts);
  const requests = [];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost')) return route.fallback();
    requests.push({ url, post: route.request().postData() });
    const json = body => route.fulfill({ json: body });
    const fail = () => route.fulfill({ status: 500, body: 'mock failure' });

    if (url.includes('/linked-data/hydrolocation')) return o.nldi === 'ok' ? json(FIXTURES.hydrolocation()) : fail();
    if (url.includes('/linked-data/comid/position')) return o.nldi === 'ok' ? json(FIXTURES.position()) : fail();
    if (url.includes(`/linked-data/comid/${COMID}/basin`)) return json(FIXTURES.basin());
    if (url.includes(`/linked-data/comid/${COMID}`)) return json(FIXTURES.flowline());
    if (url.includes('splitcatchment')) return json({ features: [] });          // broken-in-prod shape
    if (url.includes('/pourpoint/v2/snap/')) return json(o.streamstats === 'exact' ? FIXTURES.ssSnap() : FIXTURES.ssDecline());
    if (url.includes('/ss-delineate/')) return json(FIXTURES.ssDelineate());
    if (url.includes('gis.streamstats.usgs.gov') && url.includes('f=json')) return json({ layers: [] });
    if (url.includes('api.weather.gov/points/')) return json(FIXTURES.points());
    if (url.includes('api.weather.gov/gridpoints/')) return json(FIXTURES.grid());
    if (url.includes('api.weather.gov/alerts/active')) {
      if (o.alerts === 'fail') return fail();
      return json({ features: o.alerts === 'zone' ? [FIXTURES.alert()] : [] });
    }
    if (url.includes('api.weather.gov/zones/')) return json(o.zone === 'missing' ? { geometry: null } : FIXTURES.zone());
    if (url.includes('goatcounter.com')) return route.fulfill({ status: 204, body: '' });
    if (url.includes('web3forms.com')) return json({ success: true });
    return route.abort();   // basemap tiles etc. — the app must work without them
  });
  return { opts: o, requests };
}

module.exports = { mockServices, TAP, COMID };
