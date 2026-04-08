# On-Demand Layer Instantiation Refactor

**Date:** 2026-04-08

## Problem

The previous architecture pre-added **all** catalog sources and layers to the MapLibre map at startup (via `buildCatalogSources()` and `buildCatalogLayers()` in `buildAppStyle()`), and re-injected them on every `style.load` event (via `ensureCatalogRuntimeLayers()`).

This caused three issues:

1. **`style.load` re-injection penalty:** Every basemap switch (e.g. to `swisstopo-vector`) triggers `map.setStyle()` → `style.load` → `ensureCatalogRuntimeLayers()` which loops the *entire* catalog. With N user tile sources, this adds N hidden source/layer pairs on every switch.

2. **TileJSON network storm:** `map.addSource()` immediately fetches TileJSON manifests, even for hidden layers. Pre-adding all discovered local tile sources would hammer the local HTTP server with simultaneous manifest requests at startup and on every style reload.

3. **Unbounded catalog:** The Tauri desktop auto-discovery (`fetchAvailableSources`) means the catalog size is no longer bounded by the ~12 built-in entries — users can have dozens of local `.mbtiles`/`.pmtiles` files.

Additionally, a **visibility sync bug** existed: `setBasemapStack()` would force-show all layers in the active stack, overriding the user's manual hide (via the eye toggle in the Layers panel). This happened because `layerSettings.hidden` was not consulted when computing `activeIds`.

## Solution

### On-demand instantiation

- **Removed** `buildCatalogSources()` and `buildCatalogLayers()` from `layer-registry.js` (dead code).
- **Removed** `ensureCatalogRuntimeLayers()` from `main.js`.
- **Added** `ensureCatalogEntry(map, catalogId)` in `layer-engine.js` — creates sources/layers for a single catalog entry, only when activated. Layers are added hidden before `dem-loader`.
- **Updated** `setBasemapStack()`, `setOverlay()`, `applyAllOverlays()` to call `ensureCatalogEntry()` just-in-time.
- **Updated** `ensureAppRuntimeLayers()` → `ensureActiveCatalogLayers()` to only re-inject sources/layers for entries in `state.basemapStack` and `state.activeOverlays`.
- **Updated** `buildAppStyle()` to no longer include catalog sources/layers in the initial style.

### Visibility fix

- `setBasemapStack()` now respects `state.layerSettings[id].hidden` — manually-hidden basemaps stay hidden after stack changes.
- `applyAllOverlays()` similarly respects the hidden state.

### Debug panel enhancement

- Debug layers panel now shows: minzoom, maxzoom, bounds, blend-mode per layer.
- Removed the `src` column (redundant).
- Added source count to the summary line.

## Files changed

| File | Change |
|------|--------|
| `app/js/layer-engine.js` | Added `ensureCatalogEntry()`. Updated `setBasemapStack`, `setOverlay`, `applyAllOverlays` for on-demand + visibility fix. |
| `app/js/layer-registry.js` | Removed `buildCatalogSources()`, `buildCatalogLayers()`, `getAllOverlayLayerIds()`. |
| `app/js/main.js` | Removed pre-add from `buildAppStyle()`. Replaced `ensureCatalogRuntimeLayers` with `ensureActiveCatalogLayers`. Enhanced debug panel. Removed stale imports. |
| `app/js/constants.js` | Updated comment. |
| `app/js/io.js` | (no change — already uses `window.refreshTileLayers`) |
| `app/index.html` | (no change beyond previous debug panel) |
| `tests/unit/layer-engine.test.mjs` | Replaced `buildCatalogSources`/`buildCatalogLayers` tests with `ensureCatalogEntry` on-demand + idempotency tests. |

## Test results

- **115 unit tests** pass
- **73 e2e tests** pass
- No snapshot updates needed
