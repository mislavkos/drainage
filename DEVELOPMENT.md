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
- **A route is an input affordance, not a second delineation path** (2026-09-02). Tracing
  a canyon, or importing its KML/GPX and picking a section, resolves to ONE lat/lon which
  then goes through the fragment exactly like a tap — both end at `useRoute()`.
  `delineate()` and everything downstream never learned either mode exists. See "Two ways
  to a pour point" for why the other vertices are not used, why the route stays out of the
  share link, why the pick is a user-facing dropdown rather than a name/colour classifier,
  and why a ropewiki URL cannot be fetched.
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

## Two ways to a pour point: tracing and importing (2026-09-02)

The problem, raised by a beta reader and real: **people tap where they drop in.** A
drainage is computed at one point, so a tap at the top of the technical section misses
every tributary joining below it — and the error direction is *understating* the water,
which is correction #2's direction. The right tap is the bottom of the technical section,
just upstream of the confluence you walk out at, and nothing in a bare map says so.

Rejected first, and don't re-derive them:

- **"Move the pour point downstream automatically."** How far? There is no answer. Lower
  point, bigger drainage, all the way to Lake Powell. This is exactly the NLDI-vs-exact
  gap that the whole StreamStats path exists to close (73× at Dry Fork Coyote W), so
  building deliberate drainage inflation back in would undo it, and it would hurt the
  users who *do* tap correctly the most.
- **A "move me downstream" tick, on by default.** Same inflation, now with a setting.
- **A first-run instruction panel.** People don't read them, and it's a lie by omission:
  it can't verify that they did it.

What shipped instead: **trace the canyon, delineate at the trace's bottom end.** Two ways
to a pour point, one code path after it.

- **The line is NOT an input to the delineation.** The catchment of the bottom point
  already contains the whole route and every confluence along it, so there is nothing to
  compute from the other vertices. `finishDraw()` resolves the trace to one lat/lon and
  hands it to `goTo()` — the same function a tap uses — so it arrives through the
  fragment with the back button, the coordinate tolerances and the share links intact.
  Do not give the polyline a delineation path of its own.
- **The bottom end is the LAST vertex, chosen by trace direction, not by elevation.**
  You trace a canyon the way you walk it. The alternative — an elevation lookup per
  vertex (`epqs.nationalmap.gov`) to find the low end regardless of direction — buys a
  new, famously flaky service dependency for something the containment check below
  already surfaces loudly. Comparing the two ends' *drainage areas* (the downstream one
  is bigger by definition) is the theoretically correct pick and was also rejected: it
  needs two full delineations before the answer, inside the app's documented main bug
  factory, to decide something the user already told us by tracing downhill.
- **The containment check is the whole reason to have a line.** Everything upstream of
  the pour point is inside the basin by construction, so a vertex OUTSIDE it means the
  snap found the wrong channel, or the line was traced bottom-to-top — which puts the
  pour point at the TOP and understates the drainage. One Turf point-in-polygon per
  vertex in `renderBasinInfo()` catches both, and the majority-outside case names the
  backwards trace explicitly, because that is the dangerous one. **One** point outside is
  normal and says nothing: the last vertex IS the pour point and sits ON the boundary.
  The minority case is a `note`, not a `warn` — a route that leaves the drainage on the
  walk out is a real and correct thing to see.
- **The trace is not in the share link.** Encoding N coordinates in the fragment for
  something the recipient's own delineation reproduces from the pour point alone would
  contradict "Share the pour point, not the polygon" for no gain. Same reason it isn't in
  the GeoJSON/KML exports: those mimic StreamStats' `[Point, Polygon]` shape exactly
  because that is what Gaia is confirmed to import, and a third feature reopens a
  user-tested bug.
- **A plain tap clears the trace** (`clearRoute()` in the click handler). The tap moves
  the pour point somewhere the old line no longer describes, so leaving it drawn would
  render a route and a basin that have nothing to do with each other.
- **Draw mode is a button that toggles, not a persistent mode radio.** Default is the
  direct tap; the button arms tracing and its own label becomes "Done — n points", which
  is the finish control on a phone where there is no Enter key. `doubleClickZoom` is
  disabled while tracing (a quick double tap would otherwise zoom the map out from under
  the vertex) and re-enabled by `endDraw()` on every exit — including Escape and Clear.
- **Locked mode needs no code for this.** `html.locked #panel { display: none }` takes
  the button with it, and the click handler's `if (locked) return` already stood.
- No About-panel bullet, per the documented default. The README carries the how-to.

