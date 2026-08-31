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
- **Unpublished spots are marked by a leading `Ω` in the name, not by a stored flag**
  (2026-08-31, user's own convention from code). The marker then rides along through the
  fragment, share links, export filenames, KML titles and the recipient's saved pins for
  free, and there is no second piece of state that can drift out of sync with the name.
  `isUnpub`/`bareName`/`UNPUB` are the only places that know the sigil. Consequences,
  all accepted: an unnamed spot can't be marked without becoming named (`Ω` alone, which
  `label()` renders as `Ω lat, lon`); renaming a pin can strip the marker; and the
  saved-pin sort compares `bareName` so the Ω block is alphabetical inside itself. The
  share hurdle is a `confirm()` in front of *both* share paths (`okToShareUnpub`) — the
  point is only to stop the accidental share, never to prevent a deliberate one.
- **"About this app" stays short. A new feature does not automatically earn a bullet**
  (2026-08-31 — the pasted-coordinate and UTM bullets were added with those features and
  removed by the user shortly after; the features stayed). That panel is read by someone
  at a trailhead deciding whether to trust a shaded polygon, not by someone auditing the
  release notes, and every bullet added dilutes the ones that matter. A bullet earns its
  place only if *not* knowing it would make a reader misread the map or miss a safety
  caveat. Input tolerances, keyboard tricks, URL parameters and other how-to detail go in
  the README instead — it has room and the right audience. When adding a feature, the
  default is **no About change**; adding one is the decision that needs justifying.
