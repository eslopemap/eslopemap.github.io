# Layer Architecture Refactor Report

## Summary

Refactored the layer management system from hardcoded per-overlay booleans and inline map style to a declarative catalog + engine architecture. Added bookmark system and layer-order panel.

## New Files

- **`app/js/layer-registry.js`** — Declarative `LAYER_CATALOG` array describing all basemaps and overlays (sources, layers, UI metadata, region bounds). Provides lookup helpers (`getCatalogEntry`, `getBasemaps`, `getOverlays`, `getLayerIds`) and `buildCatalogSources()`/`buildCatalogLayers()` for map style generation. Also provides `generateBookmarkName()`.

- **`app/js/layer-engine.js`** — Consumes the catalog to:
  - Toggle basemaps (`setBasemap`) and overlays (`setOverlay`, `applyAllOverlays`)
  - Manage z-order (`syncLayerOrder`, `applyLayerOrder`, `reorderLayer`)
  - Apply per-layer settings (`applyLayerOpacity`, `applyAllLayerSettings`)
  - CRUD bookmarks (`createBookmark`, `applyBookmark`, `deleteBookmark`, `renameBookmark`)
  - Migrate legacy persisted settings (`migrateSettings`)

## Modified Files

- **`app/js/constants.js`** — Removed all `BASEMAP_LAYER_GROUPS`, `BASEMAP_DEFAULT_VIEW`, `*_LAYER_IDS`, `ALL_BASEMAP_LAYER_IDS` arrays. Added `basemapOpacityExpr()` (moved from `ui.js` to break circular dep).

- **`app/js/state.js`** — Replaced `showOpenSkiMap`, `showSwisstopoSki`, etc. booleans with `activeOverlays[]`, `layerOrder[]`, `layerSettings{}`, `bookmarks[]`.

- **`app/js/persist.js`** — Updated `SETTING_KEYS` to new shape (`activeOverlays`, `layerOrder`, `layerSettings`, `bookmarks`).

- **`app/js/ui.js`** — Removed `applyBasemapSelection`, `applyOpenSkiMapOverlay`, `applySwisstopoSkiOverlay`, `applySwisstopoSlopeOverlay`, `applyIgnSkiOverlay`, `applyIgnSlopesOverlay`. Re-exports `basemapOpacityExpr` from `constants.js`. Uses `getCatalogEntry` for basemap validation in `parseHashParams`.

- **`app/js/main.js`** — Replaced ~250 lines of inline sources/layers with `buildCatalogSources()`/`buildCatalogLayers()`. Replaced per-overlay event handlers and apply calls with engine functions. Added dynamic UI rendering: `renderBasemapSelect()`, `renderOverlayList()`, `renderLayerOrderPanel()`, `renderBookmarkList()`, `syncOverlayCheckboxes()`.

- **`app/index.html`** — Replaced hardcoded overlay checkboxes with overlay dropdown (`#overlay-dropdown`/`#overlay-list`). Added bookmark section (`#bookmark-list`, `#bookmark-save-btn`). Added layer-order panel toggle button and panel (`#layer-order-panel`/`#layer-order-list`).

- **`app/css/main.css`** — Added styles for overlay dropdown, bookmark UI, and layer-order panel.

- **`plans/20260331-PLAN-LAYERS.md`** — Updated with bookmark system (§4) and layer-order panel (§5) sections; renumbered persistence (§6) and migration (§7).

## Backward Compatibility

- `migrateSettings()` in `layer-engine.js` converts old `showOpenSkiMap`/`showSwisstopoSki`/etc. booleans to the new `activeOverlays` array on load.
- All 37 unit tests and 44 e2e tests pass without modification.

## Architecture

```
constants.js ── basemapOpacityExpr()
       ↓
layer-registry.js ── LAYER_CATALOG, helpers
       ↓
layer-engine.js ── basemap/overlay/order/bookmark/settings logic
       ↓
main.js ── map init, dynamic UI, event wiring
```

No circular dependencies.
