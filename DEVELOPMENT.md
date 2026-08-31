# Development notes

Institutional memory for this codebase: the decisions, service quirks, and validation
results behind `index.html`. Read this before changing anything non-obvious — most of
what looks odd in the code is a deliberate answer to something documented here.

## What this is

A single static page: tap a point on a topo map → see the drainage (upslope contributing
area) that feeds it, its area, a 48-hour worst-spot-in-the-basin rain timeline, and any
active NWS alerts intersecting the basin. Share links reproduce the delineation. Exports
go to GaiaGPS / CalTopo / Google Earth. Purpose: "I'm heading down this canyon — will it
flash?"

Live at <https://mislavkos.github.io/drainage/> — GitHub Pages from `main` of
<https://github.com/mislavkos/drainage> (push to `main` redeploys; Pages serves
everything with `max-age=600`, not configurable, so updates propagate within 10 min).

## Files

```
index.html            the whole app (no build step)
vendor/               maplibre-gl.js + .css, turf.min.js, us-states.json (vendored, no CDN)
tests/                Playwright regression suite (dev-only; see "Tests" below)
.claude/launch.json   dev server config
```

Run: `python3 -m http.server 8137` and open `http://localhost:8137`. Never `file://`:
the remote APIs would actually work (they all send `access-control-allow-origin: *`),
but the page's own fetch of `vendor/us-states.json` fails, which *silently* disables
`stateAt()`, the whole StreamStats path, and the StreamGrid overlay while the rest of
the app looks fine.

## Decisions — don't relitigate

- **No Electron, no build step, no backend, no accounts.** One HTML file + vendored libs.
- **Vendor MapLibre and Turf** — supply-chain and availability. Don't switch to CDNs.
- **Don't compute catchments ourselves** — USGS serves the precomputed answer.
- **Share the pour point, not the polygon**: links are `#lat,lon,name` in the fragment;
  the recipient's browser recomputes.
- **GeoJSON primary / KML secondary for export. Not GPX** (no polygon type). Both mimic
  StreamStats' own download shape — see "Export / Gaia".
- **Basemaps, all keyless**: USGS Topo (default), USGS ImageryTopo, OpenTopoMap, OSM.
  ArcGIS tile order is `{z}/{y}/{x}` — row before column. OpenTopoMap's volunteer
  servers 502 intermittently at high zoom; known quirk, not a bug here.
- **Units toggle** persisted; internal storage stays °F/inches. Area shows in the
  active unit; rain in/mm; temps °F/°C.
- **No custom domain** (2026-08-31). The one real argument for it — origin isolation,
  since github.io project pages share one localStorage origin across all of the
  account's repos — is handled by namespacing every key `drainage:`. Against it: a
  lapsed domain kills every share link ever sent, and for an app whose value is
  "someone texts you this link before you drop in", link durability outranks tidiness.
  If a domain is ever bought, point it at Pages *in addition* and keep github.io alive.
- **No CSP** (2026-08-30). The security audit found no injection surface to defend, and
  MapLibre's `worker-src blob:` + `'unsafe-inline'` style needs would make the policy
  weak enough not to be worth the testing cost.
- **No service worker.** Chrome installs the PWA without one and the app needs network
  anyway. `apple-touch-icon.png` must keep that exact filename — Safari requests it by
  name. PNGs are rendered from `favicon.svg` on white; regenerate the same way.
- **Analytics on by default, no consent prompt** (2026-08-31). Most people ignore a
  first-run prompt, and with unanswered = off the numbers were meaningless. The off
  switch lives in "About this app"; `globalPrivacyControl`/`doNotTrack` force it off
  and disable the toggle. See "Privacy promise" for the hard rules.
- **The pre-namespace localStorage migration was deleted** (2026-08-31). Do not add it
  back: the app was never public un-namespaced, bare keys at this origin belong to
  sibling projects (a leftover bare `pins` from another app would have been imported),
  and it silently defeated first-run testing by re-seeding cleared state.

## Three corrections that must not get re-broken

1. **A drainage area is the upslope contributing area of a pour point — NOT "every point
   higher than you."** A peak across a ridge drains elsewhere.