### Importing a canyon's KML / GPX

Same `route`, same `useRoute()`, same containment check — the file only has to fill the
array. What took the work was deciding which part of the file is the canyon. Four things
were measured on ropewiki's real Keyhole export before any of it was written:

1. **The files carry no elevation.** Every GPX `<ele>` is `0.000`; every KML coordinate
   ends in `,0`. The "a dropped track can read its own low end" plan written in this file
   on 2026-09-02 was wrong and is retracted — elevation has to be fetched.
2. **USGS 3DEP samples a whole route in one CORS-open request**, 1 m resolution:
   `elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples`
   with `geometryType=esriGeometryMultipoint`. 110 vertices, one GET, `ACAO: *`. Points
   outside coverage come back missing or `"NoData"` — must read as null, because a zero
   would look like sea level and win every ranking.
3. **Taking the route's lowest point is catastrophically wrong.** Keyhole's global minimum
   sits in the EXIT walk, down by Clear Creek, because the exit drops through the highway
   tunnel below the canyon's own outflow. Delineated: **64.84 km² there against 3.42 km²**
   at the true bottom of the technical section. **19×** — the systemic inflation the whole
   StreamStats path exists to remove, re-entering through the front door. Never pick the
   global minimum.
4. **The error being fixed is much smaller than the error available.** Keyhole reads
   3.00 km² tapped at the top of the technical section and 3.42 km² at the bottom: **+14%**.
   (The 73× in "Validation" is NLDI-vs-exact, an unrelated failure.) So when the pick is
   uncertain it must stay HIGH. Overshooting is not the safe direction here.

What ships: **rank the segments by measured net descent, pre-select the steepest, let the
user change it in one click.** For Keyhole that lands on "Class 3 Section", whose low end
is exactly the bottom of the technical part, from both the KML and the GPX (byte-identical
results: `37.22525,-112.90285`, 3.42 km²).

- **Don't classify by name or colour.** Colour is a real signal — Keyhole's two technical
  segments are both `#A52714` while approach/connector/exit are green/olive/yellow, and
  the Google MyMaps style id even embeds the RGB — but **GPX drops styles entirely**, so a
  colour rule would work on half the inputs. Names are worse: "Class 3 Section" here,
  something else everywhere. Segment *structure* is the only thing both formats always
  carry, so that is what the UI exposes.
- **The numbers in the picker are what make it usable.** A segment labelled `Track 003`
  with `↓ 138 ft` over `808 ft` is self-evidently the descent. That is why the label
  carries length and drop, and why the heuristic doesn't have to be trusted.
- **Two elevation samples per segment, not every vertex.** Endpoints reproduce the
  full-profile net-drop ranking exactly (checked against all 110 of Keyhole's vertices:
  −41.7 / +12.2 / −9.7 / +42.1 / −2.9 m), and on a *descending* segment the low end IS an
  endpoint — only the approach and exit dip below theirs, and those are what the ranking
  discards. Marked `ponytail:` in the code with the upgrade path.
- **No elevation means no guess.** If 3DEP fails or returns nothing rankable, nothing is
  pre-selected, nothing is delineated, and the note says to pick the section. A silently
  wrong pour point is the exact failure this feature exists to prevent.
- **`fmtDist` must not be used for a drop.** It switches to miles above 305 m, so a 400 m
  descent would read "0.25 mi". `fmtElev` is feet/metres only.
- **No new analytics label.** `delineate-XX` already fires from `renderBasin()`; the
  import path adds nothing to the wire, so `EVENT_OK` and the Privacy bullets are
  untouched. Keep it that way — a `import-kml` label would make the enumerated promise
  false in two files.
- Names and filenames from the file reach the DOM by `textContent` only, and the parse is
  bounded (`MAX_SEGS` 60, `MAX_PTS` 40 000, `MAX_FILE` 8 MB) even though the bytes are
  local. Tag lookups go through `getElementsByTagNameNS('*', …)`: KML and GPX both
  default-namespace their root and some writers emit prefixed elements.
- **The document-level `drop` handler early-returns on `locked`.** A beta embed's pour
  point comes from the URL; a reader dropping a file on it must change nothing.
- Fixtures `tests/fixtures/canyon.{kml,gpx}` are built against mock.js's synthetic terrain
  (north = higher, 100 m per 0.01°) and deliberately reproduce Keyhole's shape: the
  global low point sits in the Approach/Exit, so the test fails if anyone "simplifies" the
  pick to the route minimum.

