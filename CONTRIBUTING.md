# Contributing

Thanks for helping with Slope Mapper.

This file covers setup and workflows. For functionality, see [FEATURES.md](FEATURES.md) and [UI.md](UI.md).

## Project spirit

Slope Mapper is a **web-first** app with a **desktop wrapper**:

- **Static-first** — `app/` is served as plain files with no build step.
- **Zero-build runtime** — no bundler required. Browser-native ES modules.
- **Local vendoring** — runtime assets checked into `app/vendor/`, no CDN dependencies.
- **Desktop via Tauri v2** — `src-tauri/` wraps the same web app in a native window with extra Rust-powered capabilities (local tile serving, GPX folder sync).
- **Shared codebase** — `app/js/tauri-bridge.js` is the only file with desktop-vs-browser branching.

## Tech stack

### Frontend (web + desktop)

- **HTML/CSS/JavaScript** — no framework, no runtime bundler
- **MapLibre GL** — via `@eslopemap/maplibre-gl` fork (terrain-analysis + blend-mode features)
- **maplibre-contour** — client-side contour generation
- **Chart.js** — elevation/profile charts
- **Marked** — docs site renderer

### Desktop only (Tauri v2)

- **Rust** — backend for GPX sync, tile serving, file-system access
- **Tauri v2** — native window, IPC commands, dialog/shell plugins
- **tiny_http** — embedded tile server for `.mbtiles`/`.pmtiles`
- **rusqlite** — MBTiles tile extraction

### Dev dependencies

- **Vitest** — JS unit tests + V8 coverage
- **Playwright** — E2E browser tests + V8 coverage
- **cargo-llvm-cov** — Rust backend coverage (CI only)

## Environment setup

### For web development only

- Node.js and npm
- Python 3 (for the static dev server)

```bash
npm install
npx playwright install chromium   # if not already installed
```

### For desktop development (Tauri)

All of the above, plus:

- [Rust toolchain](https://rustup.rs/) (stable)
- System dependencies for WebView2/WebKit:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`
  - **Windows**: WebView2 runtime (usually pre-installed on Windows 10+)

```bash
cargo install tauri-cli  # or use `cargo tauri` via npx
```

## Start the app

### Web mode (static server)

```bash
python3 -m http.server 8089
```

Then open: `http://localhost:8089/app/index.html`

### Desktop mode (Tauri)

```bash
cargo tauri dev
```

This automatically starts `python3 -m http.server 8089` as the frontend dev server (configured via `beforeDevCommand` in `tauri.conf.json`), then opens the Tauri window. Hot-reload works for frontend changes; Rust changes trigger a rebuild.

### Release build

```bash
cargo tauri build        # produces .dmg / .deb / .AppImage / .msi
```

## Run tests

### Unit tests (JS)

```bash
npm run test:unit        # 80 tests across 11 files
npm run test:unit:watch  # watch mode
npm run test:coverage    # with V8 coverage report
```

### End-to-end tests (Playwright)

```bash
npm test                 # 51 tests, headless Chromium
npm run test:headed      # with visible browser
npm run test:debug       # Playwright inspector
npm run test:e2e:coverage  # with V8 JS coverage collection
```

Notes:

- Playwright starts its own local server using `python3 -m http.server 8089`.
- Single worker — tests share browser storage on the same origin.
- `#test_mode=true` URL flag suppresses basemaps/overlays for fast E2E startup.

### Rust tests

```bash
cd src-tauri && cargo test
```

See [`tests/README.md`](tests/README.md) for full test inventory and coverage.

## Vendoring dependencies

Third-party browser assets are managed through `deps.json` and `scripts/vendor-deps.mjs`.

### Current model

- Vendored files live under `app/vendor/`
- The vendoring manifest lives at repo root in `deps.json`
- Generated outputs include:
  - `app/vendor/deps.lock.json`
  - `app/vendor/importmap.app.generated.js`
  - `app/vendor/importmap.docs.generated.js`
  - matching `.json` snapshots for review
- Dependency version selection uses a cooloff period of `minimumAgeDays = 7` unless pinned.

### Add or update a dependency

1. Edit `deps.json`
2. Add a package entry with:
   - `name`
   - `range`
   - `files` and/or `directories`
   - `importMap` entries if the package should be imported as ESM by the app or docs
3. Run:

```bash
npm run vendor:update
```

4. Review the generated changes under `app/vendor/`
5. Verify runtime references still point to local vendored assets
6. Run tests

### Validate vendoring without updating

```bash
npm run vendor:check
```

### MapLibre note

This project currently uses **`@eslopemap/maplibre-gl`**, not upstream `maplibre-gl`.

Important details:

- It is intentionally pinned in `deps.json`
- The current pinned version is `5.21.9`
- It is treated as a vendored classic browser script asset in this project
- If you touch MapLibre-related vendoring or runtime loading, keep in mind that this repo currently relies on the forked package shape and current worker/bootstrap behavior

## Contributor expectations

When changing behavior:

- prefer the smallest clear change
- keep the static, zero-build architecture intact unless there is a strong reason not to
- update user-facing docs when features or workflows change
- prefer unit tests when a behavior can be covered without browser automation
- use focused E2E tests when browser behavior is the thing being validated

## Useful locations

**Web app (shared)**:
- App entry: `app/index.html`
- App code: `app/js/`
- Styles: `app/css/`
- Runtime adapter: `app/js/tauri-bridge.js` (only web-vs-desktop branching)
- Docs: `app/user-guide/`

**Desktop (Tauri v2)**:
- Tauri entry: `src-tauri/src/main.rs`
- GPX sync: `src-tauri/src/gpx_sync.rs`
- Tile server: `src-tauri/src/tile_server.rs`
- Config: `src-tauri/tauri.conf.json`

**Dev tooling**:
- Tests: `tests/unit/`, `tests/e2e/`, [`tests/README.md`](tests/README.md)
- Vendoring: `deps.json`, `scripts/vendor-deps.mjs`
- CI/CD: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Plans / reports: `plans/`, `reports/`
