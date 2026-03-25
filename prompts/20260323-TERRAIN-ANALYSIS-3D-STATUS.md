# Terrain Analysis 3D Bug — Root Cause & Fix

## Summary

The `terrain-analysis` layer type (from `@eslopemap/maplibre-gl@5.21.2`) fails to render in **3D terrain mode** when many non-DEM layers (GeoJSON tracks, circles, symbols, etc.) are positioned between the `hillshade` layer and the `terrain-analysis` layer in the MapLibre style layer stack.

**Root cause:** Layer position in the style stack. When terrain-analysis layers are appended to the end of the layer stack via `map.addLayer()` (the default behavior), and 20+ other layers exist above the hillshade, 3D terrain rendering silently drops the terrain-analysis output. This appears to be a **bug in the fork's render-to-texture pipeline** for 3D terrain.

**Fix applied:** Move terrain-analysis layers into the initial style definition, immediately after the hillshade layer, instead of adding them dynamically via `addLayer()` during `map.on('load')`.

**Reproducer:** See [debug-bisect-14.html](../debug-bisect-14.html) — a minimal standalone page that demonstrates the bug.

---

## Context

### Architecture

The app (`slopedothtml`) uses `@eslopemap/maplibre-gl@5.21.2`, a fork of MapLibre GL JS that adds a built-in `terrain-analysis` layer type supporting slope, aspect, and elevation analysis directly from raster-dem tiles.

The app was refactored from a custom WebGL shader layer to use this built-in layer type. Two terrain-analysis layers are used:

- `analysis` — for slope and aspect display
- `analysis-relief` — for elevation/color-relief display

These coexist with a hillshade layer, contour lines (via mlcontour), multiple basemap sources, track/waypoint GeoJSON layers, and various UI overlays.

### The bug

After the refactor, terrain-analysis rendered correctly in **2D** (flat map) but was **invisible in 3D terrain mode** (`map.setTerrain()`). The 3D terrain mesh itself rendered fine — only the terrain-analysis color overlay was missing.

---

## Investigation

### Bisection methodology

A systematic bisection approach was used: starting from a minimal working demo (the published `slope-builtin-published.html` reference), incrementally adding app-specific features until the bug appeared.

### Bisect results

| Bisect | What it tests | Result |
|--------|--------------|--------|
| 1 | TileJSON source + 3D toggle | PASS |
| 2 | Direct tiles, tileSize 512 | PASS |
| 3 | Dynamic addLayer (no beforeId) | PASS |
| 4 | Hillshade + terrain-analysis on same source | PASS |
| 5 | Step ramp (exact app colors) | PASS |
| 6 | Full combo: hillshade + addLayer + 3D toggle | PASS |
| 7 | Zoom-interpolation expression for opacity | PASS |
| 8 | App's exact init order: setTerrain → addLayer → setPaintProperty | PASS |
| 9 | Bisect-8 + hide hillshade when 3D on | PASS |
| 10 | Full replica: global-state, moveLayer, color-relief, contours | PASS |
| 11 | Bisect-10 + mlcontour + antialias + maxTileCache + 30 dummy layers | **FAIL** |
| 12 | Bisect-10 + mlcontour only | PASS |
| 13 | Bisect-10 + antialias + maxTileCacheZoomLevels only | PASS |
| **14** | **Bisect-10 + 30 dummy GeoJSON layers between hillshade and terrain-analysis** | **FAIL** |

### Root cause isolation

Bisect 14 proves the bug:

- Bisect 10 (full app replica without many extra layers) = PASS
- Bisect 14 (same + 30 empty GeoJSON layers added before terrain-analysis) = **FAIL**

The terrain-analysis layers were added via `map.addLayer()` in the `map.on('load')` handler. Because the track system (`initTracks`) also registers a `map.on('load')` handler that adds ~30 track/waypoint/hover layers, these all end up **between** the hillshade and the terrain-analysis layers in the style stack.

In the app, the layer order was:

```
basemap(s) → dem-loader(hillshade) → [30+ track/waypoint/hover/debug layers] → analysis(terrain-analysis) → analysis-relief(terrain-analysis) → contours
```

The correct order (which works) is:

```
basemap(s) → dem-loader(hillshade) → analysis(terrain-analysis) → analysis-relief(terrain-analysis) → [track/waypoint layers] → contours
```

---

## Fix Applied

Moved terrain-analysis layers from dynamic `addLayer()` calls in the load handler into the **initial style definition**, right after the hillshade layer:

```javascript
// In the style.layers array:
{ id: 'dem-loader', type: 'hillshade', source: 'dem-hillshade', ... },
// Terrain analysis layers — must be right after dem-loader for 3D terrain compatibility
{ id: 'analysis', type: 'terrain-analysis', source: 'dem', ... },
{ id: 'analysis-relief', type: 'terrain-analysis', source: 'dem', ... }
// All other layers (tracks, contours, etc.) come after
```

The `applyModeState()` call in the load handler continues to set the correct visibility, opacity expressions, and blend mode after load.

---

## Performance Considerations

### Concern: DEM tiles loaded at startup

