# Spike 1 results

This file records the comparison between the two demonstrators created for Spike 1.

## Evaluation matrix

| Criterion | Localhost | Custom Protocol | Notes |
|---|---|---|---|
| Offline raster render works | Pending interactive validation | Pending interactive validation | Need to run each demo in Tauri dev mode and verify actual map rendering. |
| Repeated source switching stable | Pending interactive validation | Pending interactive validation | Debug panel is implemented in both demos. |
| Logs are easy to interpret | Expected: strong | Expected: moderate | Localhost produces plain HTTP paths; custom protocol behavior depends on WebView/MapLibre interaction. |
| Missing tiles handled cleanly | Implemented with 404 responses | Implemented with 404 responses | Rust helpers return 404 for unknown tilesets or missing coordinates. |
| Simplicity of implementation | Simpler operational model | Slightly more coupled to WebView protocol handling | Localhost uses regular HTTP semantics. |
| Future vector-tile confidence | Higher | Lower pending proof | HTTP routing is more obviously extensible to mixed raster/vector serving. |
| Confidence for production choice | Localhost-first pending render validation | Fallback-only pending render validation | Matches the architecture recommendation unless the custom protocol performs materially better. |

## Automated status

- Shared deterministic fixture generator: implemented
- Shared PNG source layout: generated with `python3 tests/fixtures/tiles/build_dummy_mbtiles.py`
- Shared MBTiles lookup logic: implemented
- Localhost demo scaffold: implemented
- Custom protocol demo scaffold: implemented
- Rust unit tests: passing in `spike_demo/shared_backend`
- Demo compile checks: passing for both Tauri crates via `cargo check`
- Interactive comparison run: pending

## Recommendation

Recommend **localhost-first** at this stage.

Reasoning so far:

- it keeps offline tile delivery on ordinary HTTP semantics
- it is easier to reason about MIME types, logging, and future cache instrumentation
- it is a better fit for later MBTiles + PMTiles + vector tile expansion

This recommendation should be confirmed by running both demos and completing the interactive validation checklist.