- **Pasted coordinates are read forgivingly, then the URL is rewritten** (2026-08-31).
  `parseHash` accepts spaces for the comma, degree signs, parens, a unicode minus, and
  falls through to `parseUtm` when the pair is out of lat/lon range (327065 is not a
  latitude, so the two forms can't collide). Whitespace separates lat from lon *only* —
  everything after the next comma is the name, which legitimately holds spaces and
  commas. DMS is deliberately **not** parsed: invalid beats a silently wrong decimal.
  `routeFromHash` canonicalizes the fragment to `#lat,lon,name` on every entry, because
  Share copies `location.href` and a tolerated paste would otherwise ship its `%20`s.
- **UTM in 20 lines, not proj4** (2026-08-31). `utmToLatLon` is the Snyder USGS PP 1395
  inverse series on WGS84; a 40 KB projection library for the one projection anyone
  pastes is not worth it. Validated three independent ways (see "Validation"). The zone
  is usually missing from pasted beta, so the **map's current view supplies it** — right
  whenever you're looking at the ground the coordinates came from, and the note under
  the status line says which zone was assumed, because a wrong zone lands ~450 km
  sideways. Northern hemisphere only (every service here is US-only); a southern
  latitude band (`C`–`M`) is refused rather than placed 10 000 km away.
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

- `name` renders via `textContent` only; lat/lon must contain **digits** (**`Number('')`
  is 0** — a blank field would delineate Null Island, and the range check alone can't
  catch it because 0,0 is valid), and be finite and in range. A malformed percent-escape
  (links get truncated by messaging apps) reads as invalid instead of throwing.
- The UTM path is bounded before it projects: zone 1–60, easting 100 000–999 999,
  northing ≤ 9 500 000, then the same lat/lon range check on the result. It writes
  nothing to storage — worst case is a fragment that delineates the wrong valid point,
  which the note under the status line and the map jump both make visible.
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
`export-kml`, `share`, `pin`, `locked`, `open`, `feedback-up`, `feedback-down`. Nothing
may interpolate a coordinate; when `stateAt()` fails the label is `delineate-unknownstate`.
Adding a label means editing the Privacy bullet in `index.html` AND the README line that
mirrors it — the promise *enumerates* the event types, so a new label silently makes both
false. `locked` and `open` (2026-08-31) were added that way.

`locked` (fires once per locked load) and `open` (the click through to the full app) are
**both** needed and neither derives from the other: `delineate-XX` records that a lookup
happened and nothing about the mode, and `open` is a lower bound with an unknown floor —
permanently zero under `open=0`, and most readers never click it. `locked` carries
strictly less than `delineate-XX` already does: no state, no coordinate.

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
`npx playwright install chromium`, `npm test` (~36 tests, well under a minute, and the
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
- **Don't assert against the analytics cache-buster.** `countEvent` appends a random
  `rnd=`; the "never a coordinate" test strips it before matching `/37|112/`, or a
  random `37` fails the suite about one run in eight (fixed 2026-08-31).
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

UTM inverse (`utmToLatLon`), validated 2026-08-31 three ways that don't reuse its own
output — a projection that is 450 km wrong is indistinguishable from a right one on a
zoomed-out map, so "it looks like Zion" is not validation:

1. **Invariants**: `utmToLatLon(31, 500000, 0)` returns exactly `[0, 3]` — easting
   500 000 is the central meridian by definition, northing 0 the equator.
2. **Meridian arc by quadrature**: on the central meridian the northing is purely the
   meridian arc, so `N/k0 = 4 124 604.842 m` was inverted to a latitude by numerically
   integrating the meridional radius of curvature (400 k steps, bisection). Independent
   result `37.2531434756` vs the series' `37.2531434748` — agreement to ~0.1 mm. This is
   the value the unit test asserts.
3. **Round-trip through an independent forward series**: Snyder's *forward* series (a
   different formula set) reprojected the off-meridian answer
   `37.23709162, -112.94958113` back to zone 12 and returned `327064.99998, 4122955.00001`
   — 1.6 cm out, i.e. floating-point noise.

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

### Locked mode (`?locked`)

Added 2026-08-31 for beta sites (ropewiki and the like) that embed one canyon's drainage
in that canyon's own page. There, a re-tappable map is a liability: every other point
draws a *different* canyon.

- **The pour point stays in the fragment.** `?locked#lat,lon,name` — no new coordinate
  parser, no second code path. Every share-link tolerance (pasted decimals, UTM,
  canonicalization) comes along free, and `#pins:` links still work if one is passed.
- **`locked`, not `embed`.** A plain iframe with no query string keeps the full app, and
  that is a supported configuration — so the flag names what it does (one fixed pour
  point) rather than where it runs.
- **Sub-flags default ON** (`forecast`, `alerts`, `open`; `=0` switches one off). An
  embedder who writes only `?locked` gets the safety-relevant content. Opt-in defaults
  would mean a forgotten `forecast=1` silently ships a map with no rain data.
- **Everything MOVES, nothing is re-rendered.** The bootstrap at the bottom of the script
  reparents `#status`, `#basin-info`, the two `<h2>`s and `#forecast` / `#alerts` /
  `#alerts-link` into `#lockbar`. `delineate()`, `renderForecast()` and `checkAlerts()`
  address them by id and never learned this mode exists. Do not replace this with a
  second rendering path.
- **Alerts sit ABOVE the chart**, the reverse of the panel's order: the bar is height-
  capped and scrolls, and a live Flash Flood Warning must not be below 48 h of chart.
- **Two things locked mode cannot hide**, both for the same reason — a beta page is read
  as authoritative and a silent wrong answer is the dangerous one:
  - the `.err` status line, so a failed delineation still says UNKNOWN-not-empty. CSS
    hides `#status:not(.err)`; the idle "Tap a point…" would be a lie here anyway.
  - the ⚠ lines from `renderBasinInfo()` (CSS keeps `#basin-info > .warn`, drops the
    rest). The NLDI-fallback caveat normally lives in the *status* line, which this mode
    hides — so `renderBasinInfo()` grows a `locked && !cur.exact` warn to carry it. That
    branch exists ONLY because the status line is gone; don't "simplify" it away.
- **Off means no request.** `renderForecastLinks()`, `checkAlerts()` and
  `renderHazardsLink()` early-return on their flag, so a switched-off section costs NWS
  nothing. `moveend` skips the `lastCenter`/`lastZoom` writes: browsing a wiki full of
  embeds must not move the reader's map in their own copy.
- **The "Open in Drainage" link degrades, it does not detect.** A sandboxed iframe
  without `allow-popups` kills `target="_blank"` silently — no error, no event, the link
  just does nothing. That flag is *not* detectable up front: an opaque origin
  (`window.origin === 'null'`) betrays `sandbox` only when `allow-same-origin` is also
  missing, and with it the frame looks entirely normal from inside. A speculative
  `window.open()` probe would flash a real popup for everyone who is *not* blocked. So
  the click handler takes the click and treats `window.open` returning null as the
  detection, falling back to "Copy this link: <url>" (the same fallback the share button
  uses when the clipboard is refused). `href` is left intact so right-click → copy still
  works. Do not replace this with sandbox sniffing.
- **`?pane=top|bottom|left|right`** (default `bottom`, added 2026-09-01). A wide, short
  embed wants a vertical strip, not a horizontal band. Four CSS rules on
  `html.pane-<edge> #lockstack`; the size cap moved from `#lockbar` to the stack so a
  left/right column can fill the height and still scroll inside (`#lockbar` needs
  `min-height: 0` or the flex child refuses to shrink and overflows instead).
- **The fit pads around the pane; it does not centre by hand.** `fitBounds` already takes
  per-side padding, so `fitPad()` returns `{top,bottom,left,right}` with the pane's own
  side raised by its measured size — that is the whole feature. Padding at or above the
  map's own dimension leaves `fitBounds` nothing to fit into, so the padded side is capped
  at 60% of that axis; on an embed too small to hold both, some overlap is the accepted
  outcome. The same function publishes `--pane-w` / `--pane-h`, which the CSS uses to push
  `#basemaps` and the zoom control clear of whichever edge the pane took.
- **The re-fit is a `ResizeObserver`, guarded by `userPanned`.** Forecast and alerts land
  seconds after `renderBasin()` fits, so the first fit pads for a pane that has not grown
  yet; observing the stack catches that and frame resizes too. `userPanned` is set from
  `movestart` only when `e.originalEvent` exists — our own `fitBounds` never sets it, so
  the map stops re-fitting the instant a reader takes it, and their pan is never undone.
  A test drives a real mouse drag for this; a programmatic `panBy` carries no
  `originalEvent` and would pass the test while proving nothing.
- **`#lockstack` sits at `bottom: 26px`, not 0** — the MapLibre attribution and scale row
  is below it and has to stay visible (OSM and OpenTopoMap require attribution).
- The chart SVG is one `viewBox` scaled to its container; at full embed width it renders
  cartoon-sized, hence `#lockbar #forecast svg { max-width: 420px }`.
- `#lockbar:not(:has(h2, .err, .warn))` suppresses the empty white strip when everything
  is off and nothing is wrong. Browsers without `:has()` drop the rule and keep the strip
  — cosmetic only.
- Covered by `tests/locked.spec.js`, including the two must-not-hide cases and a
  regression test that the no-query-string full app is untouched.

## Parked — decided against or deferred, don't re-derive casually

Phone app and stack choice; the 5-step DEM pipeline (breach-don't-fill, D8) — *the* fix
for unmapped side canyons if that becomes the core use; offline tiles; fetched
HRRR/NBM; snowmelt (SNOTEL/SNODAS); burn scars; HAND for inundation corridors;
monetization; legal posture; academic/agency contacts. Risk formulas, Flash Flood
Guidance, and the observed-QPE study were considered and **dropped entirely** — this
tool presents sourced facts (drainage, forecast, alerts), not computed risk.

The one recurring open item: **re-run the splitcatchment probe occasionally** — when
USGS deploys the fix, exact-point delineation improves automatically (guards stay).
