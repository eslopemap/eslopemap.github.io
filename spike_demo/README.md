# Spike demos

This directory contains the Tauri Spike 1 demonstrators described in `prompts/20260331_TAURI_SPIKE1_PLAN_PROTOCOL.md`.

## Apps

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
cargo tauri dev --config spike_demo/mbtiles_to_localhost/src-tauri/tauri.conf.json --manifest-path spike_demo/mbtiles_to_localhost/src-tauri/Cargo.toml
```

## Run the custom protocol demo

```bash
cargo tauri dev --config spike_demo/mbtiles_custom_protocol/src-tauri/tauri.conf.json --manifest-path spike_demo/mbtiles_custom_protocol/src-tauri/Cargo.toml
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