2. **Snap the tapped point to a channel before delineating.** A tap 40 m off the wash
   can return a catchment three orders of magnitude too small — the error direction
   *understates* risk. The app draws tap (gray), snapped point (orange), the dashed
   offset between them, and the flowline.
3. **A suspiciously small basin is a bug until proven otherwise — and it arrives as
   HTTP 200.** Never render a delineation without its area. The app warns at < 2 km²
   and point-in-polygon-checks every tap against the returned basin.

## Delineation

Primary snap + fallback basin (NLDI), validated 4/4 sites + 2 gage checks:

```
GET https://api.water.usgs.gov/nldi/linked-data/hydrolocation?f=json&coords=POINT(lon lat)
    → snapped point + comid (use the feature with source:"indexed"; "provided" is an echo)
    fallback: /linked-data/comid/position?coords=POINT(lon lat)
GET https://api.water.usgs.gov/nldi/linked-data/comid/{comid}/basin?f=json&simplified=false
    → FeatureCollection with one Polygon. SLOW: 8–29 s. Cached by comid in localStorage.
GET /linked-data/comid/{comid} → the flowline (decoration)
```

The NLDI basin runs to the downstream end of the whole reach. Usually that overstates by
one local catchment (errs large/safe), but when the snap lands near the reach HEAD nearly
the whole shaded basin is downstream of the orange point — measured up to **73×** the
true area in small canyons (see "Validation"). Mitigations: (1) when the tap moved
> 100 m, `upgradeStreamStats` runs a second time AT the NLDI snap point — the tap was
outside StreamStats' snap radius but the orange point sits on a mapped stream;
(2) failing that, the flowline handler measures the snap's position along the reach and
sets `cur.reachHead` when ≥ half the reach lies downstream, which renders the red
"much of this shaded area is DOWNSTREAM of the dot" warning. **Don't weaken that
warning** — 8 of 18 Escalante snaps landed reach-head.

**StreamStats exact-point delineation (2026-08-29) — the working refiner.** The
documented StreamStats API is dead, but the streamstats.usgs.gov web app's backend is
alive, CORS-open (`*`), and serves exact-point DEM delineation. Endpoints were read out
of its `appConfig.js` (no docs; `/openapi.json` on each service lists routes):

```
GET https://streamstats.usgs.gov/pourpoint/v2/snap/streamgrid/{ST}?pt=POINT(lon lat)
    → snaps to their 30 m DEM stream grid; success = scope:"stream", failure = scope:null.
      (v1/snap/str900?region=&lat=&lon= returns identical points with a couldSnap bool.)
      Radius: do NOT trust the advertised number. /pourpoint/v2/snap/info/{ST} reports
      UT 180 m, AZ 120 m — but the real reach is location-dependent and can be a third
      of that (measured ~55 m at 37.16109,-113.30259). Plan for ~50 m, not 180.
      Grid threshold ≈ 900 cells (~0.8 km²): smaller channels don't exist in it.
GET https://streamstats.usgs.gov/ss-delineate/v1/delineate/sshydro/{ST}?lat=&lon=
    → 3–15 s. Feature named "globalwatershed" is the basin. Built from 10 m DEM + 1:24k
      NHD, so it has small canyon channels the 1:100k NLDI map lacks, and it ends AT
      the point (no downstream-reach overstatement).
```

Region code comes from the tap point via vendored `us-states.json` (`stateAt()`).
Watching the real StreamStats UI's traffic (2026-08-29) confirmed it makes exactly these
two calls. These endpoints are **undocumented internals** and can change without notice,
so breakage is surfaced, not swallowed: an HTTP error, a response missing `scope`, or a
missing/degenerate basin after a successful snap sets `cur.ssDown` and renders a ⚠ note
("exact-point service failed — this is the coarser NLDI reach basin"). A clean decline
(`scope` ≠ "stream") stays silent — that's normal. NLDI stays primary because coverage
differs: the validated Antelope tap is NOT snappable in StreamStats' AZ grid.

