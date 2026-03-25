# *Refactor to use built-in terrain analysis*

### Dependency
- package.json --- Added `"@eslopemap/maplibre-gl": "5.21.2"` as a dependency

### CDN update
- index.html --- Changed MapLibre GL JS script/CSS from `maplibre-gl@5.20.0` to `@eslopemap/maplibre-gl@5.21.2`; removed the DEM tile status display (`internalCount`/`fallbackCount`)

### Removed custom WebGL shader (biggest win)
- dem.js --- **561 → 84 lines.** Removed the entire `createHybridBorderLayer()` custom WebGL layer (GLSL shaders, tile padding, border backfill, texture management, fallback tile fetching). Kept only `sampleElevationFromDEMData()` and `queryLoadedElevationAtLngLat()` for cursor elevation/slope display.

### New built-in `terrain-analysis` layers\- main.js --- Replaced the custom WebGL layer + old `color-relief` layer with two native `terrain-analysis` layers:\
  - `analysis` --- slope/aspect rendering\
  - `analysis-relief` --- elevation color-relief rendering

  Removed the texture invalidation timer/`flushInternalTextures` code. Cleaned up imports.

### Unified mode switching
- ui.js --- Replaced `applyModeState()` to manage both `terrain-analysis` layers via `setPaintProperty()` (attribute, color, opacity, blend-mode). Removed `computeEffectiveSlopeOpacity()` --- zoom crossfade now uses native MapLibre zoom interpolation expressions. Removed `updateStatus()`.

### State cleanup
- state.js --- Removed `effectiveSlopeOpacity`, `internalCount`, `fallbackCount` from `STATE_DEFAULTS`\
- constants.js --- Removed `CORE_DIM`, `PAD_STRIDE`, `DEM_TILE_URL_TEMPLATE`, `demTileUrl()` (only used by old shader)

### Documentation
- slope.md --- Updated to reflect the built-in `terrain-analysis` architecture

Made changes.