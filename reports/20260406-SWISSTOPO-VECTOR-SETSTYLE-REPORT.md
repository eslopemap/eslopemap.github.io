# SwissTopo Vector Integration — setStyle() Approach Report

**Date:** 2026-04-06

## Context

The app needed to integrate the official SwissTopo vector basemap style
(`https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json`).
Two approaches were explored.

---

## Approach 1 — Manual Style Parsing (discarded)

**How it worked:**
- Fetch the external `style.json` at runtime.
- Extract its sources, layers, glyphs, and sprite.
- Dynamically `addSource` / `addLayer` each piece into the existing map style.
- Prefix layer IDs to avoid collisions.

**Pros:**
- No full style swap — app-owned layers (DEM, tracks, contours, overlays) stay in place.
- Single style lifecycle; no rehydration needed.

**Cons:**
- Complex: must parse and replay ~100 SwissTopo layers manually.
- Fragile: layer ordering, sprites, glyphs must all be stitched in correctly.
- Duplicates work MapLibre already does internally when given a style URL.
- Hard to maintain if SwissTopo updates their style.

---

## Approach 2 — `map.setStyle()` (kept)

**How it worked:**
- When the SwissTopo vector basemap is selected, call `map.setStyle(styleUrl)`.
- MapLibre handles all source/layer/sprite/glyph loading natively.
- When switching back to other basemaps, call `map.setStyle(buildAppStyle())`.
- After every `style.load` event, rehydrate app-owned layers and state.

**Pros:**
- Simple: MapLibre handles the complex SwissTopo style natively.
- Correct: sprites, glyphs, layer ordering all handled by the library.
- Maintainable: no code changes needed if SwissTopo updates their style.

**Cons:**
- `setStyle()` wipes all existing layers — requires rehydration of:
  - DEM sources + terrain analysis layers
  - Contour lines
  - Catalog basemap/overlay sources and layers
  - Track/waypoint/selection layers
  - Debug grid
  - Global state properties (basemapOpacity, hillshadeOpacity)
  - Mode, terrain, and contour visibility state
- `setBasemap` must be `async` (style swap is asynchronous).
- Callers (`hashchange`, bookmark apply, basemap `<select>`) must `await`.

---

## Opacity Handling

### Catalog raster basemaps (OSM, IGN, etc.)
Already use `basemapOpacityExpr()` which binds to MapLibre's `global-state`.
Opacity works via `setGlobalStatePropertySafe(map, 'basemapOpacity', value)`.
No per-layer `setPaintProperty` calls needed.

### SwissTopo vector (native style)
The official style has ~100 layers with carefully authored opacity expressions
(zoom-dependent `fill-opacity`, `line-opacity`, `text-opacity`, etc.).
Many layers have no explicit opacity property (implicit 1.0).

**Strategy:** only scale opacity for layers that already define an explicit
opacity paint property. Layers without authored opacity are left untouched.
This preserves the style author's visual intent while still allowing the
basemap opacity slider to have a proportional effect.

---

## Files Changed

| File | Summary |
|------|---------|
| `layer-registry.js` | Added `styleUrl` field to `swisstopo-vector` entry; empty `sources`/`layers`. |
| `layer-engine.js` | `setBasemap` now `async`; delegates style swap to `map.__ensureBasemapStyle`; native layer opacity scaling with authored-value preservation. |
| `main.js` | Extracted `buildAppStyle()` and `ensure*` rehydration helpers; `__ensureBasemapStyle` hook; `style.load` rehydration handler; async callers. |
| `tracks.js` | `rehydrateTrackLayers()` function; font changed to `Frutiger Neue Regular` for SwissTopo glyph compat. |
| `layer-engine.test.mjs` | Tests updated for `__ensureBasemapStyle` mock and scaled opacity assertions. |

---

## Rehydration Checklist (on every `style.load`)

1. App sources: contour, DEM terrain, DEM HD
2. App layers: dem-loader, terrain-analysis, terrain-analysis-relief
3. Catalog sources + layers (all basemaps/overlays)
4. Contour line + contour text layers
5. Debug grid layer
6. Track/waypoint/selection/vertex layers
7. Global state properties (basemapOpacity, hillshadeOpacity)
8. Tile grid (if enabled)