**Degenerate-result trap (both StreamStats and splitcatchment):** an unsnappable point
can return HTTP 200 with a ~0.002 km² polygon. Guards: require a successful snap, reject
area < 0.01 km².

**splitcatchment** (`POST /nldi/pygeoapi/processes/nldi-splitcatchment/execution`)
refines to the exact point and the app auto-tries it on every tap, but it has been
**broken in production** since at least 2026-08-29: HTTP 200 with no `drainageBasin`
feature and a degenerate ~0 km² `splitCatchment`. Guards (keep regardless of future
fixes): use only `drainageBasin`, reject it if area < 0.5 × the reach basin. Request
format traps: inputs must be the **array** form (docs show a broken object form), values
are strings, booleans Python-cased (`"True"`), `simplified` is required. Old host
`labs.waterdata.usgs.gov` is 404. When USGS deploys the fix (nldi-flowtools 0.3.9 was
released 2026-08-24 but not deployed), the app improves with no code change. Probe:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"inputs":[{"id":"lat","value":"36.8640"},{"id":"lon","value":"-111.3740"},
                 {"id":"upstream","value":"True"},{"id":"simplified","value":"False"}]}' \
  'https://api.water.usgs.gov/nldi/pygeoapi/processes/nldi-splitcatchment/execution' \
  | python3 -c 'import json,sys;print([f["id"] for f in json.load(sys.stdin)["features"]])'
# fixed  → ['catchment', 'splitCatchment', 'drainageBasin']   broken → 2 ids only
```

**Snapping limits (1:100k NHD misses small canyon streams).** A tap in an unmapped side
canyon snaps to the nearest mapped stream — possibly ~1 km away — and delineates *that*
stream's basin. Mitigations: every result is point-in-polygon-checked against the tap
(outside → red warning); snap > 150 m → a heads-up; > 1 km → a red warning. The residual
gap is channels under ~0.8 km² accumulation or taps farther off-channel than the snap
radius — that needs the parked DEM pipeline if it ever becomes the core use.

**Service reliability.** The hydrolocation backend goes down for hours; repeated calls
for the same point are served from CDN cache and succeed while it's down, so test
outages with fresh coordinates. Some hydrolocation 502s are point-specific and
reproducible (`POINT(-111.22295 37.63027)`) — the `comid/position` fallback serves the
same point fine. 4-way concurrency against NLDI provokes 502s; 2-way is clean —
throttle any batch work. Everything is wrapped in retry-with-backoff (60 s timeout,
4xx not retried except 429) and fails loudly ("UNKNOWN", never blank).

**StreamGrid overlay (always on, appears at zoom ≥ 11):** raster overlay of the state
StreamGrid layer from `gis.streamstats.usgs.gov/.../stateServices/{ST}/MapServer/export`
(layer id varies per state — looked up from `?f=json` by name "StreamGrid", cached).
It draws exactly which channels can be snapped to — basemaps draw streams the snap grid
doesn't have, which is exactly the trap it defuses. Nothing in the UI explains it
(decided 2026-08-31: the four red warnings already cover the dangerous cases; don't
reopen without a user asking). App sources/layers are added on the first `styledata`
event, not `load` — `load` also waits for basemap tiles, and a hung tile server
(OpenTopoMap does this) would leave the app tap-dead.

## Concurrency invariants

The three delineation paths (NLDI, StreamStats ×2 including the second-chance call,
splitcatchment) run in parallel and coordinate through flags on the shared `cur` object.
This has been the app's main bug factory — every one of these guards exists because its
absence shipped a bug:

- `runId` — bumped per delineation and by Clear; every async continuation checks it.
- `cur.exact` — set by StreamStats; the NLDI path must not overwrite the exact result's
  marker, status, or basin (StreamStats' cached results land in ~0 ms and NLDI's snap
  used to drag the orange point up to a km away).
- `cur.counted` — `renderBasin` runs once per path but the GoatCounter event must fire
  once per tap. Without this flag every dual-success lookup counted twice (all
  pre-2026-08-31 `delineate-XX` dashboard totals are roughly double for this reason).
- `cur.failed` — set when a delineation fails (coordinate-checked, because the catch
  can fire for a stale run); lets a same-point re-tap retry instead of dead-ending on
  the "already showing this point" guards. A same-hash click calls `routeFromHash()`
  directly since no `hashchange` fires.
- `fcSeq` / `alSeq` — per-invocation tickets for the forecast and alerts panels; only
  the newest invocation may write, so a slower coarse-basin result can never overwrite
  the exact basin's panels.

## Weather alerts

States derived from the basin bbox via vendored `us-states.json` (never hardcode),
`GET api.weather.gov/alerts/active?area={states}`, then per alert: intersect its
polygon, or — **the critical part** — resolve `affectedZones` URLs to zone polygons and
intersect those. **Zone-referenced alerts with `geometry: null` are the norm for Flood
Watches** (11 of 11 on the original test day); dropping them silently renders "no
alerts", which reads as safe. Don't replace zone resolution with point sampling — gaps
between samples are the same silent false-all-clear.

Zone geometry caching rule: **a real geometry never changes — cache forever. A missing
one might be a transient service wobble — session-memo only, never persisted**, or the
zone would be silently excluded from every future alert check on that device.

The panel shows fetch time + a Re-check button (alerts go stale in an open tab), a
per-alert `<details>` expander with the full CAP description+instruction (textContent
only — external strings), and a cross-check link to the pour point's NWS office list
(`forecast.weather.gov/wwamap/wwatxtget.php?cwa={gridId}&wwa=all`; office areas span
state lines). `alerts.weather.gov` no longer exists as a host.

**"No active alerts" must never be presented as "safe."** Antelope 1997 had no warning.
The two safety lines in the footer stay OUTSIDE the About expander and always visible;
`#no-alerts-note` is toggled by JS, so keep its id.

