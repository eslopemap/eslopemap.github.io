# Tests

## Quick Reference

```bash
# JS unit tests (fast, no browser)
npm run test:unit

# JS unit tests with coverage report
npm run test:coverage

# Playwright e2e tests (browser, needs chromium)
npm test

# Rust unit tests (desktop backend)
cd src-tauri && cargo test

# All checks (CI equivalent)
npm run test:unit && npm test && (cd src-tauri && cargo test)
```

## JS Unit Tests (Vitest)

Config: `vitest.config.mjs` — 13 test files.

| File | What it covers |
|---|---|
| `constants.test.mjs` | Color ramp parsing, legend CSS generation, opacity expressions |
| `dem.test.mjs` | DEM elevation sampling, bilinear interpolation |
| `gpx-model.test.mjs` | GPX/GeoJSON data model parsing |
| `io-import-guard.test.mjs` | Extension guard in importFileContent, parseGeoJSON edge cases |
| `io-roundtrip.test.mjs` | Import/export round-trips for GPX and GeoJSON |
| `layer-engine.test.mjs` | Basemap/overlay loading, opacity, user source registry |
| `persist.test.mjs` | localStorage save/load for tracks and settings, granular clear and size stats |
| `shortcuts.test.mjs` | Keyboard shortcut registry, focus guards, modifier keys |
| `state.test.mjs` | Reactive Proxy store, onChange callback, STATE_DEFAULTS |
| `tauri-bridge.test.mjs` | Runtime detection, desktop bridge API stubs |
| `track-ops-simplify-display.test.mjs` | Display simplification (Douglas-Peucker for merged source) |
| `undo-stack.test.mjs` | Undo/redo stack operations |
| `utils.test.mjs` | Tile math, coordinate utilities |
| `web-import.test.mjs` | GPX import from URL |

Helper: `test-helpers.mjs` — shared mocks (canvas, document).

## Playwright E2E Tests

Config: `playwright.config.js` — 73 tests, headless Chromium with SwiftShader WebGL.

| File | Tests | What it covers |
|---|---|---|
| `persist.spec.js` | 5 | Track/settings persistence across page reload |
| `track-desktop.spec.js` | 15 | Desktop track editor: draw, edit, delete, undo, stats |
| `track-import.spec.js` | 12 | GPX/GeoJSON import, multi-segment, extensions |
| `track-merge.spec.js` | 15 | Merged source, promote/demote, import guard, batch import |
| `track-mobile.spec.js` | 5 | Mobile editing mode, crosshair, multi-tap |
| `profile.spec.js` | 6 | Elevation profile panel, auto-open, display |
| `dem-loading.spec.js` | 3 | DEM rendering: color-relief, slope+relief, slope (screenshot baselines) |
| `tile-serving.spec.js` | 4 | MBTiles + PMTiles tile serving, user catalog registration |
| `saved-data.spec.js` | 8 | Saved Data panel: open/close, category display, sizes, per-category clear |

Helpers:
- `helpers.js` — shared fixtures (`mapPage`), map interaction utilities
- `tile-server-helper.js` — Node.js HTTP tile server for MBTiles/PMTiles tests
- `screenshot-utils.js` — center-crop screenshot for UI-stable baselines

Test modes:
- **test_mode** (`#test_mode=true`): skips DEM loading, used by most UI tests for speed
- **normal mode**: full DEM pipeline, used by `dem-loading.spec.js` and `tile-serving.spec.js`

## Tauri WebDriver E2E Tests (wdio)

Config: `tests/tauri-e2e/wdio.conf.mjs` — runs against the real Tauri desktop app via `tauri-plugin-webdriver`.

```bash
# Prerequisites: build the debug binary with webdriver feature
cd src-tauri && cargo build --features webdriver

# Install wdio deps (first time only)
cd tests/tauri-e2e && npm install

# Run tests
npm run test:tauri-e2e
```

Uses `tauri-plugin-webdriver` (behind `--features webdriver`) which embeds a W3C WebDriver server on port 4445 inside the app. Tests launch the binary, connect via WebdriverIO, and interact with the real desktop UI.

The DEM tile test injects fixture tiles into the disk cache via the `inject_cached_tile` Tauri command, then verifies the tile server serves them with HTTP 200.

| File | Tests | What it covers |
|---|---|---|
| `dem-tile-serving.spec.mjs` | 8 | DEM tile cache injection, cache stats, cached tile serving (200), upstream fallback |

Helpers:
- `tests/tauri-e2e/tests/helpers.mjs` — Tauri IPC bridge, error capture hooks, screenshot utility

