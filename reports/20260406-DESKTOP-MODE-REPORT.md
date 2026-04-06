# Desktop Mode Integration Report

## Summary

Refactoring the Slope web app into a dual web+desktop codebase using Tauri v2, based on validated spike demos (Spike 1: localhost tile serving, Spike 2: file-centric GPX sync).

## Approach

- **Single codebase**: same `app/index.html` serves both browser and Tauri WebView
- **Thin adapter**: `app/js/tauri-bridge.js` detects runtime and routes calls
- **Reuse spike code**: `gpx_sync_backend` and `shared_backend` crates refactored into `src-tauri/`
- **Test-first**: JS unit tests for bridge, Rust unit tests for backend, web e2e sanity check

## Progress Log

### Phase 1: Scaffold + Bridge ✅

- [x] `src-tauri/` scaffold: Cargo.toml, tauri.conf.json, capabilities, build.rs, main.rs
- [x] `app/js/tauri-bridge.js` runtime adapter with lazy global reads
- [x] 14 JS unit tests for bridge (web mode + desktop mode)
- [x] `cargo build` compiles clean (1 harmless dead_code warning)
- [x] `cargo tauri dev` launches app: tile server on :14321, WebView loads frontend

### Phase 2: GPX Sync Backend ✅

- [x] `src/gpx_sync.rs` — refactored from spike_demo/gpx_sync_backend (15 Rust unit tests)
- [x] Tauri commands: pick_and_watch_folder, list_folder_gpx, load_gpx, mark_dirty, save_gpx, accept_change, resolve_conflict, get_snapshot
- [x] 24/24 Rust unit tests pass
- [x] `io.js` wired: openFolder → Tauri dialog + pickAndWatchFolder, saveToFolder → saveGpxFile

### Phase 3: Tile Server ✅

- [x] `src/tile_server.rs` — localhost MBTiles server from spike shared_backend (7 Rust unit tests)
- [x] DEM tile URL wired through bridge in main.js (getDemTileUrl)
- [x] 17/17 e2e tests pass (5 persist + 12 import, no regression)

### Phase 4: Desktop Sync Event Listener ✅

- [x] GPX sync event listener in main.js: auto-imports tracks on file_added/file_changed
- [x] Logs file_removed and conflict events (UI handling deferred to next iteration)

### Phase 5: Conflict Detection UI ✅

- [x] Simple `confirm()` dialog on GPX sync conflict (OK=disk, Cancel=keep app)
- [x] Calls `resolveConflict` IPC with user's choice

### Phase 6: DEM E2E Tests with Synthetic Tiles ✅

- [x] `tests/fixtures/tiles/build_dem_fixtures.py` — generates 19 Terrarium-encoded 512×512 tiles (z0/z10/z12)
- [x] `tests/e2e/dem-loading.spec.js` — 3 tests: color-relief, slope+relief, slope
- [x] Synthetic tiles served via Playwright route interception (no network)
- [x] Tests run in normal mode (not test_mode) at explicit z12 with deterministic coords
- [x] Screenshot baselines for visual regression: `dem-color-relief`, `dem-slope-relief`, `dem-slope`
- [x] Pixel checks: 99.9% non-white (color-relief), 78.7% non-white (slope modes)

### Phase 7: Dynamic Tile Source Management ✅

- [x] `SharedTileSources` (Arc<Mutex>) for runtime add/remove
- [x] `TileSourceKind` enum: Mbtiles + Pmtiles
- [x] `detect_source_kind()` auto-detects .mbtiles/.pmtiles extensions
- [x] Tauri commands: `add_tile_source`, `list_tile_sources`, `remove_tile_source`
- [x] JS bridge: `addTileSource`, `listTileSources`, `removeTileSource`

### Phase 8: Unified Basemap UI Plan ✅

- [x] Detailed plan in `plans/20260406-PLAN-UNIFIED-BASEMAP-UI.md`
- Multi-basemap stack, merged online+local catalog, folder scanning, PMTiles support

### Phase 9: JS Error Forwarding to Tauri Console ✅

- [x] `window.error` + `unhandledrejection` listeners in WebView init script
- [x] Errors prefixed `[SLOPE JS ERROR]` / `[SLOPE UNHANDLED REJECTION]` in cargo tauri dev output

### Phase 10: Dynamic User Source Registry (Basemap Plan Phase 1) ✅

- [x] `registerUserSource` / `unregisterUserSource` / `clearUserSources` / `getUserSources`
- [x] `buildCatalogEntryFromTileSource` — auto-generates CatalogEntry from Tauri tile sources
- [x] All lookup helpers merge built-in + user sources (getBasemaps, getOverlays, etc.)
- [x] 11 new unit tests for user source registry

### Phase 11: PMTiles Serving with HTTP Range Support (Basemap Plan Phase 5) ✅