## Forecast timeline

48-hour hourly chart — QPF bars, chance-of-rain envelope, temps — where each hour is the
**max across the basin's spots** (pour point, centroid, 4 spread far-edge vertices;
violet dots on the map, click for that spot's NWS page). Spots dedupe to 2–4 NWS grid
cells. The far-edge picker samples ~500 boundary vertices (an unsimplified basin can
carry tens of thousands, and the greedy scan is O(picks × chosen × vertices)).

Plumbing (`api.weather.gov`): `points/{lat},{lon}` → `gridId` + `forecastGridData` +
IANA `timeZone`, cacheable forever. Grid data gotchas, all handled and easy to re-break:

- QPF arrives in **mm** — but convert by reading `.uom`, never by assumption.
- Intervals are **irregular** (PT1H/PT3H/PT6H mixed) — resample to a common hourly axis
  before maxing across cells; accumulations spread evenly over their interval.
- `value: null` is **unknown, not zero** — rendered as grey "no data" columns.
- Labels use the **drainage's timezone**, not the viewer's.
- Chart conventions (user-tuned 2026-08-30): amounts display at 2 decimals and bar
  heights snap to displayed precision (`roundRain`); y-scale floors at 0.1 in/hr — the
  floor caps how tall a *tiny* 48 h max can draw, it does not hide small bars; green
  chance envelope draws OVER the blue bars with a visible top edge; units and timezone
  live in the tapped-column readout (no row-edge labels).
- Text sizes are rem-based with a persisted A⇄A switch (`html.big { font-size: 125% }`).
  Chart SVG text ignores CSS rem, so `drawTimeline` scales its own font sizes off the
  `big` class. Trap: the 0.875rem base lives on `body` ONLY — putting it on `html`
  redefines rem and compounds (this happened; all text silently shrank ~12%).

Deferred by choice: a user-set time-window highlight on the chart. Build only if
eyeballing the chart proves insufficient.

## Security

The fragment is attacker-controlled ("someone sends you a link"):

- `name` renders via `textContent` only; lat/lon validated non-blank (**`Number('')`
  is 0** — a blank field would delineate Null Island, and the range check alone can't
  catch it because 0,0 is valid), finite, and in range. A malformed percent-escape
  (links get truncated by messaging apps) reads as invalid instead of throwing.
- Multi-pin links decode **per field**, never the whole hash — a name containing `;`
  or `,` would otherwise split the wrong field. One mangled pin is dropped, not fatal.
