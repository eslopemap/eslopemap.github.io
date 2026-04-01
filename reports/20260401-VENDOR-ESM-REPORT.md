# 2026-04-01 Vendor ESM research report

## Goal

Evaluate whether the project can move toward browser ESM without introducing a bundler, while still vendoring dependencies locally and enforcing a minimum package age before adoption.

## Scope reviewed

Current external dependencies referenced from runtime HTML:

- `@eslopemap/maplibre-gl`
- `maplibre-contour`
- `chart.js`
- `chartjs-plugin-annotation`
- `marked`
- `@we-gold/gpxjs`

Local usage reviewed:

- `docs/js/docs.js`
- `js/profile.js`
- `js/io.js`
- `js/main.js`

## Online findings

### `marked`

- Package metadata exposes `type: module`.
- `main` and `module` point to `./lib/marked.esm.js`.
- The project docs still prominently show the UMD browser script, but the package ships a direct ESM entrypoint.

Conclusion:

- Good candidate for browser ESM.
- Safe to vendor locally and expose through an import map.

Example:

```js
import { marked } from 'marked';
```

### `@we-gold/gpxjs`

- Package metadata exposes `type: module`.
- `exports["."].import` points to `./dist/gpxjs.js`.
- Current code already imports `@we-gold/gpxjs` from an import map, but through a CDN `+esm` transform.

Conclusion:

- Good candidate for local vendoring plus import map.
- No need to depend on a CDN ESM transform at runtime.

### `chart.js`

- Package metadata exposes ESM entrypoints:
  - `chart.js` -> `./dist/chart.js`
  - `chart.js/auto` -> `./auto/auto.js`
  - `chart.js/helpers` -> `./helpers/helpers.js`
- The ESM build is not a single self-contained file for browser URL usage.
- `dist/chart.js` contains relative imports and a bare dependency on `@kurkle/color`.
- Official docs describe Chart.js as an ESM library, but also still document the UMD file for direct script loading.

Conclusion:

- Good candidate for vendored browser ESM.
- Requires import-map entries for `chart.js`, `chart.js/auto`, `chart.js/helpers`, and `@kurkle/color`.
- Requires vendoring of the package subgraph, not just one single file.

### `chartjs-plugin-annotation`

- Package metadata exposes `dist/chartjs-plugin-annotation.esm.js` for ESM.
- The ESM build imports `chart.js` and `chart.js/helpers` as bare specifiers.

Conclusion:

- Good candidate for vendored browser ESM.
- Works well if Chart.js is also vendored with a complete import map.
- ESM usage is cleaner than the current global plugin script, but plugin registration becomes explicit.

Example:

```js
import Chart from 'chart.js/auto';
import annotationPlugin from 'chartjs-plugin-annotation';

Chart.register(annotationPlugin);
```

### `@eslopemap/maplibre-gl`

- Current distributed browser file is `dist/maplibre-gl.js`.
- Inspection of the distributed file shows a UMD-style wrapper that initializes a global `maplibregl` object and manages worker bootstrap internally.
- Package metadata is modern, but the browser-ready artifact used here is still best treated as a classic script asset.
- The project docs show bundler-oriented `import { Map } from 'maplibre-gl'` usage, but that is not sufficient evidence that the published browser artifact in this project can be swapped in cleanly without further worker-path and package-subgraph work.

Conclusion:

- Keep as a vendored local classic browser script for now.
- Do not force ESM migration here in the first pass.

### `maplibre-contour`

- Package metadata points `module` to `dist/index.mjs`.
- Inspection of `dist/index.mjs` suggests the distributed browser behavior is still shaped around a bundled/global style bootstrap rather than a clean direct browser-ESM entrypoint.
- The project’s own public examples commonly use it with classic script loading alongside global `maplibregl`.
- Worker behavior is a further risk area for zero-build migration.

Conclusion:

- Keep as a vendored local classic browser script for now.
- Do not force ESM migration here in the first pass.

## Local code impact

### Docs app

`docs/js/docs.js` currently depends on global `marked`.

Recommended migration:

- Import `marked` as ESM.
- Remove runtime dependence on a global CDN script.

### GPX import/export

`js/io.js` already imports `@we-gold/gpxjs` as a module.