### Validation of the descent pick (2026-09-02, 178 canyons)

Validated on ONE canyon at first, which was not enough — the second canyon class it met
broke it. Corpus: **178 real ropewiki KML files** recovered from the Wayback Machine
(`web.archive.org/cdx/search/cdx?url=ropewiki.com/images*` → `…/web/{ts}id_/{url}` for the
unmodified bytes; the live site is challenged, see below). Every file was run through the
**shipped** code with 3DEP live and USGS/NWS stubbed. Scored by the segments' NAMES, which
the ranking never reads — so the labels are free, independent ground truth. Ambiguous names
count as failures, which makes the pass rate conservative.

**The failure ranking-by-total-drop had, and why:** a **car shuttle or access road descends
more than the canyon it serves.** 17 of 124 scored files picked one — "Drive", "Dirt Road",
"Rimrock Shuttle", "Skyline Shuttle", "Approach Brennan Shuttle". Keyhole's file has no
shuttle track, so one canyon could never have shown this.

**The fix, and why it is not a name rule:** roads are graded, canyons are not. In this
corpus the technical sections run 11–23% (Keyhole 11, Deer Creek 16, Water Canyon 16–23,
Birch Hollow 18) and the offending shuttles 1–5%. `MIN_GRADE = 0.08` is above sustained
road grade and well below any real canyon here. Thresholds measured, not guessed:

| ranking | pass | fail | asks user |
|---|---|---|---|
| max drop (first version) | 107 | **17 (14%)** | 21 |
| max gradient, any length | 114 | 22 (16%) | — |
| max drop, gradient ≥ 5% | 106 | 12 (10%) | 29 |
| **max drop, gradient ≥ 8%** | **111** | **9 (8%)** | **32** |
| max drop, gradient ≥ 12% | 101 | 8 (7%) | 50 |

