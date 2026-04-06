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

### Phase 6: DEM Loading E2E Test ✅

- [x] `tests/e2e/dem-loading.spec.js` — basemap=none + mode=color-relief at zoom 10
- [x] Reads WebGL pixels inside `render` event (avoids buffer-clear issue)
- [x] Confirms DEM loads correctly in web mode (47% non-white pixels, 21 tile requests at z10)

### Phase 7: Dynamic Tile Source Management ✅

- [x] `SharedTileSources` (Arc<Mutex>) for runtime add/remove
- [x] `TileSourceKind` enum: Mbtiles (working) + Pmtiles (501 stub)
- [x] `detect_source_kind()` auto-detects .mbtiles/.pmtiles extensions
- [x] Tauri commands: `add_tile_source`, `list_tile_sources`, `remove_tile_source`
- [x] JS bridge: `addTileSource`, `listTileSources`, `removeTileSource`

### Phase 8: Unified Basemap UI Plan ✅

- [x] Detailed plan in `plans/20260406-PLAN-UNIFIED-BASEMAP-UI.md`
- Multi-basemap stack, merged online+local catalog, folder scanning, PMTiles support

### Test Summary

| Suite | Count | Status |
|---|---|---|
| Rust unit tests (cargo test) | 26 | ✅ all pass |
| JS unit tests (vitest) | 57 | ✅ all pass (18 bridge + 39 existing) |
| Playwright e2e (persist) | 5 | ✅ pass |
| Playwright e2e (track-import) | 12 | ✅ pass |
| Playwright e2e (dem-loading) | 1 | ✅ pass |

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
- `src-tauri/src/main.rs` — entry point, state mgmt, 12 Tauri commands, setup hook
- `src-tauri/src/gpx_sync.rs` — file-centric sync manager (15 tests)
- `src-tauri/src/tile_server.rs` — localhost tile server with shared source registry (9 tests)
- `app/js/tauri-bridge.js` — runtime adapter module
- `tests/unit/tauri-bridge.test.mjs` — 18 bridge unit tests
- `tests/e2e/dem-loading.spec.js` — DEM rendering regression test
- `plans/20260406-PLAN-UNIFIED-BASEMAP-UI.md` — unified basemap UI plan

### Modified files
- `app/js/main.js` — DEM tile URLs via bridge, GPX sync listener, conflict UI
- `app/js/io.js` — import bridge, add Tauri-aware openFolder/saveToFolder

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

## Next Steps

- [ ] Implement unified basemap UI (see `plans/20260406-PLAN-UNIFIED-BASEMAP-UI.md`)
- [ ] PMTiles serving implementation (replace 501 stub)
- [ ] File removal handling (remove tracks from map when GPX deleted on disk)
- [ ] Tauri integration tests (WebDriver-based, as in spike_demo)
- [ ] Bundle and test on macOS (`cargo tauri build`)
- [ ] Desktop-specific UI: native menu bar, window title with folder name
