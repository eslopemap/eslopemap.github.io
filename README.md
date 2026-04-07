# Slope Mapper

Slope Mapper is a terrain visualization and GPX track editor that runs **both as a static web app and as a Tauri desktop app** (macOS, Linux, Windows).

- **Web app**: [`app/index.html`](app/index.html) — zero-build, served as static files
- **Desktop app**: [`src-tauri/`](src-tauri/) — Tauri v2 wrapper with local tile serving, GPX folder sync, and file-system access
- **Docs**: [https://eslopemap.github.io/app/user-guide/](https://eslopemap.github.io/app/user-guide/) (also [`app/user-guide/`](app/user-guide/))

![Slope Mapper edit mode screenshot](app/user-guide/assets/edit-mode.png)

## What it includes

- Terrain visualization with slope, aspect, color relief, hillshade, contours, and optional 3D terrain
- A browser-based GPX track editor with workspace tree, undo, and profile charts
- Multi-basemap stacking with per-layer opacity
- Desktop-only: local `.mbtiles`/`.pmtiles` tile sources served via built-in tile server
- Desktop-only: GPX folder watching with live reload and conflict resolution

## Quick start

### Web (no build required)

```bash
python3 -m http.server 8089
# → http://localhost:8089/app/index.html
```

### Desktop (Tauri)

Requires [Rust](https://rustup.rs/), Node.js, and system dependencies (see [CONTRIBUTING.md](CONTRIBUTING.md)).

```bash
npm install
cargo tauri dev          # starts static server + Tauri window
```

For a release build:

```bash
cargo tauri build        # produces .dmg / .deb / .AppImage / .msi
```

### Tests

```bash
npm install
npm run test:unit        # Vitest unit tests (80 tests)
npm test                 # Playwright e2e tests (51 tests)
cargo test -p slope      # Rust backend tests
```

See [`tests/README.md`](tests/README.md) for full test inventory and coverage setup.

## Project shape

```
app/                    Web app (shared by both web and desktop)
├── js/                 Application modules (browser ES modules)
├── css/                Styles
├── vendor/             Vendored third-party browser assets
└── user-guide/         Static user documentation

src-tauri/              Desktop app (Tauri v2)
├── src/main.rs         Entry point, Tauri commands
├── src/gpx_sync.rs     GPX folder watching + conflict resolution
├── src/tile_server.rs  Local HTTP tile server for .mbtiles/.pmtiles
└── tauri.conf.json     Tauri configuration

tests/
├── unit/               Vitest unit tests
├── e2e/                Playwright e2e tests
└── fixtures/           Test data (GPX files, MBTiles)

scripts/                Dev tooling (vendoring, coverage merge)
.github/workflows/      CI (unit + e2e + Rust + coverage) + CD (release)
```

## Dependency strategy

This project prefers a zero-build, static architecture:

- App code is plain browser JavaScript modules
- Third-party dependencies are vendored locally under `app/vendor/`
- ESM dependencies exposed via generated import maps
- Map runtime uses the `@eslopemap/maplibre-gl` fork (pinned in `deps.json`)

## Contributing

- See [`CONTRIBUTING.md`](CONTRIBUTING.md) for local setup, dev workflows, and vendoring guidance.
- See [`FEATURES.md`](FEATURES.md) for functionality and implementation details.
- See [`UI.md`](UI.md) for UI structure and components.