Reproducible without re-running a browser: `tools/canyon-corpus.txt` is the archive
manifest, `tools/canyon-corpus.py fetch` re-downloads the KMLs to a local directory, and
`tools/canyon-corpus.py compare` re-prints this table from `tools/descent-pick.tsv` (the
coordinate-free per-section data — name, length, drop, gradient, what was picked). **The
KMLs are deliberately NOT in this repo**: ropewiki content is CC-BY-NC-SA 3.0 and this repo
is MIT, so NonCommercial collides with MIT's commercial grant and ShareAlike would pull the
whole repo with it. Fetching from archive.org for measurement is fine; re-hosting is not.
The compare is an offline mirror of the ranking and its counts differ by a file or two from
the table above, which came from the real app over all 178 (see the script's header).

Ranking by *gradient alone* is worse than by drop — it favours a short steep connector. A
softer "gate, else fall back to max drop" was measured at +6 right and +2 wrong with more
code; rejected, because "ask the user" is already built, costs one click, and shows the
name, length and gradient needed to choose. The 32 asks are genuinely low-gradient slots
(Orderville 1–3%, Zebra 2–5%) — the app declines to guess rather than guessing wrong.

**Against the author's own pins**, with real StreamStats delineation at both points:

| canyon | picked vs pinned | area ratio |
|---|---|---|
| Deer Creek (MRNP) | 5 m apart | 1.00× |
| Keyhole | 236 m apart | 1.02× |
| Water Canyon | 1 550 m apart | 0.86× (picks higher — the *understating* direction, the one to watch) |
| Birch Hollow | **24 m apart** | **15.04×** (4.03 → 60.59 km²) |

**Birch Hollow is the finding that matters, and it is not a ranking error.** Two points
24 m apart delineated 4.03 km² and 60.59 km², because the bottom of that technical section
sits AT the Orderville confluence: one point snaps to Birch Hollow's own channel, the other
to the Orderville mainstem. This is the confluence ambiguity already noted under
"Validation" ("tap upstream of a confluence to get the tributary") — except this feature
deliberately aims the pour point at the bottom of the technical section, which is *exactly*
the most snap-ambiguous place on the route. Consequences, and why nothing was added:

- Both answers are defensible for their own spot. Standing at the confluence, 60 km² of
  Orderville really is what can arrive; standing in the slot, 4 km² is yours.
- The error direction is **overstating**, which is the safe one. No warning currently fires
  for it (the tap is inside the basin, the snap is short, the area is not small).
- **The fix is UNDECIDED as of 2026-09-02** — deliberately open, not forgotten, and not
  to be settled casually. Three shapes were considered:
  1. *Nudge the pour point upstream by a fixed distance.* **Rejected.** A fudge factor that
     systematically understates — the dangerous direction — and "100 m" is half the canyon
     on a 200 m technical section.
  2. *Detect the jump and warn.* Delineate a second time ~25% back up the chosen section
     and compare; a ratio over roughly 3× means the pour point is below a confluence. One
     extra StreamStats call, parallel to the existing one, so wall-clock barely moves.
     **Confirmed to catch this case** by the measurement above: 60.59 vs 4.03 km² is 15×,
     and Keyhole's honest growth across its whole technical section is only 1.14×
     (3.00 → 3.42), so the two regimes are far apart. The 3× threshold is a guess and
     would need measuring on ~15 canyons whose route bottom is a known confluence first —
     picking a constant from two data points is exactly how MIN_GRADE came out wrong the
     first time.
  3. *Show both numbers instead of calling one an error.* The two areas answer two real
     questions: 60.6 km² is what can arrive at the exit where you stand in Orderville,
     4.0 km² is what is above you while committed in the slot. This is only possible
     because a route exists — a bare tap gives no upstream point to compare against, since
     nothing says which way is up-canyon. A genuine feature, including a decision about
     which basin the rain timeline and alerts run against (the larger, erring safe).
- Not specific to importing: a manual trace carries the same exposure, and so does a plain
  tap at a canyon mouth. Import merely aims there deliberately and every time.

### Why the app does not fetch a ropewiki URL

Asked for, and measured as impossible from a static page (2026-09-02). **Ropewiki sits
behind a Cloudflare managed challenge**, including on the track files themselves. Ropewiki
hosts them at a MediaWiki upload path — not Google MyMaps, despite the KML being
MyMaps-authored — and that exact URL is challenged:

```bash
curl -sI -H 'Origin: https://mislavkos.github.io' \
  'https://ropewiki.com/images/b/bb/Keyhole_Canyon_%28Zion_National_Park%29.kml'
# HTTP/2 403 · cf-mitigated: challenge · content-type: text/html  (the "Just a moment..." page)
```

`cf-mitigated: challenge` is Cloudflare saying so outright. The CORS **preflight** is 403
too, and no variant sends any `access-control-*` header, so it fails before CORS is even
reachable; the `.gpx` twin at the same path is identical. A real Chromium tab also gets the
interstitial, and `fetch()` from the app's own origin fails for the page and for
`api.php?…&origin=*`. Only `/robots.txt` and `/favicon.ico` clear it (the favicon even
sends `ACAO: *` — Cloudflare's own managed exemptions, not a static-asset rule); `/images/`,
`/api.php`, `/load.php` and `/index.php` are all challenged. **Don't re-derive this by
guessing paths — the file URL above is the one that matters.**

So even if CORS appeared, what came back would be the challenge page. Making it work needs
a server that passes the challenge — a backend, against the first decision in this file —
and it re-breaks whenever Cloudflare tightens. Ropewiki also publishes
`Content-Signal: search=yes, ai-train=no, use=reference` in robots.txt: an app fetching
their volunteer infrastructure on every user's behalf is what that posture is aimed at.

The two paths that do work: the user downloads and drops the file themselves (shipped), or
ropewiki embeds `?locked#lat,lon,name` on the canyon's own page — they know their pour
point better than any heuristic here. That is a conversation with ropewiki, not code.

**What their robots.txt does NOT say** (corrected 2026-09-02 — this file briefly claimed
otherwise). Ropewiki publishes `Content-Signal: search=yes,ai-train=no,use=reference`, and
that is *not* a statement about apps downloading files. Every signal in the vocabulary is
scoped to search indexing or AI consumption — their own robots.txt defines `use` as "how
AI systems may consume the content" — and `ai-input` is left unspecified, which the policy
text in that same file says "neither grants nor restricts." The `User-agent: *` block
carries `Allow: /`; the `Disallow: /` blocks name AI crawlers (Amazonbot,
Applebot-Extended, Bytespider). So do not cite Content-Signal as the reason this feature
doesn't exist. The reason is `cf-mitigated: challenge`, which settles it technically. The
only other argument is load on volunteer infrastructure at app scale — a courtesy call
made here deliberately, not a restriction ropewiki stated.

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

Genuinely open, both deliberately: **the confluence jump at a route's bottom end** (see
"Validation of the descent pick" — three candidate fixes, one rejected, threshold
unmeasured; the author is deciding), and **re-run the splitcatchment probe occasionally** — when
USGS deploys the fix, exact-point delineation improves automatically (guards stay).