- The pin import is the only path where the fragment *writes* to stored state: it
  dedupes first (`freshPins`, against storage and itself; local name wins), asks via
  `confirm()` naming up to 8 pins, and is bounded by `MAX_IMPORT = 500`. A sandboxed
  iframe without `allow-modals` makes `confirm()` return false — the fail direction is
  "don't write", which is correct. Declining still shows the first drainage.
- Export filenames come from the fragment: `exportName()` strips separators/control
  chars and leading dots (checked against `../../etc/passwd`, newlines, `<script>`).
- KML escapes `& < > " '`; GeoJSON is `JSON.stringify`-safe. The single `innerHTML` is
  the forecast SVG built only from computed numbers/locale strings.
- All `target=_blank` links have `rel=noopener`. No secrets: the Web3Forms key is
  public by design (the destination address lives server-side), GoatCounter's site id
  is the public subdomain.
- Vendored libs, no CDN. **Fail loud — an empty catch that renders a blank alert list
  is the highest-consequence bug in this app.**

## Privacy promise

The Privacy bullets tell the user "Nothing else, and never a coordinate". Since the
in-app vocabulary disclosure was removed (2026-08-31, deliberately — the section is much
shorter for it), **the `EVENT_OK` regex is the whole guarantee**, now also pinned by a
test. Whole vocabulary: `delineate-XX` / `delineate-unknownstate`, `export-geojson`,
`export-kml`, `share`, `pin`, `feedback-up`, `feedback-down`. Nothing may interpolate a
coordinate; when `stateAt()` fails the label is `delineate-unknownstate`.

- **We do NOT load GoatCounter's `count.js`, on purpose.** It is a CDN script (this app
  vendors everything) and it adds fields of its own — observed sending
  `q=<location.search>` and the screen size. `countEvent()` builds the documented
  tracking pixel itself (`/count?p=&e=true&rnd=`) with `referrerPolicy = 'no-referrer'`,
  so the payload is provably exactly what the words say. **If anyone "modernizes" this
  back to count.js, the privacy note becomes false.**
- A referrer **origin** is sent (`&r=`) so embeds can be counted — inside an iframe
  `document.referrer` is the parent page. Origin only, never the path: a linking URL
  can itself be private. Own-origin and unparseable referrers send nothing.
- IP and User-Agent unavoidably reach GoatCounter, as with any HTTP request; they hash
  both with an 8-hour rotating salt and keep them in memory only. This is why the panel
  claims "nothing personal", not "nothing leaves your device".
- Feedback: a thumb only opens the note field; the count event fires on Send together
  with the Web3Forms POST, so every counted rating has a matching email. The trade,
  accepted knowingly: a thumb with no note sends nothing, so silent ratings are lost.
  hCaptcha deliberately NOT used — it fingerprints visitors.
- Verification method (re-run after any change here): load from a hostile URL
  (`?v=5&utm_source=leaktest#37.16109,-113.30259,Secret Canyon`) and confirm the only
  counting requests carry the fixed labels — no lat, lon, name, or query string. The
  suite automates the vocabulary half; the wire check is still worth doing live.
- Dev-server events DO reach the live dashboard (count.js's localhost guard went with
  it). The test suite blocks goatcounter.com, so `npm test` cannot pollute the numbers.

## localStorage

All keys namespaced `drainage:` (github.io project pages share one origin across the
account's repos). Holds: pins, basin caches (`basin:` by comid, `ssbasin:` by snapped
coords), NWS grid lookups (`grid2:`), zone geometries (`zone:`), StreamGrid layer ids,
map position, units/text-size/basemap/analytics choices. On quota, `lsSet` evicts the
bulky caches (basins, zones, grid lookups) so small precious writes still land.

