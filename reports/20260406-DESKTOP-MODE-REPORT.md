# Desktop Mode Integration Report

## Summary

Refactoring the Slope web app into a dual web+desktop codebase using Tauri v2, based on validated spike demos (Spike 1: localhost tile serving, Spike 2: file-centric GPX sync).

## Approach

- **Single codebase**: same `app/index.html` serves both browser and Tauri WebView
- **Thin adapter**: `app/js/tauri-bridge.js` detects runtime and routes calls
- **Reuse spike code**: `gpx_sync_backend` and `shared_backend` crates refactored into `src-tauri/`
- **Test-first**: JS unit tests for bridge, Rust unit tests for backend, web e2e sanity check

## Progress Log

### Phase 1: Scaffold + Bridge

- [ ] Create `src-tauri/` with Cargo.toml, tauri.conf.json, capabilities, main.rs
- [ ] Create `app/js/tauri-bridge.js` runtime adapter
- [ ] Add JS unit tests for tauri-bridge.js
- [ ] Verify `cargo tauri dev` loads the web frontend

### Phase 2: GPX Sync Backend

- [ ] Integrate `gpx_sync_backend` crate into src-tauri
- [ ] Wire Tauri commands (pick_and_watch_folder, save_gpx, etc.)
- [ ] Rust unit tests pass
- [ ] Wire bridge to io.js/persist.js

### Phase 3: Tile Server

- [ ] Integrate localhost tile server from shared_backend
- [ ] Wire DEM URL through bridge
- [ ] Web e2e test passes (no regression)

## Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| Tile serving | Localhost (tiny_http) | Spike 1 validated; simpler than custom protocol |
| GPX sync model | File-centric | Spike 2 validated; 21 Rust + 13 e2e tests green |
| Frontend dist | `../app` (relative from src-tauri) | Same files as web; no build step |
| Bridge pattern | `__SLOPE_RUNTIME__` global + vendored @tauri-apps/api | App-owned bootstrap, no Tauri internals |

## Commits

*(updated as work progresses)*