With the old approach (dynamic `addLayer` during load), the terrain-analysis layers were added lazily — the map had already started loading and the DEM source was already in use by the hillshade layer.

With the new approach (layers in the initial style), MapLibre will begin requesting DEM tiles **immediately on map creation** for the terrain-analysis layers, even before the load event fires. In practice, the DEM source (`dem`) was already being loaded for `setTerrain()` anyway, so the additional overhead is minimal — the tiles are shared via the source cache.

However, there are now **two raster-dem sources** pointing to the same tile URL:

- `dem` — used by terrain-analysis and `setTerrain()`
- `dem-hillshade` — used by the hillshade layer

This source duplication exists because the fork warns about sharing a DEM source between terrain and hillshade. It does mean **two sets of tile requests** for the same data, which doubles DEM tile bandwidth. This is a known trade-off from the source-splitting work and is not new with this fix.

### Concern: initial paint properties in style

The style now references `state.slopeOpacity`, `state.multiplyBlend`, and `ANALYSIS_COLOR` at map construction time. These values are computed from persisted settings and URL hash before the map is created, so they are correct. The `applyModeState()` call in the load handler then adjusts them (e.g., sets zoom-interpolation expressions for slope+relief mode).

---

## Alternative Fixes Considered

### Alternative 1: `addLayer()` with `beforeId`

MapLibre's `addLayer(layer, beforeId)` accepts an optional second argument to insert a layer before a specific existing layer, rather than appending to the end.

The fix could have been:

```javascript
map.addLayer({ id: 'analysis', ... }, 'dem-debug-grid-line');
```

This would place the terrain-analysis layer right after hillshade in the stack, even when added dynamically. However, this approach is **fragile**: it depends on knowing which layer comes after hillshade at the time of insertion, and that layer (`dem-debug-grid-line`) may not exist yet if the load handlers fire in a different order.

A more robust variant:

```javascript
// Find the first layer after dem-loader and insert before it
const style = map.getStyle();
const demLoaderIdx = style.layers.findIndex(l => l.id === 'dem-loader');
const insertBefore = style.layers[demLoaderIdx + 1]?.id;
map.addLayer({ id: 'analysis', ... }, insertBefore);
```

This is viable but adds complexity and is still dependent on the load handler ordering being correct.

**Verdict:** Valid workaround, but placing layers in the initial style is simpler and guaranteed to produce the correct order.

### Alternative 2: fix the upstream rendering bug

The real issue appears to be a **bug in the fork's 3D terrain render-to-texture pipeline**. In MapLibre's terrain rendering, layers are rendered to off-screen textures (one per tile) and then draped onto the 3D terrain mesh. The `terrain-analysis` layer type participates in this render-to-texture flow.

The bug is that when many non-terrain layers intervene in the layer stack between the DEM-sourced hillshade and the terrain-analysis layer, the render-to-texture pass appears to either:

- Skip the terrain-analysis layer's contribution, or
- Run out of texture slots / render passes and silently drop it, or
- Incorrectly classify it as a non-draping layer due to its stack position

This could be investigated and fixed in the fork (`@eslopemap/maplibre-gl`). The relevant code paths are:

- `render_to_texture.ts` — decides which layers to render to terrain textures
- `terrain.ts` — manages the render-to-texture framebuffers
- `painter.ts` — the main render loop that iterates through layers

A proper upstream fix would ensure that `terrain-analysis` layers are always included in the terrain render pass regardless of their position in the layer stack. This would remove the fragile ordering constraint.

**Verdict:** This is the correct long-term fix. The current workaround (layers in initial style) is adequate for now but the ordering constraint should be documented and eventually removed via a fork fix.

### Alternative 3: single DEM source (remove source splitting)

The source split (`dem` vs `dem-hillshade`) was introduced to suppress fork warnings about sharing a DEM source between terrain and hillshade. If those warnings are benign (the rendering works fine despite them), the split could be reverted to reduce tile bandwidth.

**Verdict:** To be evaluated. The warnings may indicate real rendering quality issues, or they may be overly cautious. Reverting would halve DEM tile requests.

---

## Reproducer: debug-bisect-14.html

This file is a minimal standalone page that demonstrates the bug. It:

1. Creates a map with a basemap, a hillshade layer, and a raster-dem source
2. On load, enables 3D terrain
3. Adds 30 empty GeoJSON layers (simulating the app's track/waypoint layers)
4. Adds terrain-analysis layers **after** the 30 dummy layers
5. Result: terrain-analysis is invisible in 3D mode

To verify: remove the loop that adds 30 dummy layers → terrain-analysis renders correctly.

The file uses `@eslopemap/maplibre-gl@5.21.2` from unpkg and requires no build step.

---

## Recommended next steps

2. **Evaluate DEM source deduplication** — test whether reverting to a single `dem` source (shared between hillshade and terrain-analysis) causes real rendering issues or just warnings.
3. **File upstream bug** — report the layer-ordering issue in the `@eslopemap/maplibre-gl` fork with `debug-bisect-14.html` as the reproducer. The 3D render-to-texture pipeline should handle terrain-analysis layers regardless of their position in the stack.