Reset to a true first run (deny the geolocation prompt too, or the map jumps to the
tester's location instead of the Zion fallback):

```js
Object.keys(localStorage).filter(k => k.startsWith('drainage:')).forEach(k => localStorage.removeItem(k)); location.href = location.pathname
```

## Export / Gaia

GaiaGPS imported only the pour point from the original rich exports — the basin polygon
was dropped (user-tested 2026-08-29) despite closed rings. Both exports now **mimic
StreamStats' own downloads, which are confirmed to import correctly** (re-tested
2026-08-30): GeoJSON = FeatureCollection with top-level bbox, exactly [Point, Polygon],
flat scalar-only properties (the old array-valued `pour_point` property is the chief
suspect); KML = bare Placemarks with `<name>` and empty `<ExtendedData>`, NO
Style/styleUrl. Don't build a Gaia API integration — endpoints are unofficial.

`basinLabel()` appends " Drainage" unless the name already ends in it or starts with
"Basin", so files read "Lodge Canyon Drainage.kml" — Gaia auto-creates a folder named
after the file, which is why the filename carries the name. Area in the KML name is
km²-only regardless of the units toggle; revisit if someone complains.

KML reminders: colors are `aabbggrr` (backwards), coordinates `lon,lat`
space-separated, handle MultiPolygon + interior rings.

## Tests

Dev-only Playwright suite; the app itself has no dependencies. `npm install`,
`npx playwright install chromium`, `npm test` (~30 tests, well under a minute, and the
README documents it for contributors).

- **Fully mocked network** (`tests/mock.js`): every USGS/NWS/GoatCounter/Web3Forms
  request gets a canned response; scenario knobs (`streamstats`, `alerts`, `nldi`,
  `zone`) are live-mutable mid-test to simulate a service recovering. Nothing leaves
  the machine, so tests can't pollute the analytics dashboard and run offline.
