# Drainage

Tap a point on a topo map and see the drainage area that feeds it — plus a 48-hour rain forecast for the worst spot in that basin, and any active NWS alerts touching it.

**Live: https://mislavkos.github.io/drainage/**

Built for one question: "I'm heading down this canyon — will it flash?"

## Run locally

You can run a clone locally on your device. Fully functional.

```
python3 -m http.server 8137
```

Open http://localhost:8137. Don't open index.html as a `file://` URL: the browser blocks the page's own fetch of `vendor/us-states.json`, which silently disables the StreamStats path and the snappable-streams overlay while the rest of the app still appears to work.

No build step, no backend, no accounts. One static HTML file plus vendored libraries (MapLibre GL, Turf).

## Run the tests

The app itself has no dependencies; the test harness (dev-only) uses [Playwright](https://playwright.dev) against a fully mocked network — no USGS/NWS call ever leaves the machine, so tests are fast, deterministic, and safe to run offline.

```
npm install
npx playwright install chromium
npm test
```

`tests/unit.spec.js` pins the pure functions (hash parsing, NWS resampling, the analytics vocabulary). `tests/flows.spec.js` replays whole user flows — delineation on both the StreamStats and NLDI paths, zone-based alerts, pin import/export, feedback — against canned service responses in `tests/mock.js`. Tests marked `fixme` are confirmed open bugs: they document the intended behavior and start passing when the bug is fixed.

Contributing or just curious why the code is the way it is? [DEVELOPMENT.md](DEVELOPMENT.md) records the design decisions, the USGS/NWS service quirks, and the field-validation results behind the app.

## Embed it

The app is one self-contained page and sends no anti-framing headers, so it drops into any site as an iframe:

```html
<iframe src="https://mislavkos.github.io/drainage/"       style="width:100%;height:600px;border:0"       allow="geolocation; clipboard-write"       title="Drainage"></iframe>
```

`allow="geolocation"` lets first-load "center on my location" work inside the frame;
`clipboard-write` lets the copy-share-link button work. Everything else needs no changes.

**Note:** when the app is framed, its usage counter records the origin of the embedding page — domain name only, not the full path. That is how embeds get counted at all. Set `referrerpolicy="no-referrer"` on the iframe if you would rather it didn't.

## How it works

- Tap the map. The point snaps to the nearest mapped stream, and USGS returns the upslope area that drains to it — from [StreamStats](https://streamstats.usgs.gov) where it can, falling back to [NLDI](https://waterdata.usgs.gov/blog/nldi-intro) where it can't.
- When the NLDI fallback is used, the drainage is delineated from the next downstream confluence instead of the stream point closest to you. This can dramatically inflate the drainage area, because it includes ground below you, not just above.
- The rain chart covers the next 48 hours, hour by hour. Each hour shows the wettest forecast among several spots spread across the basin (NWS data), in the basin's own timezone.
- Active [NWS](https://www.weather.gov/documentation/services-web-api) alerts are checked against the basin's actual shape — including zone-based alerts that carry no geometry of their own (most Flood Watches).
- Share links (`#lat,lon,name`) recompute the same drainage on the recipient's device.
- Tick saved pins to share or delete several at once. A multi-pin link (`#pins:lat,lon,name;…`) asks the recipient before adding them to their saved pins, skips any they already have, and delineates the first either way.
- Export the basin as GeoJSON or KML for GaiaGPS, CalTopo, or Google Earth.

### Where the data comes from

Everything is a free, keyless US government service; nothing here is computed by me.

- **USGS [StreamStats](https://streamstats.usgs.gov)** — the first choice for both snapping your tap to a channel and delineating the drainage above it, from a 10 m elevation model. It only snaps within a few tens of meters of a channel it knows.
- **USGS [NLDI](https://waterdata.usgs.gov/blog/nldi-intro)** — the fallback for both steps, using an older and coarser stream map. Its drainage runs to the next downstream confluence rather than to your point, so it can be much larger than your actual basin. The app says so when this happens.
- **[NWS](https://www.weather.gov/documentation/services-web-api)** (`api.weather.gov`, part of NOAA) — the hourly rain forecast and the active alerts.

### The remaining external services

- [GoatCounter](https://www.goatcounter.com/) — Light usage analytics. See privacy details below.
- [Web3Forms](https://www.web3forms.com/) — Feedback form.

## Privacy

- **No account, no cookie, no login, and no backend.** The app is a single static HTML file. The only servers involved are the outside services listed above, and every request the app makes happens in your browser, where you can inspect it.
- Your tap coordinates go to USGS, and points inside the drainage go to NWS. That is how the drainage and the forecast get calculated. **None of it comes to me.**
- Share links put the coordinates after a `#`, which browsers never send to any server.
- Basic anonymized usage counting is on by default and can be switched off in the app's "About this app" section. It records that a lookup, export, share or pin happened, when it happened, the domain name of the page that linked to or embedded the app (never its path), and, for a lookup only, which US state. Nothing else, and never a coordinate.
- Counting uses [GoatCounter](https://www.goatcounter.com/help/privacy), which is cookieless. As with any web request it receives an IP address and browser string; it hashes both with a salt that rotates every 8 hours, keeps them in memory only, and never shows them to me.
- Feedback is sent using [Web3Forms](https://web3forms.com/privacy) only when you type a note and press Send. It carries your rating, your text, and the drainage you were looking at **(only if you leave that box ticked)** — the exact values are shown to you before you send.

## Read this before trusting the app's results

- Drainage shapes come from a 10 m elevation model and ~1:24,000 stream maps where StreamStats can answer, and from ~1:100,000 maps where it falls back to NLDI. Small side canyons often aren't mapped separately, and snapping only reaches a few tens of meters — tap directly on a stream line, not near it. The app warns when your tap lands outside the returned basin or far from a mapped stream.
- Basins err large, which is the safe direction — but on the NLDI fallback path they can err *very* large. That basin runs to the next downstream confluence rather than to your point, which measured 73× the true area at one small canyon I tested. The app warns when this happens; take the number as an upper bound, not an estimate.
- **"No active alerts" does not mean safe.** Antelope Canyon 1997 had no warning. This tool shows sourced facts — drainage, forecast, alerts. The judgment is yours.

## License

[MIT](LICENSE).
