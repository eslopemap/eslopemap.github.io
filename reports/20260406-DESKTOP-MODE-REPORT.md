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

### Test Summary

| Suite | Count | Status |
|---|---|---|
| Rust unit tests (cargo test) | 24 | ✅ all pass |
| JS unit tests (vitest) | 53 | ✅ all pass (14 new bridge + 39 existing) |
| Playwright e2e (persist) | 5 | ✅ pass |
| Playwright e2e (track-import) | 12 | ✅ pass |

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
- `src-tauri/src/main.rs` — entry point, state mgmt, 9 Tauri commands, setup hook
- `src-tauri/src/gpx_sync.rs` — file-centric sync manager (15 tests)
- `src-tauri/src/tile_server.rs` — localhost MBTiles tile server (7 tests)
- `app/js/tauri-bridge.js` — runtime adapter module
- `tests/unit/tauri-bridge.test.mjs` — 14 bridge unit tests

### Modified files
- `app/js/main.js` — import getDemTileUrl, replace hardcoded DEM URLs
- `app/js/io.js` — import bridge, add Tauri-aware openFolder/saveToFolder

## Commits

1. `a4a5e78` feat: add src-tauri scaffold with GPX sync + tile server (24 Rust tests pass)
2. `76d1493` feat: add tauri-bridge.js runtime adapter with 14 unit tests
3. `f7c1ada` feat: wire DEM tile URLs through tauri-bridge in main.js
4. `1a71790` feat: wire tauri-bridge into io.js for desktop folder open/save
5. `f81a354` feat: add GPX sync event listener in main.js for desktop auto-reload

## Next Steps

- [ ] Add MBTiles source configuration command (allow user to point to their tile files)
- [ ] Conflict resolution UI (prompt user to keep disk or app version)
- [ ] File removal handling (remove tracks from map when GPX deleted on disk)
- [ ] Tauri integration tests (WebDriver-based, as in spike_demo)
- [ ] Bundle and test on macOS (`cargo tauri build`)
- [ ] Add desktop-specific UI elements (e.g. native menu bar, window title with folder name)
