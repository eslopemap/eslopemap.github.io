# slope-hybrid-mltimap-2d — Feature List

## Map & Visualization
- **Slope / Aspect overlay** — custom WebGL layer using Horn's algorithm on raster-DEM tiles, with configurable opacity and color ramp
- **Hillshade** — multiple methods (standard, basic, combined, multidirectional, Igor), configurable opacity
- **Contour lines** — generated client-side from DEM via `maplibre-contour`, auto-shown for OSM only (other basemaps have built-in contours), manual toggle available
- **Multiply blend** — optional compositing mode for slope overlay on basemap
- **3D terrain** — toggle with configurable exaggeration

## Basemaps
- **OSM** (default), **OTM**, **IGN plan (FR)**, **SwissTopo vector**, **Kartverket topo (NO)**
- Basemap opacity slider
- Auto fly-to when selecting region-specific basemap from outside its coverage
- Basemap persisted in URL hash

## Overlays
- **OpenSkiMap** — independent checkbox overlay (ski areas, runs, lifts, spots) on top of any basemap

## Track Editor
- **Drag & drop import** — GPX (tracks, segments, routes with names) and GeoJSON files, with visual drop overlay
- **Elevation profile** — bottom panel showing elevation (m) + slope (%) vs distance (km) for active track, dual Y-axes
- **Draw mode** — pen button, click-to-add-vertex, double-click or Escape to finish
- **Desktop vertex editing** — drag vertices to reposition
- **Mobile vertex editing** — tap vertex then pan map to move it
- **Elevation enrichment** — all track points (imported and drawn) enriched from the same DEM source; re-enriched when new tiles load
- **Multi-track management** — track list panel with color coding, point counts, delete per track
- **Export** — GPX and GeoJSON with elevation, exports active track only

## UI
- **Compass** — indicates map rotation, click to reset bearing & pitch to north/flat
- **Search** — Nominatim geocoding with collapsible search box
- **Legend** — dynamic color ramp for current mode (slope/aspect)
- **Cursor elevation** — live readout from DEM
- **DEM tile grid** — debug overlay toggle
- **URL hash** — persists center, zoom, basemap selection

## Layer Z-Order (bottom to top)
1. Basemap
2. OpenSkiMap overlay
3. Hillshade
4. Slope/Aspect overlay
5. Contour lines
6. Track lines & vertices
