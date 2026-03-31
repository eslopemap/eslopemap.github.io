# Spike demos

This directory contains the Tauri spike demonstrators.

## Spike 1 — MBTiles Tile Serving

Described in `prompts/20260331_TAURI_SPIKE1_PLAN_PROTOCOL.md`.

### Apps

- `mbtiles_to_localhost`
- `mbtiles_custom_protocol`

Both demos share:

- `../tests/fixtures/tiles/dummy-z1-z3.mbtiles`
- `shared_frontend/`
- `shared_backend/`

## Rebuild the tile fixture

```bash
python3 tests/fixtures/tiles/build_dummy_mbtiles.py
```

## Run the localhost demo

```bash
cd spike_demo/mbtiles_to_localhost && cargo tauri dev
```

## Run the custom protocol demo

```bash
cd spike_demo/mbtiles_custom_protocol && cargo tauri dev
```

## Run automated validation

```bash
python3 tests/fixtures/tiles/build_dummy_mbtiles.py
cargo test --manifest-path spike_demo/shared_backend/Cargo.toml
cargo check --manifest-path spike_demo/mbtiles_to_localhost/src-tauri/Cargo.toml
cargo check --manifest-path spike_demo/mbtiles_custom_protocol/src-tauri/Cargo.toml
```

## What to compare

For each demo, validate:

- online OSM rendering
- offline MBTiles rendering
- repeated source switching
- missing tile handling
- request/error visibility in the debug panel
- Rust-side logs for requested tile paths and response codes

Record findings in `SPIKE1_RESULTS.md`.

---

## Spike 2 — File-Centric GPX Sync

Described in `prompts/20260331_TAURI_SPIKE2_PLAN_GPX_SYNC.md`.

### Structure

- `gpx_sync_filecentric/` — Tauri app demonstrator
- `gpx_sync_backend/` — shared Rust crate (watcher, file state, atomic save, conflict detection)
- `gpx_sync_filecentric/frontend/` — HTML + JS + CSS frontend (works in Tauri and browser via File System Access API)
- `gpx_sync_filecentric/gpx_samples/` — sample GPX files for manual testing

### Test fixtures

- `../tests/fixtures/gpx/simple-single-track.gpx`
- `../tests/fixtures/gpx/multi-track.gpx`
- `../tests/fixtures/gpx/conflict-base.gpx`

### Run the GPX sync demo (Tauri)

```bash
cd spike_demo/gpx_sync_filecentric && cargo tauri dev
```

### Run in browser (File System Access API fallback)

Open `spike_demo/gpx_sync_filecentric/frontend/index.html` via any local HTTP server. The browser mode uses the File System Access API to read/write files and polls for external changes.

```bash
python3 -m http.server 8090 -d spike_demo/gpx_sync_filecentric/frontend
```

### Run automated validation

```bash
cargo test --manifest-path spike_demo/gpx_sync_backend/Cargo.toml
cargo check --manifest-path spike_demo/gpx_sync_filecentric/src-tauri/Cargo.toml
```

### What to validate

For the demo, test these scenarios:

1. **Clean external edit** — watch folder, externally modify a GPX file, verify auto-reload
2. **Dirty + external edit → conflict** — edit in-app without saving, externally modify, verify conflict UI
3. **App save** — edit and save, verify atomic write and no false watcher echo
4. **External rename** — rename a file externally, verify file list updates
5. **External delete** — delete a file externally, verify UI reflects deletion
6. **Multi-track file** — load a multi-track GPX, edit, save, verify whole-file rewrite

Record findings in `SPIKE2_RESULTS.md`.
