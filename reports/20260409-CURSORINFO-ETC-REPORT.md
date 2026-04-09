# Cursor Info & UI Cleanup — Implementation Report

Plan: `plans/20260408-PLAN-CURSORINFO-ETC.md`

## Task 4 — Silence TS lint noise ✅
- Changed `// @ts-check` → `// @ts-nocheck — helpers.js custom fixtures aren't typed` in 7 Playwright e2e spec files.
- Tauri e2e `.mjs` files had no directive; left as-is.

## Task 6 — Cursor info: try all DEM sources ✅
- Refactored `dem.js:queryLoadedElevationAtLngLat` into a loop over `[DEM_HD_SOURCE_ID, DEM_TERRAIN_SOURCE_ID]`.
- Extracted per-source logic into private `queryElevationFromSource(map, lngLat, sourceId)`.
- Added early-out `if (tilesByCanonical.size === 0) return null` to skip sources with no loaded tiles.

## Task 5 — Remove legacy basemap dropdown ✅
- **HTML**: removed hidden `<select id="basemap">` and `<select id="basemap-primary">` + its `.basemap-row` container.
- **main.js**: removed `renderBasemapPrimary()`, `renderBasemapSelect()`, their callers, and the `#basemap`/`#basemap-primary` change event listeners.
- **io.js**: removed auto-select-as-primary logic from `handleTileFile()` (tile is still registered; available via Add layer dropdown).
- **ui.js**: URL hash `basemap` param changed from single ID to comma-separated basemapStack for sharing. Parsing remains backward-compatible (single value or comma list).
- **Layer order panel**: primary basemap now shown bold with "(primary)" suffix.
- **startup-state.js**: `applyUrlOverrides` now handles both `basemap` (single) and `basemapStack` (array) from URL overrides.
- **persist.js**: `'basemap'` kept in `SETTING_KEYS` for migration reads.
- **Tauri e2e tests**: updated `custom-tile-serving.spec.mjs` and `helpers.mjs` to remove basemap-primary references.
- **Unit tests**: updated `ui-url-state.test.mjs` for comma-separated basemap parsing.

## Task 7 — Folder drop (Tauri) 🔲
## Task 8 — Server tile cache size from UI 🔲
## Task 9 — Delete custom sources from UI 🔲
## Task 10 — Cargo build warnings check 🔲
## Task 11 — Test suites pass 🔲
## Task 13 — Update docs 🔲