- [x] `/pmtiles/{source}` endpoint in Rust tile server with full HTTP Range support
- [x] `parse_pmtiles_path`, `parse_range_header`, `serve_pmtiles_range` helpers
- [x] CORS preflight (OPTIONS) for Range header access
- [x] `pmtiles` 4.4.0 JS library vendored (ESM build)
- [x] `app/js/pmtiles-protocol.js` — lazy dynamic import, registers pmtiles:// protocol with MapLibre
- [x] `buildCatalogEntryFromTileSource` generates `pmtiles://` URLs for PMTiles sources
- [x] 6 new Rust tests: path parsing, range requests, 206/416/500 edge cases

### Test Summary

| Suite | Count | Status |
|---|---|---|
| Rust unit tests (cargo test) | 33 | ✅ all pass |
| JS unit tests (vitest) | 68 | ✅ all pass |
| Playwright e2e (total) | 47 | ✅ all pass |
| — persist | 5 | ✅ |
| — track-import | 12 | ✅ |
| — dem-loading | 3 | ✅ (with screenshots) |
| — track-desktop | 4 | ✅ |
| — profile | 6 | ✅ |
| — track-mobile | 5 | ✅ |

## Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| Tile serving | Localhost (tiny_http) | Spike 1 validated; simpler than custom protocol |
| GPX sync model | File-centric | Spike 2 validated; 21 Rust + 13 e2e tests green |
| Frontend dist | `../app` (relative from src-tauri) | Same files as web; no build step |
| Bridge pattern | Lazy `__SLOPE_RUNTIME__` global | Testable without module reload; no Tauri import at module top level |
| Dev URL | `http://localhost:8089/app/` | Same Python HTTP server as e2e tests |

## Files Created/Modified

### New files
- `src-tauri/Cargo.toml` — workspace config with tauri v2, plugins, sync deps, tile deps
- `src-tauri/build.rs` — standard tauri-build
- `src-tauri/tauri.conf.json` — app config, frontendDist=../app
- `src-tauri/capabilities/default.json` — core + dialog + shell permissions
- `src-tauri/src/main.rs` — entry point, state mgmt, 12 Tauri commands, setup hook, JS error forwarding
- `src-tauri/src/gpx_sync.rs` — file-centric sync manager (15 tests)
- `src-tauri/src/tile_server.rs` — localhost tile server with MBTiles + PMTiles Range support (15 tests)
- `app/js/tauri-bridge.js` — runtime adapter module
- `app/js/pmtiles-protocol.js` — PMTiles protocol registration for MapLibre
- `tests/unit/tauri-bridge.test.mjs` — 18 bridge unit tests
- `tests/e2e/dem-loading.spec.js` — 3 DEM rendering tests with screenshot baselines
- `tests/fixtures/tiles/build_dem_fixtures.py` — synthetic DEM tile generator
- `tests/fixtures/tiles/dem/` — 19 synthetic Terrarium-encoded DEM tiles
- `plans/20260406-PLAN-UNIFIED-BASEMAP-UI.md` — unified basemap UI plan

### Modified files
- `app/js/main.js` — DEM tile URLs via bridge, GPX sync listener, conflict UI, PMTiles protocol init
- `app/js/io.js` — import bridge, add Tauri-aware openFolder/saveToFolder
- `app/js/layer-registry.js` — dynamic user source registry, merged catalog lookups
- `deps.json` — added pmtiles dependency

## Commits

1. `a4a5e78` feat: add src-tauri scaffold with GPX sync + tile server (24 Rust tests pass)
2. `76d1493` feat: add tauri-bridge.js runtime adapter with 14 unit tests
3. `f7c1ada` feat: wire DEM tile URLs through tauri-bridge in main.js
4. `1a71790` feat: wire tauri-bridge into io.js for desktop folder open/save
5. `f81a354` feat: add GPX sync event listener in main.js for desktop auto-reload
6. `560c40d` chore: update desktop mode report with final progress and next steps
7. `559bb0d` feat: add DEM loading e2e test (color-relief non-white check)
8. `9e095f5` feat: simple conflict detection UI via confirm() dialog
9. `65b84b9` feat: add dynamic MBTiles/PMTiles tile source management
10. `46a7b37` feat: DEM e2e tests with synthetic tiles and screenshot matching
11. `bc47a0c` feat: forward JS errors/rejections to Tauri dev console
12. `7a28162` feat: Phase 1 — dynamic user source registry in layer-registry
13. `19318ed` feat: Phase 5 — PMTiles serving with HTTP Range support + JS protocol

## Next Steps

- [ ] Implement unified basemap UI phases 2-4 (see `plans/20260406-PLAN-UNIFIED-BASEMAP-UI.md`)
  - Phase 2: Multi-basemap stacking UI
  - Phase 3: Desktop folder scanning for local tile files
  - Phase 4: Merged catalog UI (online + local sources)
- [ ] File removal handling (remove tracks from map when GPX deleted on disk)
- [ ] Tauri integration tests (WebDriver-based, as in spike_demo)
- [ ] Bundle and test on macOS (`cargo tauri build`)
- [ ] Desktop-specific UI: native menu bar, window title with folder name