Key differences from Playwright E2E:
- **Real Tauri runtime** — tests run inside WKWebView with actual Tauri IPC, tile server, etc.
- **WKWebView content world** — WebDriver JS runs in an isolated world; use `window.__TAURI_INTERNALS__` for IPC
- **No test_mode** — tests exercise the full app including DEM loading

## Rust Unit Tests (cargo test)

In `src-tauri/` — 48 tests across 4 modules.

| Module | Tests | What it covers |
|---|---|---|
| `config` | 7 | Config parsing (slopemapper.toml), OS cache/config dir resolution |
| `gpx_sync` | 17 | File watching, conflict detection, atomic writes, hash stability |
| `tile_cache` | 5 | Disk cache inject/read, LRU eviction, stats, cache hit serving |
| `tile_server` | 19 | Tile path parsing, MBTiles loading, PMTiles Range serving, MIME detection |

## Test Fixtures

- `fixtures/tiles/dummy-z1-z3.mbtiles` — 84 PNG tiles (z1–z3, global), built by `build_dummy_mbtiles.py`
- `fixtures/tiles/dummy-z1-z3.pmtiles` — same tiles converted to PMTiles format
- `fixtures/tiles/dem/` — 19 synthetic Terrarium-encoded DEM tiles (z0/z10/z12), built by `build_dem_fixtures.py`
- `fixtures/gpx/` — sample GPX files for import tests

## Coverage Architecture

### Strategy

Coverage is split into two tiers:

1. **Unit-testable modules** (pure logic, minimal DOM): covered by Vitest with V8 instrumentation
2. **DOM-heavy modules** (main.js, tracks.js, gpx-tree.js, etc.): covered by Playwright e2e tests

This split is intentional — DOM-heavy modules depend on MapLibre GL, canvas, and complex UI state that can't be meaningfully unit-tested without excessive mocking.

### Frontend (JS) — Vitest + V8

Already configured in `vitest.config.mjs`. Run:

```bash
npm run test:coverage
```

Outputs:
- **Text summary** to stdout
- **LCOV report** to `coverage/lcov.info` (for CI integration)

Coverage targets `app/js/**/*.js`, excluding `app/vendor/**`.

107 unit tests across 13 files.

### Frontend E2E — Playwright V8 coverage

```bash
npm run test:e2e:coverage
```

Collects V8 JS coverage via Chromium's `page.coverage` API during e2e tests. Gated behind `E2E_COVERAGE=1` (zero-cost when disabled). Output:

- Raw V8 JSONs in `coverage/e2e-v8/`
- Human-readable summary in `coverage/e2e-summary.txt`

E2E covers all 21 app/js/ files (28.6% line coverage overall), filling gaps that unit tests can't reach (DOM-heavy modules like `main.js`, `tracks.js`, `gpx-tree.js`, etc.).

### Backend (Rust) — cargo-llvm-cov

```bash
cargo install cargo-llvm-cov
cd src-tauri && cargo llvm-cov --text
```

Runs in CI via `taiki-e/install-action@cargo-llvm-cov`. Covers `gpx_sync`, `tile_server`, and command handlers.

## CI/CD

### GitHub Actions CI (`.github/workflows/ci.yml`)

Runs on every push to `main` and on PRs. Three parallel jobs:

| Job | What it does |
|---|---|
| `js-tests` | `npm run test:coverage` — Vitest unit tests + V8 coverage |
| `rust-tests` | `cargo llvm-cov --text` in `src-tauri/` — Rust tests + LLVM coverage |
| `e2e` | `npm run test:e2e:coverage` — Playwright e2e + V8 JS coverage |

On e2e failure, `test-results/` and `playwright-report/` are uploaded as artifacts.
E2E coverage summary is always uploaded as an artifact.

### GitHub Actions CD (`.github/workflows/release.yml`)

Triggered by version tags (`v*`) or manual dispatch. Uses `tauri-apps/tauri-action@v0` to:

1. Build desktop app on macOS (ARM + Intel), Linux (x64), Windows (x64)
2. Create a GitHub Release (draft) with all installers attached

Produces: `.dmg` (macOS), `.deb`/`.AppImage` (Linux), `.msi`/`.exe` (Windows).

### Running CI checks locally

```bash
# Equivalent to the CI pipeline
npm run test:coverage          # JS unit tests + coverage
npm run test:e2e:coverage      # Playwright e2e + V8 JS coverage
(cd src-tauri && cargo test)   # Rust backend tests
```
