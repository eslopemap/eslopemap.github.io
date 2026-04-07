# Tile Rendering Investigation — Local MBTiles/PMTiles in E2E Tests

**Date**: 2025-04-07  
**Status**: In progress  

## Problem

The `tile-serving.spec.js` e2e tests produce **pure white screenshots** when a locally-served MBTiles or PMTiles source is added as a user layer. The dummy tiles (z1–z3) contain green (75, 162, 116) and dark (22, 22, 22) pixels, but none of that color appears on the rendered map.

## Investigation Timeline

### 1. Hillshade masking (confirmed)

With `basemap=none&mode=`, the `dem-loader` hillshade layer remains **visible** and paints a white/grey shading over everything. Adding `test_mode=true` to the hash disables hillshade (`visibility: 'none'`) and reveals the true rendering state. After this fix the screenshots became 100% pure white instead of ~77% white — confirming hillshade was masking the real issue.

### 2. Tile server responds correctly (confirmed)

The Node.js tile server in `tile-server-helper.js`:
- Receives tile requests at the expected z/x/y coordinates.
- Performs the correct XYZ→TMS row conversion.
- Returns **HTTP 200** with PNG data (~939 bytes per tile).

Server logs show lines like:
```
[tile-server] 200: tile found z=2 x=2 y=2 size=939
```

### 3. MapLibre requests tiles (confirmed)

Playwright network interception shows 20+ tile requests reaching the server and getting 200 responses. At `zoom=1`, MapLibre fetches z=2 tiles (overzoom for retina). All tiles exist in the MBTiles database at z=2 (16 tiles, full global coverage).

### 4. Layer ordering investigated (inconclusive)

The user source layer (`basemap-user-dummy-mbt`) was added via `map.addLayer()` and appeared at the end of the style layer array (rendered on top). The `background` layer (white) is first (rendered below). Layer ordering does **not** explain the white output.

### 5. Opacity expression investigated (partially ruled out)

The catalog entry uses `basemapOpacityExpr(1)` which expands to:
```js
['coalesce', ['global-state', 'basemapOpacity'], 1]
```

The `coalesce` fallback is `1`, so even without `setGlobalStateProperty` the opacity should default to 1.0. As a test, the layer paint was overridden with a fixed `{ 'raster-opacity': 1.0 }` — still white.

### 6. Key observation from Tauri `cargo tauri dev`

The user shared `window.map._serializedLayers` from a running Tauri instance, showing a layer called `basemap-tilejson-dummy-z1-z3` with source `src-tj-dummy-z1-z3`. Crucially, it had:
```
paint: { raster-opacity: 1 }
```
This confirms the Tauri app is adding user tiles through a **TileJSON-based flow** (not the e2e test's manual `addSource`/`addLayer`). The Tauri backend serves tiles via its own Rust tile_server at `localhost:14321`, which generates a proper TileJSON response. The e2e test bypasses TileJSON entirely.

## Root Cause Hypotheses

### Hypothesis A: Missing `minzoom` causes overzoom

The dummy MBTiles file contains tiles at z1–z3 only. The catalog entry sets `maxzoom: 18` but no `minzoom`. MapLibre at zoom=1 on a retina screen may be fetching z=2 or z=3 tiles. Server confirms z=2 tiles are fetched and returned successfully. However, MapLibre might be silently rejecting them due to metadata mismatch.

### Hypothesis B: Browser fetch fails silently

The tile server correctly sends PNG data, but the browser's raster tile decoder might reject the response. **Not yet tested**: fetching a tile URL directly via `fetch()` inside the page context and checking if valid image data arrives.

### Hypothesis C: MapLibre raster source needs TileJSON metadata

Other raster sources (OSM, IGN) use TileJSON with proper metadata including `bounds`, `minzoom`, `maxzoom`. The test creates a bare `{ type: 'raster', tiles: [...], tileSize: 256 }` source. MapLibre might require additional fields for proper rendering.

## Next Steps

1. **Direct fetch test**: fetch a tile URL inside the Playwright page, decode the PNG, check pixels. This isolates whether the issue is in tile serving vs. MapLibre rendering.
2. **TileJSON test**: build a proper TileJSON response (with bounds, center, minzoom/maxzoom) and test if MapLibre renders correctly with it.
3. **Compare with Tauri flow**: the Tauri backend generates TileJSON via `fetch_available_sources` → the e2e test should do the same.

## Files Involved

- `tests/e2e/tile-serving.spec.js` — the failing test
- `tests/e2e/tile-server-helper.js` — Node.js tile server
- `app/js/layer-registry.js:buildCatalogEntryFromTileSource()` — builds catalog entry
- `tests/fixtures/tiles/dummy-z1-z3.mbtiles` — fixture tiles (3 colors: green 87%, dark 8%, white 4%)
- `app/js/main.js:buildDemLoaderLayer()` — hillshade layer (masks tile rendering when active)
