# slope-hybrid-mltimap-2d — Feature List

## Map & Visualization
- **Analysis modes** — `Slope`, `Aspect`, `Color relief`, and an empty `none` mode that disables the DEM analysis overlay entirely
- **Slope / Aspect overlay** — custom WebGL layer using Horn's algorithm on raster-DEM tiles, with configurable opacity and color ramp
- **Color relief** — DEM color ramp mode rendered with the built-in `color-relief` layer
- **Hillshade** — multiple methods (`standard`, `basic`, `combined`, `multidirectional`, `igor`), configurable opacity
- **Contour lines** — generated client-side from DEM via `maplibre-contour`, auto-shown for OSM only (other basemaps have their own contours), manual toggle available
- **Multiply blend** — optional compositing mode for the DEM analysis overlay on the basemap
- **3D terrain** — toggle with configurable exaggeration

## Basemaps
- **OSM** (default), **OTM**, **IGN plan (FR)**, **SwissTopo vector**, **Kartverket topo (NO)**
- **Basemap opacity** — slider for the visible basemap stack
- **Auto fly-to** — selecting a regional basemap outside its supported area recenters the view
- **URL persistence** — center, zoom, basemap, mode, opacity, terrain state, bearing, and pitch are encoded in the URL hash

## Overlays
- **OpenSkiMap** — independent checkbox overlay (ski areas, runs, lifts, spots) on top of any basemap
- **DEM tile grid** — debug overlay toggle for visible DEM tile coverage

## Track Editor
- **Drag & drop import** — GPX (tracks, segments, routes with names) and GeoJSON files, with visual drop overlay
- **Top-right track workspace** — compact floating panel for track management and export
- **Draw mode** — pen button in the track header; click to add vertices, double-click or `Escape` to finish
- **Track list button state** — pin button is greyed out when there are no tracks and becomes a close button while the track panel is open
- **Multi-track management** — color-coded tracks with selection, deletion, export actions, and active-track emphasis
- **Track stats** — total distance (km), elevation gain (↑), loss (↓), point count, average slope, and max slope for the active track
- **Elevation enrichment** — all track points (imported and drawn) are enriched from the same DEM source and re-enriched when new DEM tiles load
- **Track markers** — green start / red end dots; mid-points and insert-point handles shown only for the active track
- **Insert vertex** — click a midpoint handle between two vertices to insert a new point
- **Ctrl+click delete** — remove individual track vertices
- **Desktop vertex editing** — drag vertices to reposition
- **Mobile vertex editing** — tap a vertex, then pan the map to move it
- **Export** — active track as GPX or GeoJSON; all tracks as a single GPX with multiple segments

## Profile
- **Elevation profile** — bottom panel showing elevation (m), track slope (°), and terrain slope (°) vs distance (km), with dual Y-axes and a zero-line
- **Reopenable profile** — the track panel includes a profile toggle so closing the chart is not terminal
- **Profile-to-map hover linkage** — hovering the profile highlights the corresponding track vertex on the map
- **Hover pan assist** — if the hovered vertex is out of view, the map pans to bring it back on screen

## UX
- **Settings toggle** — top-left `🌍 Settings` button with auto-collapse when you start dragging the map
- **Track panel header layout** — when open, the header row is `Tracks`, `Profile`, draw button, close button; track details stay below
- **Panel styling** — controls, legend, profile, and the open track panel share the same translucent blurred panel surface
- **Bottom-right controls** — native MapLibre bottom-right stack with navigation, geolocate, ruler, and attribution
- **Legend behavior** — dynamic color ramp for the current mode; in `Mode: none`, the legend collapses to cursor info only
- **Cursor elevation & slope** — live DEM readout at the pointer (`Elevation` and `Slope`)
- **Search** — Nominatim geocoding with collapsible search box
- **Ctrl/Cmd+drag** — tilt and rotate the map (same as right-click drag)

## Technical gotchas
- **Contour initialization order** — contour visibility must be re-applied after the contour layers are added, otherwise first-load state can disagree with the checkbox
- **Contour/basemap coupling** — contour lines are auto-enabled only for OSM; switching basemaps intentionally resets the contour checkbox unless you change the logic
- **`Mode: none` behavior** — empty mode disables the custom DEM analysis render path and hides the legend ramp/labels, but keeps cursor info visible
- **Color relief split path** — `color-relief` is rendered via a separate MapLibre layer, not the custom WebGL analysis layer used for slope/aspect
- **Track button state** — `tracks-btn` must be explicitly synced on startup so the disabled state matches the empty track list before any interaction
- **Native attribution control** — when adding attribution manually in the bottom-right stack, the map must be created with `attributionControl: false` to avoid duplicate attribution UI

## Layer Z-Order (bottom to top)
1. Basemap
2. OpenSkiMap overlay
3. Hillshade
4. DEM analysis overlay (`Slope` / `Aspect`) or `Color relief`
5. Contour lines
6. Track lines, vertices, and profile-hover marker