- **Zero-refactor unit testing**: the app is one classic `<script>`, so its top-level
  `function` declarations land on `window` — `page.evaluate` can call `parseHash`,
  `sampleHourly`, `countEvent`, etc. directly. (`const` arrows like `fmtRain` are not
  reachable that way; they're covered through UI text in the flow tests.)
- **`test.fixme` convention**: a confirmed open bug gets a fixme test asserting the
  *intended* behavior — it shows as skipped, documents the repro, and starts passing
  when the bug is fixed.
- The counting test stubs `window.Image` and captures the `src` setter — records the
  exact wire request without anything reaching the live dashboard.

## Validation

Two-GET NLDI path vs the field:

| Site | lat, lon | comid | Area |
|---|---|---|---|
| Wire Pass (Buckskin) | 37.0192, -112.0246 | 18266275 | 289.8 km² |
| Paria/Buckskin confl. | 37.0710, -111.8790 | 18267057 | 1733.6 km² |
| Zion Narrows, Big Spring | 37.2870, -112.9490 | 10025820 | 742.2 km² |
| Antelope Canyon, Page AZ | 36.8640, -111.3740 | 3529041 | 245.1 km² |

Against published NWIS gage drainage areas:

| Gage | Published | Tool | Δ |
|---|---|---|---|
| 09381800 Paria R nr Kanab | 647 mi² | 647.4 mi² | +0.06% |
| 09405500 NF Virgin R nr Springdale | 344 mi² | 346.5 mi² | +0.7% (errs large, as expected) |

StreamStats exact path against the same sites: Wire Pass 289.8, Zion Narrows 744.5
(sub-percent DEM-vs-NHDPlus boundary noise), Antelope-from-its-grid-channel 239.6.

**Escalante sweep (2026-08-30), 18 GNIS-gazetteer taps across the thinnest 1:100k
coverage in the region — StreamStats returned an exact-point basin at 18/18.** The loud
red OUTSIDE warning fired only at the 4 genuinely off-channel taps (Egypt bench ×3,
Choprock Bench control); canyon-bottom taps produced 0 false red warnings. Key numbers
worth keeping (they justify warnings someone might otherwise remove):

| Site | NLDI reach km² | exact km² | ratio |
|---|---|---|---|
| Dry Fork Coyote (W) | 62.77 | 0.86 | **73×** |
| Fence Canyon (upper) | 18.81 | 0.69 | **27×** |
| Spooky Gulch (upper) | 3.60 | 0.41 | 8.7× |
| Harris Wash | 3237.44 | 2564.21 | 1.26× |

- **The second-chance StreamStats call is load-bearing, not a corner case**: 4 of 18
  sites had StreamStats decline at the tap and succeed at the NLDI snap point.
- The bench-vs-canyon warning split is analysis-side only — **do not teach the app
  about feature types**. It branches purely on snap distance, point-in-polygon and
  area; the bench taps are precisely where the shaded drainage genuinely isn't yours.
- At a confluence the GNIS "mouth" point is ambiguous (Harris Wash's mouth sits on the
  Escalante mainstem) — tap upstream of a confluence to get the tributary.
- Canyoneering names (Neon, Ringtail, Choprock Canyon, Peekaboo) are absent from GNIS
  and NHD — use Fence Canyon, Egypt, Spooky Gulch, Dry Fork Coyote Gulch, Choprock
  Bench for future validation.
- The saved "Lodge Canyon" pin coordinate (37.249,-112.949) sits ~500 m west of the
  canyon's actual NHD channel — off-radius for every delineator; tap ON the drawn
  stream.

## Phone facts (from the 2026-08-30 iPhone PWA pass)

- **The divider reserves 160 px of panel height.** Less than that put the divider
  inside iOS's bottom-edge gesture zone: grabbing it moved the app window instead, and
  only a force-quit recovered. The clamp applies on drag AND on load (rotation changes
  innerHeight, so a stored value can be out of range), floors at 20% for very short
  embeds, and the mobile hit area is a 24 px touch strip.
- `#title` uses `overflow-wrap:anywhere` — `anywhere` (not the default) is what keeps a
  single long unbroken name from overflowing the panel.
- All five action buttons fit one row at 375 px even with large text. The
  one-download-button-plus-format-prompt idea was rejected: it costs a tap and a dialog
  to save ~40 px.
- Icons for the pin-row Share/Delete buttons were tried and rejected (2026-08-31): at
  13 px beside a count, the Material share glyph reads as "`< 6`". The count has to be
  in the label (`Share 3`, `Delete 2` — a bare verb next to the per-row ✎/✕ reads as
  "act on one pin"). Don't re-icon this row.
- `prompt()` is blocked in embedded webviews — pin rename is an inline input, and the
  share buttons fall back to printing the link rather than prompting.

## Known non-bugs

Console errors seen only in a dev browser with extensions; don't hunt for these:

- `CoreLocationProvider: ... kCLErrorLocationUnknown` — the browser's own geolocation
  stack when macOS Location Services can't get a fix; cannot be suppressed from page
  JS. Decided 2026-08-31: keep the first-load auto-geolocation anyway.
- `Uncaught TypeError ... reading 'startTime' at et.reportAllChanges` — a web-vitals
  browser extension; neither symbol exists in this repo.

## Services, licensing, embedding

- USGS (NLDI, StreamStats, National Map tiles, stateServices grid) and NWS
  api.weather.gov are US-government public services — free public use, no keys, public
  domain data. OpenTopoMap (CC-BY-SA) and osm.org tiles permit light use with
  attribution (shown) but NOT high-traffic production — if the app gets embedded
  somewhere busy, drop those two basemaps or move them to a commercial provider.
- License: MIT. Vendored deps compatible (MapLibre BSD-3, Turf MIT, us-states.json
  public domain).
- Embedding: works in a plain iframe (no anti-framing headers, deliberately). Snippet
  in the README, including how embedders suppress the referrer-origin counting.

## Parked — decided against or deferred, don't re-derive casually

Phone app and stack choice; the 5-step DEM pipeline (breach-don't-fill, D8) — *the* fix
for unmapped side canyons if that becomes the core use; offline tiles; fetched
HRRR/NBM; snowmelt (SNOTEL/SNODAS); burn scars; HAND for inundation corridors;
monetization; legal posture; academic/agency contacts. Risk formulas, Flash Flood
Guidance, and the observed-QPE study were considered and **dropped entirely** — this
tool presents sourced facts (drainage, forecast, alerts), not computed risk.

The one recurring open item: **re-run the splitcatchment probe occasionally** — when
USGS deploys the fix, exact-point delineation improves automatically (guards stay).