Recommended migration:

- Keep the import as-is.
- Replace the runtime CDN import-map target with a local vendored target.

### Profile rendering

`js/profile.js` currently uses global `Chart` plus the global annotation plugin side effect.

Recommended migration:

- Import Chart.js as ESM.
- Import `chartjs-plugin-annotation` as ESM.
- Register the plugin explicitly.

### Main map

`js/main.js` currently depends on global `maplibregl` and global `mlcontour`.

Recommended migration:

- Leave both as local vendored classic scripts in the first pass.
- Revisit only after confirming clean browser ESM entrypoints and worker handling.

## Recommendation

Adopt a hybrid model:

- Use local vendored ESM plus an import map for:
  - `marked`
  - `@we-gold/gpxjs`
  - `chart.js`
  - `chartjs-plugin-annotation`
  - `@kurkle/color`
- Keep local vendored classic scripts for:
  - `@eslopemap/maplibre-gl`
  - `maplibre-contour`

This preserves the zero-build architecture while reducing runtime third-party CDN exposure and making dependency resolution explicit and reviewable.

## Why not full ESM everywhere right now

Main blockers:

- `maplibre-gl` browser deployment here is currently aligned with its UMD-style distributed file and worker bootstrap.
- `maplibre-contour` does not present a clearly low-risk browser-ESM path for this setup.
- Chart.js ESM is viable, but only if vendoring also captures transitive browser files and import-map aliases.

## Implemented direction

Implementation started with:

- a manifest-driven vendoring script
- package age filtering
- local lock file generation
- import-map generation

Current runtime shape:

- app runtime files live under `app/`
- app-owned icons and `manifest.json` also live under `app/`
- vendored dependency assets and generated import-map outputs live under `app/vendor/`
- the vendoring manifest now lives at repo root as `deps.json`
- docs and app both point only to local vendored assets
- import maps resolve local ESM dependencies
- classic scripts remain only where they are still the lower-risk browser delivery format

Additional implementation details:

- `@eslopemap/maplibre-gl` is pinned to exact version `5.21.9`
- exact pinned versions bypass the minimum-age filter, while ranged dependencies still use the age gate
- generated import-map bootstrap files are emitted as:
  - `app/vendor/importmap.app.generated.js`
  - `app/vendor/importmap.docs.generated.js`
- generated JSON snapshots are emitted alongside them for review:
  - `app/vendor/importmap.app.generated.json`
  - `app/vendor/importmap.docs.generated.json`

## Test-mode validation strategy

To keep focused browser validation fast and reduce dependence on third-party tile/network latency, the app now supports `#test_mode=true` in the URL hash.

In test mode:

- basemap is forced to `none`
- analysis mode is forced to empty (`mode=''`)
- contour lines are disabled
- overlay toggles are disabled
- hillshade is hidden and its opacity is forced to `0`
- the `test_mode` flag is preserved during hash synchronization so the page stays in that mode across boot-time URL updates

This was enough to get a focused Playwright validation passing without running the full suite.

Validated successfully with:

- `npx playwright test tests/e2e/persist.spec.js -g "Tracks persist across page reload"`

## Sources checked

- `https://marked.js.org/`
- `https://cdn.jsdelivr.net/npm/marked/package.json`
- `https://www.chartjs.org/docs/latest/getting-started/integration.html`
- `https://cdn.jsdelivr.net/npm/chart.js/package.json`
- `https://cdn.jsdelivr.net/npm/chart.js/dist/chart.js`
- `https://www.chartjs.org/chartjs-plugin-annotation/latest/guide/`
- `https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation/package.json`
- `https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation/dist/chartjs-plugin-annotation.esm.js`
- `https://cdn.jsdelivr.net/npm/@we-gold/gpxjs/package.json`
- `https://cdn.jsdelivr.net/npm/@eslopemap/maplibre-gl/package.json`
- `https://cdn.jsdelivr.net/npm/@eslopemap/maplibre-gl/dist/maplibre-gl.js`
- `https://cdn.jsdelivr.net/npm/maplibre-contour/package.json`
- `https://cdn.jsdelivr.net/npm/maplibre-contour/dist/index.mjs`
- `https://github.com/onthegomap/maplibre-contour`
