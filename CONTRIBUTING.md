# Contributing

Thanks for helping with Slope Mapper.

This file covers setup and workflows, for the functionality, see [FEATURES.md](FEATURES.md) and [UI.md](UI.md).

## Project spirit

Slope Mapper is intentionally a low-infrastructure web app:

- **Static-first** — the app is served as plain files from the repository.
- **Zero-build runtime** — no bundler is required to run the app locally.
- **Browser-native modules** — app-owned code uses ESM, with vendored third-party dependencies resolved through generated import maps where appropriate.
- **Local vendoring over runtime CDNs** — production/runtime assets are checked into the repo under `app/vendor/`.
- **Small, understandable pieces** — most logic lives in plain JavaScript modules under `app/js/`.

## Tech stack

Main pieces:

- **HTML/CSS/JavaScript** — no framework, no runtime bundler.
- **MapLibre GL** — via the `@eslopemap/maplibre-gl` fork. The fork is needed for the `terrain-analysis` and `blend-mode` features.
- **maplibre-contour** — for client-side contour generation.
- **Chart.js** — for the elevation/profile view.
- **Marked** — for the docs app.

Dev dependencies:

- **Vitest** — unit tests.
- **Playwright** — end-to-end browser tests.

## Environment setup

### Requirements

You only need a small local web server and Node.js/npm for tests and vendoring.

Typical setup:

- Node.js and npm
- Python 3

Install dependencies:

```bash
npm install
```

If Playwright browsers are not installed yet on your machine, install Chromium once:

```bash
npx playwright install chromium
```

## Start the app locally

The app itself is static, so there is no build step.

From the repository root, serve the project directory and open the app entrypoint:

```bash
python3 -m http.server 8089
```

Then open:

- App: `http://localhost:8089/app/index.html`
- Docs: `http://localhost:8089/app/user-guide/`

You can use another static file server if you prefer, but the current Playwright setup uses Python's built-in server on port `8089`.

## Run tests

### Unit tests

Prefer unit tests when possible:

```bash
npm run test:unit
```

Watch mode:

```bash
npm run test:unit:watch
```

### End-to-end tests

Run the full browser suite:

```bash
npm test
```

Useful variants:

```bash
npm run test:headed
npm run test:debug
```

Notes:

- Playwright starts its own local server using `python3 -m http.server 8089`.
- The E2E suite runs with a single worker because tests share browser storage on the same origin.
- Some focused tests use `#test_mode=true` to suppress external-request-heavy layers and speed up startup.

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

- App entry: `app/index.html`
- Docs entry: `app/user-guide/index.html`
- App code: `app/js/`
- Styles: `app/css/`
- Docs content: `app/user-guide/content/`
- Tests: `tests/unit/`, `tests/e2e/`
- Vendoring manifest: `deps.json`
- Vendoring script: `scripts/vendor-deps.mjs`
- Research / implementation notes: `reports/`
