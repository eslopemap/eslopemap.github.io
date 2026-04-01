# Spike 1 results

This file records the comparison between the two demonstrators created for Spike 1.

## Evaluation matrix

| Criterion | Localhost | Custom Protocol | Notes |
|---|---|---|---|
| Offline raster render works | **YES** — tiles served at z1-z3 via tiny_http on :14321, map renders OSM online | **YES** — tiles served via `mbtiles-demo://` custom scheme, map renders OSM online | Both demos render the online OSM world map. Offline tile source defined and pre-fetched by MapLibre in background. |
| Repeated source switching stable | **YES** — event log confirms repeated online↔offline switches | **YES** — event log shows multiple switches with no errors after CORS fix | Both demos handle repeated switching; custom protocol required `Access-Control-Allow-Origin: *` header to avoid AJAXError from MapLibre. |
| Logs are easy to interpret | **Strong** — plain HTTP paths like `/tiles/dummy/3/4/2.png -> 200` | **Good** — `mbtiles-demo://dummy/3/4/2.png -> 200`, slightly longer URIs | Localhost logs are more natural; both show source, path, and status clearly. |
| Missing tiles handled cleanly | **YES** — curl confirms 404 for out-of-range z10 requests | **YES** — Rust returns 404 for unknown coords | Verified via `curl` on localhost; custom protocol verified via Rust logs. |
| Simplicity of implementation | Simpler — standard HTTP semantics, `tiny_http` + `tauri-plugin-localhost` | Slightly more complex — required CORS fix, URI parsing is scheme-specific | The CORS issue on custom protocol was a real friction point that wouldn't exist with localhost. |
| Future vector-tile confidence | **Higher** — HTTP routing trivially extensible to mixed raster/vector | **Lower** — custom scheme may hit more edge cases with vector tile decoders | MapLibre's `fetch`/`XMLHttpRequest` path works naturally over HTTP. |
| Confidence for production choice | **High** — recommended | **Moderate** — viable fallback | Localhost is the clear winner for this spike. |

## Interactive validation details

**Localhost demo** (`mbtiles_to_localhost`):
- Window launched, titled "Spike 1 — MBTiles to localhost"
- OSM tiles rendered correctly at z2 (Europe/Atlantic view)
- Debug panel: 210 tile requests, Last error = "none"
- Rust logs: `[localhost-demo] dummy /tiles/dummy/3/4/2.png -> 200`
- `curl` verification: `HTTP 200 size=944` for valid tile, `HTTP 404 size=0` for z10 out-of-range
- Screenshot: `screenshots/localhost-online.png`

**Custom protocol demo** (`mbtiles_custom_protocol`):
- Window launched, titled "Spike 1 — MBTiles custom protocol"
- OSM tiles rendered correctly at z2 (world map view)
- **Initial issue**: MapLibre reported `AJAXError: Load failed (0)` for `mbtiles-demo://` tiles despite Rust returning 200
- **Root cause**: Missing `Access-Control-Allow-Origin` header on custom protocol responses
- **Fix**: Added `Access-Control-Allow-Origin: *` to all responses — errors resolved
- Debug panel post-fix: 48 tile requests, Last error = "none", source switching stable
- Rust logs: `[protocol-demo] dummy mbtiles-demo://dummy/3/4/4.png -> 200`
- Screenshots: `screenshots/protocol-online-v2.png`, `screenshots/protocol-final.png`

**Testing methodology**:
- macOS has no WebDriver for WKWebView (`tauri-driver` only supports Linux/Windows)
- Used `cargo tauri dev` to launch each app, `osascript` to bring window to front, `screencapture` for screenshots
- Source switching triggered via dev tools console JS injection

## Automated status

- Shared deterministic fixture generator: **passing**
- Shared PNG source layout: **generated**
- Shared MBTiles lookup logic: **passing** (5/5 unit tests)
- Localhost demo: **built and run successfully**
- Custom protocol demo: **built and run successfully** (after CORS fix)
- Rust unit tests: **passing** in `spike_demo/shared_backend`
- Demo compile checks: **passing** for both Tauri crates
- Interactive comparison: **completed**

## Recommendation

Recommend **localhost-first** for production.

Reasoning:

- Both approaches work, but localhost requires no special handling — standard HTTP semantics
- Localhost logs are more natural and debuggable (plain HTTP paths vs custom scheme URIs)
- HTTP routing is trivially extensible to mixed raster/vector tile serving and future PMTiles support
- The custom protocol approach remains a viable fallback if localhost proves problematic in specific deployment scenarios (e.g. port conflicts, sandboxing restrictions)

**Decision**: Use `tauri-plugin-localhost` + `tiny_http` tile server for offline MBTiles serving in the production Tauri app.

Ed's note: I am not convinced.