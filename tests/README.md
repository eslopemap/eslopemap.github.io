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

Config: `vitest.config.mjs` — 11 test files.

| File | What it covers |
|---|---|
| `constants.test.mjs` | Color ramp parsing, legend CSS generation, opacity expressions |
| `dem.test.mjs` | DEM elevation sampling, bilinear interpolation |
| `gpx-model.test.mjs` | GPX/GeoJSON data model parsing |
| `io-roundtrip.test.mjs` | Import/export round-trips for GPX and GeoJSON |
| `layer-engine.test.mjs` | Basemap/overlay loading, opacity, user source registry |
| `persist.test.mjs` | localStorage save/load for tracks and settings |
| `shortcuts.test.mjs` | Keyboard shortcut registry, focus guards, modifier keys |
| `state.test.mjs` | Reactive Proxy store, onChange callback, STATE_DEFAULTS |
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
| `track-desktop.spec.js` | 15 | Desktop track editor: draw, edit, delete, undo, stats |
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

**Verified coverage** (109 unit tests across 12 files):

| Module | Stmts | Notes |
|---|---|---|
| `state.js` | 100% | Reactive store fully tested |
| `constants.js` | 97% | Ramp parsing, legend CSS |
| `persist.js` | 90% | localStorage save/load |
| `shortcuts.js` | 90% | Registry, focus guards |
| `tauri-bridge.js` | 86% | Web + desktop mode paths |
| `gpx-model.js` | 85% | GPX/GeoJSON parsing |
| `layer-registry.js` | 72% | User source registry |
| `layer-engine.js` | 39% | Core loading covered, edge cases need e2e |
| `utils.js` | 38% | Tile math covered, DOM utils need e2e |
| `dem.js` | 25% | sampleElevation covered, queryLoaded needs map |
| DOM-heavy modules | 0% | Covered by Playwright e2e (not measured here) |

### Backend (Rust) — cargo-llvm-cov

```bash
cargo install cargo-llvm-cov
cd src-tauri && cargo llvm-cov --html
```

Report is written to `target/llvm-cov/html/`.

### E2E coverage

Playwright tests cover the DOM-heavy modules indirectly. JS coverage during e2e is possible via `page.coverage` API (Chromium only) but is not currently collected since it would add complexity for limited value — the unit-testable logic is already covered by Vitest.

## CI/CD

### GitHub Actions CI (`.github/workflows/ci.yml`)

Runs on every push to `main` and on PRs. Four parallel jobs:

| Job | What it does |
|---|---|
| `js-unit` | `npm run test:unit` — Vitest unit tests |
| `js-coverage` | `npm run test:coverage` — coverage report |
| `rust-unit` | `cargo test` in `src-tauri/` (with Ubuntu system deps) |
| `e2e` | `npm test` — Playwright e2e with Chromium |

On e2e failure, `test-results/` and `playwright-report/` are uploaded as artifacts.

### GitHub Actions CD (`.github/workflows/release.yml`)

Triggered by version tags (`v*`) or manual dispatch. Uses `tauri-apps/tauri-action@v0` to:

1. Build desktop app on macOS (ARM + Intel), Linux (x64), Windows (x64)
2. Create a GitHub Release (draft) with all installers attached

Produces: `.dmg` (macOS), `.deb`/`.AppImage` (Linux), `.msi`/`.exe` (Windows).

### Running CI checks locally

```bash
# Equivalent to the CI pipeline
npm run test:unit
npm run test:coverage
npm test
(cd src-tauri && cargo test)
```
