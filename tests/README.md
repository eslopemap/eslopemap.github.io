# Tests

## Quick Reference

```bash
# JS unit tests (fast, no browser)
npm run test:unit

# Playwright e2e tests (browser, needs chromium)
npm test

# Rust unit tests (desktop backend)
cd src-tauri && cargo test
```

## JS Unit Tests (Vitest)

Config: `vitest.config.mjs` — 68 tests across 8 files.

| File | What it covers |
|---|---|
| `gpx-model.test.mjs` | GPX/GeoJSON data model parsing |
| `io-roundtrip.test.mjs` | Import/export round-trips for GPX and GeoJSON |
| `layer-engine.test.mjs` | Basemap/overlay loading, opacity, user source registry |
| `persist.test.mjs` | localStorage save/load for tracks and settings |
| `tauri-bridge.test.mjs` | Runtime detection, desktop bridge API stubs |
| `undo-stack.test.mjs` | Undo/redo stack operations |
| `utils.test.mjs` | Tile math, coordinate utilities |
| `web-import.test.mjs` | GPX import from URL |

Helper: `test-helpers.mjs` — shared mocks (canvas, document).

## Playwright E2E Tests

Config: `playwright.config.js` — 51 tests, headless Chromium with SwiftShader WebGL.

| File | Tests | What it covers |
|---|---|---|
| `persist.spec.js` | 5 | Track/settings persistence across page reload |
| `track-desktop.spec.js` | 4 | Desktop track editor: draw, edit, delete |
| `track-import.spec.js` | 12 | GPX/GeoJSON import, multi-segment, extensions |
| `track-mobile.spec.js` | 5 | Mobile editing mode, crosshair, multi-tap |
| `profile.spec.js` | 6 | Elevation profile panel, auto-open, display |
| `dem-loading.spec.js` | 3 | DEM rendering: color-relief, slope+relief, slope (screenshot baselines) |
| `tile-serving.spec.js` | 4 | MBTiles + PMTiles tile serving, user catalog registration |

Helpers:
- `helpers.js` — shared fixtures (`mapPage`), map interaction utilities
- `tile-server-helper.js` — Node.js HTTP tile server for MBTiles/PMTiles tests
- `screenshot-utils.js` — center-crop screenshot for UI-stable baselines

Test modes:
- **test_mode** (`#test_mode=true`): skips DEM loading, used by most UI tests for speed
- **normal mode**: full DEM pipeline, used by `dem-loading.spec.js` and `tile-serving.spec.js`

## Rust Unit Tests (cargo test)

In `src-tauri/` — 33 tests across 2 modules.

| Module | Tests | What it covers |
|---|---|---|
| `gpx_sync` | 18 | File watching, conflict detection, atomic writes, hash stability |
| `tile_server` | 15 | Tile path parsing, MBTiles loading, PMTiles Range serving, MIME detection |

## Test Fixtures

- `fixtures/tiles/dummy-z1-z3.mbtiles` — 84 PNG tiles (z1–z3, global), built by `build_dummy_mbtiles.py`
- `fixtures/tiles/dummy-z1-z3.pmtiles` — same tiles converted to PMTiles format
- `fixtures/tiles/dem/` — 19 synthetic Terrarium-encoded DEM tiles (z0/z10/z12), built by `build_dem_fixtures.py`
- `fixtures/gpx/` — sample GPX files for import tests

## Setting Up Test Coverage

### Frontend (JS)

Vitest supports built-in coverage via `@vitest/coverage-v8`:

```bash
npm install --save-dev @vitest/coverage-v8
npx vitest run --config vitest.config.mjs --coverage
```

This generates an `lcov` report covering `app/js/` modules.

### Backend (Rust)

Use `cargo-llvm-cov` for Rust coverage:

```bash
cargo install cargo-llvm-cov
cd src-tauri && cargo llvm-cov --html
```

Report is written to `target/llvm-cov/html/`.

### E2E (Playwright)

Playwright doesn't measure code coverage directly. For JS coverage during e2e runs, use Playwright's `page.coverage` API (Chromium only) to collect V8 coverage data.
