# Slope viewer & editor — Feature summary

## Map & Visualization
- **Analysis modes** — `Slope + Color relief` (default), `Slope`, `Aspect`, `Color relief`, and an empty `none` mode that disables the DEM analysis overlay entirely
- **Slope + Color relief mode** — hybrid mode showing slope analysis at zoom ≥ 14 and color-relief below, with a one-zoom-level crossfade
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
- **Drag & drop import** — GPX (tracks, segments, routes, waypoints with names) and GeoJSON files, with visual drop overlay; also supports dropping directories
- **Directory import** — progressive support: File System Access API (Chrome/Edge) for read+write, `<input webkitdirectory>` fallback for read-only, drag & drop directory via `webkitGetAsEntry`
- **Top-right track workspace** — compact floating panel for track management and export
- **Draw mode** — pen button in the track header; creates a new track and enters edit mode; click to add vertices, double-click or `Escape` to finish; vertices can be dragged during editing
- **Track list button state** — pin button is greyed out when there are no tracks and becomes a close button while the track panel is open
- **Multi-track management** — color-coded tracks with selection, deletion (with confirmation), export actions, and active-track emphasis
- **Select vs Edit** — selecting a track widens the line and shows the profile; clicking the edit button (✎) enters edit mode with fully interactive vertices. No separate draw mode — editing new and existing tracks uses the same unified editing state.
- **Vertex selection** — clicking a vertex (desktop) or tapping it (mobile) selects it with blue highlight; an on-map "+" popup appears next to the selected vertex
- **Insert-here** — clicking the on-map "+" popup toggles insert-after mode where new points are inserted between the selected vertex and the next one
- **Insert preview** — dashed line shows where the next point will connect: from last point (append) or between neighbouring vertices (insert-after mode)
- **Track stats** — total distance (km), elevation gain (↑), loss (↓), point count, average slope, and max slope for the active track
- **Elevation enrichment** — all track points (imported and drawn) are enriched from the same DEM source and re-enriched when new DEM tiles load
- **Track markers** — green start / red end dots; mid-point vertices shown only in edit mode
- **Smart hover-insert (desktop)** — when cursor is near the track line between vertices, a single grey marker appears at the closest point; clicking and dragging inserts a new vertex
- **Ctrl/Shift/Meta+click delete** — remove individual track vertices (edit mode only)
- **Desktop vertex editing** — drag vertices to reposition (works in unified edit mode)
- **Mobile vertex editing** — mobile-friendly mode is default on mobile (📱 toggle); crosshair at center, tap inserts at center, tap vertex then pan to reposition. Desktop-style mode also available (tap=click, long-press-drag=move vertex). On localhost, the 📱 toggle is shown on desktop for debugging.
- **Delete last point** — 🗑️ button in toolbar to remove the last point; also Ctrl/Cmd+Z
- **Export** — active track as GPX or GeoJSON; all tracks as GPX preserving group structure (grouped → one `<trk>` per group with `<trkseg>` per segment); includes `<wpt>` elements
- **Directory export** — 'Save to folder…' button for File System Access browsers; writes one GPX per track
- **GPX waypoints** — `<wpt>` elements parsed from GPX via gpxjs; rendered as amber circles with text labels on the map; included in 'Export All GPX'
- **Two-level nesting** — multi-segment GPX tracks import as grouped tracks; panel shows collapsible group header with aggregate stats and nested segments
- **localStorage persistence** — tracks and settings auto-save to localStorage with 300ms debounce; restored on page reload; 'Clear saved data' button in advanced settings

## Profile
- **Elevation profile** — bottom panel showing elevation (m), track slope (°), and terrain slope (°) vs distance (km), with dual Y-axes and a zero-line
- **Reopenable profile** — the track panel includes a profile toggle so closing the chart is not terminal
- **Profile-to-map hover linkage** — hovering the profile highlights the corresponding track vertex on the map and shows cursor tooltip at the vertex
- **Hover pan assist** — if the hovered vertex is out of view, the map pans to bring it back on screen

## UX
- **Settings toggle** — top-left `🌍 Settings` button with auto-collapse when you start dragging the map
- **Elevation & slope display** — configurable via dropdown: `At cursor` (floating tooltip near pointer, default), `Corner` (fixed in legend panel), `No` (hidden)
- **Mobile crosshair** — tapping the map on mobile shows a crosshair at tap location with elevation/slope info; disappears on pan
- **Mobile draw crosshair** — entering draw mode on mobile shows a center cross and a toast hint
- **Track panel header layout** — when open, the header row is `Tracks`, `Profile`, draw button, close button; track details stay below
- **Panel styling** — controls, legend, profile, and the open track panel share the same translucent blurred panel surface
- **Bottom-right controls** — native MapLibre bottom-right stack with navigation, geolocate, ruler, and attribution
- **Legend behavior** — dynamic color ramp for the current mode; in `Mode: none`, the legend collapses to cursor info only
- **Search** — Nominatim geocoding with collapsible search box
- **Ctrl/Cmd+drag** — tilt and rotate the map (same as right-click drag)
- **Toast notifications** — ephemeral messages for mobile edition hints
- **PWA installable** — manifest.json with icons at 192, 512, 180 (apple-touch), 32, 16 sizes; SVG favicon with mountain/slope theme
- **Localhost debug** — mobile-friendly mode toggle (📱) shown on desktop when served from localhost

## Module structure
- **slope.html** — shell with HTML markup, CDN script tags, importmap for `@we-gold/gpxjs`, `<link>` to css/main.css, `<script type="module" src="js/main.js">`
- **css/main.css** — all styles including track group nesting
- **js/main.js** — entry point: creates map, imports all modules, wires settings event handlers, persistence, exposes window getters for tests
- **js/constants.js** — pure data/config: DEM constants, analysis color ramps, basemap config, parsing/legend CSS helpers
- **js/dem.js** — DEM tile processing, elevation sampling, WebGL hybrid border layer with GLSL shaders
- **js/ui.js** — basemap/contour/terrain apply functions, legend, cursor tooltip, URL hash parsing/sync, Nominatim search
- **js/tracks.js** — track data model, CRUD, map sources/layers, stats, panel UI (with group rendering), waypoint layer
- **js/track-edit.js** — interactive track editing: vertex click/drag, insert popup, hover-insert, mobile editing, keyboard shortcuts, draw/undo buttons
- **js/io.js** — import/export (GPX via gpxjs, GeoJSON), drag-drop, directory import/export, file generation
- **js/persist.js** — localStorage persistence for tracks and settings (thin wrapper, no deps)
- **js/profile.js** — Chart.js elevation profile, profile-to-map hover linkage
- **js/state.js** — reactive Proxy store (`createStore`) + `STATE_DEFAULTS`
- **js/utils.js** — pure utility functions (haversine, tile math, Terrarium codec, color utils, file download)

### Dependency flow
- `constants.js` ← `utils.js` (pure, no DOM)
- `dem.js` ← `utils.js`, `constants.js` (no DOM except for fallback tile fetch)
- `ui.js` ← `constants.js`, `utils.js` (DOM access for settings UI)
- `persist.js` — standalone (localStorage only)
- `io.js` ← `utils.js`, `@we-gold/gpxjs` (GPX parsing/serialization)
- `track-edit.js` ← `ui.js` (cursor tooltip)
- `tracks.js` ← `utils.js`, `constants.js`, `dem.js`, `track-edit.js`, `io.js`, `persist.js`
- `profile.js` ← `utils.js`, `dem.js`, `ui.js` (Chart.js + DOM)
- `main.js` ← all modules (orchestrator)
- `state.js` — standalone, imported by `main.js` which creates the store and passes it to modules

## Technical gotchas

- **Contour initialization order** — contour visibility must be re-applied after the contour layers are added, otherwise first-load state can disagree with the checkbox
- **Contour/basemap coupling** — contour lines are auto-enabled only for OSM; switching basemaps intentionally resets the contour checkbox unless you change the logic
- **`Mode: none` behavior** — empty mode disables the custom DEM analysis render path and hides the legend ramp/labels, but keeps cursor info visible
- **Color relief split path** — `color-relief` is rendered via a separate MapLibre layer, not the custom WebGL analysis layer used for slope/aspect; in `slope+relief` mode both layers are active with zoom-dependent opacity expressions providing the crossfade
- **Slope + Color relief mode** — this hybrid mode uses a threshold zoom ≥ `SLOPE_RELIEF_CROSSFADE_Z` ; color-relief opacity uses a MapLibre zoom interpolation expression, while the WebGL slope opacity is pre-computed in `state.effectiveSlopeOpacity` (via `computeEffectiveSlopeOpacity`) so `render()` stays mode-agnostic; legend switches dynamically at the zoom threshold
- **Track button state** — `tracks-btn` must be explicitly synced on startup so the disabled state matches the empty track list before any interaction
- **Native attribution control** — when adding attribution manually in the bottom-right stack, the map must be created with `attributionControl: false` to avoid duplicate attribution UI
- **editingTrackId vs activeTrackId** — `activeTrackId` controls selection (wider line, profile); `editingTrackId` controls which track's vertices are interactive; when creating a new track via the draw button, `editingIsNewTrack` is set for auto-cleanup
- **Hover-insert layer** — a separate GeoJSON source (`hover-insert-point`) holds at most one feature for the smart insert marker, avoiding re-rendering the full track GeoJSON on every mousemove

## Layer Z-Order (bottom to top)
1. Basemap
2. OpenSkiMap overlay
3. Hillshade
4. DEM analysis overlay (`Slope` / `Aspect`) or `Color relief`
5. Contour lines
6. Track lines, vertices, hover-insert marker, and profile-hover marker
7. Waypoint circles and labels

## Detailed behaviour

### Startup
1. Parse URL hash for `lng`, `lat`, `zoom`, `basemap`, `mode`, `opacity`, `terrain`, `exaggeration`, `bearing`, `pitch`. Missing keys fall back to Mont Blanc area at zoom 12, slope mode, 0.45 opacity.
2. Load persisted settings from localStorage (URL hash takes priority over persisted values).
3. Build the MapLibre map with all sources (OSM, OTM, IGN, SwissTopo vector, Kartverket, OpenSkiMap, DEM raster-dem, contour vector tiles).
3. Style layers are defined inline: basemap raster/vector, OpenSkiMap fill/line/symbol, hillshade, color-relief, contours, and a custom WebGL layer for slope/aspect.
4. On `map.on('load')`: apply basemap selection, terrain state, debug grid, global-state properties, add the custom hybrid border layer, contour layers, and wire up elevation sampling.
5. Call `updateCursorInfoVisibility()` to set initial cursor-info display mode.

### DEM analysis rendering
- The custom WebGL layer `dem-analysis-hybrid-border` renders slope or aspect per visible tile. For each tile it checks MapLibre's internal DEM tile manager first (which has proper padded borders for derivative accuracy). If no internal tile exists, it fetches the raw DEM tile as a fallback, decodes Terrarium encoding, pads to a 514×514 Float32 array, and backfills border pixels from loaded neighbours.
- Horn's 3×3 derivative kernel is computed in the fragment shader; the slope/aspect scalar is mapped to a step colour ramp uploaded as uniforms.
- The `color-relief` mode uses a separate MapLibre built-in layer rather than the custom shader.

### Cursor elevation & slope
- **At cursor** (default): a small `#cursor-tooltip` div positioned at `clientX+15, clientY+15` shows elevation and slope. Updated every frame via `requestAnimationFrame`. On profile hover, it repositions to the hovered vertex's screen coordinates.
- **Corner**: the `#cursor-info` element inside the legend panel shows the values (original behaviour).
- **No**: both hidden.
- On mobile: a `#mobile-crosshair` is shown at the tap point with the tooltip. Hidden on drag.

### Settings panel
Contains dropdowns and sliders for: Mode, Basemap, Basemap opacity, Hillshade opacity, Hillshade method, Analysis opacity, Show contour lines, OpenSkiMap overlay, Show DEM tile grid, **Elevation & slope** (cursor/corner/no), Multiply blend, Enable 3D terrain + exaggeration. Also shows internal/fallback tile counts.

### Track editor — state model
- `tracks[]` — array of `{id, name, color, coords, _statsCache, groupId, groupName, segmentLabel}`.
- `waypoints[]` — array of `{id, name, coords, sym, desc, comment}`.
- `activeTrackId` — currently selected track (wider line, profile shown, start/end markers).
- `editingTrackId` — track whose vertices are fully interactive (mid vertices visible, drag/hover-insert enabled). Set when user clicks the ✎ edit button in the track list, or the ✏ draw button to create a new track. There is no separate draw mode — editing a new or existing track uses the same unified editing state.
- `editingIsNewTrack` — boolean. True when editingTrackId was set by creating a new track via the draw button. Controls auto-cleanup on exit (new tracks with < 2 points are removed).
- `selectedVertexIndex` — index of the currently selected vertex in the editing track. Visual feedback: larger blue circle with white stroke.
- `insertAfterIdx` — when set, new points are inserted after this index instead of appended to the end. Activated via the on-map "+" popup next to the selected vertex.
- `mobileFriendlyMode` — boolean. Default true on mobile. When enabled, shows crosshair-centered insertion and pan-to-move vertex editing. On localhost, the toggle is also shown on desktop for debugging.
- `insertPreviewLngLat` — tracks cursor/center position for the insert preview dashed line.
- `insertPopupMarker` — MapLibre marker showing the "+" button on the map next to the selected vertex.

### Track selection vs editing (unified)
- **Select** (click track name): sets `activeTrackId`. Line becomes 4px wide. Profile auto-opens. Only start/end markers visible.
- **Edit** (click ✎ button on existing track, or ✏ button to create new): sets `editingTrackId`. All vertices visible. Map clicks add vertices (append or insert). Vertices are draggable. Double-click or Escape exits editing.
- No separate draw mode — the ✏ button creates a new track and enters the same edit mode as ✎.

### Vertex selection and insert-here
- Clicking a vertex without dragging (desktop) or tapping a vertex (mobile) selects it. Selected vertex shown with blue highlight (radius 7, blue fill).
- When a vertex is selected, an on-map "+" popup appears next to it (as a MapLibre marker, anchored left with offset). Clicking it toggles insert-after mode.
- In insert-after mode, new clicks insert points after the selected vertex (and chain: each insert advances the insertion index).
- Selecting a different vertex while in insert mode moves the insertion point.

### Insert preview
- A dashed line (via `insert-preview-line` source/layer) shows where the next click will connect.
- In append mode: line from last track point to cursor/crosshair.
- In insert-after mode: two lines from `insertAfterIdx` to cursor and from cursor to `insertAfterIdx+1`.
- Updated on `mousemove` (desktop) or `map.move` (mobile-friendly crosshair mode).

### Smart hover-insert (desktop)
- On `mousemove`: for each segment of the editing track, project both endpoints to screen coords, compute the closest point on the segment to the cursor. Skip if the parameter t < 0.1 or > 0.9 (too close to a vertex). If the closest distance < 20px, show a single grey circle marker at that point via the `hover-insert-point` source.
- On `mousedown` near that marker: insert a new vertex at the position, then immediately start drag for that vertex.

### Mobile editing modes
- **Mobile-friendly mode** (📱 button toggle, **default on** for mobile devices, shown on localhost for desktop debugging):
  - Crosshair shown at screen center; tapping anywhere inserts a point at the center position.
  - Tapping a vertex selects it (blue highlight) and enters pan-to-move: toast "Drag screen to move", subsequent pan repositions the vertex keeping it at the center.
  - Touch end confirms the move.
- **Desktop-style mode** (📱 toggled off): tap = click (adds point or selects vertex), long-press (400ms) + drag = move vertex directly.

### Delete last point
- 🗑️ button in the toolbar (visible only when a track is being edited and has points). Removes the last coordinate.
- Ctrl/Cmd+Z also removes the last point during editing.

### Track deletion
- `confirm()` dialog with the track name before removing.

### Profile
- Chart.js line chart with three datasets: elevation (left Y-axis, filled), track slope (right Y-axis, red), terrain slope (right Y-axis, dashed purple).
- `onHover` callback calls `setProfileHoverVertex(index)` which places a circle on the map and, if cursor-info mode is `cursor`, shows the tooltip at the vertex's projected screen position.
- Profile closes automatically when switching away from a 2-point track. Re-openable via the "Profile" button.

### URL hash sync
- `syncViewToUrl` writes `lng, lat, zoom, basemap, mode, opacity, terrain, exaggeration, bearing, pitch` to the hash on every `moveend`, `zoomend`, `rotateend`, `pitchend`.
- `hashchange` event reads the hash back and updates map + state + UI controls.

### GPX / GeoJSON import
- Drag & drop, directory import, or programmatic. GPX parser uses `@we-gold/gpxjs` library for parsing, extracting tracks, routes, and waypoints. Multi-segment tracks are split back into separate grouped tracks using segment point counts from the XML. GeoJSON parser extracts `LineString` and `MultiLineString` geometries.
- Imported tracks are elevation-enriched from the DEM source and fitted to bounds.
- Each imported track stores `_gpxParsed` reference to the parsed GPX document for future round-trip export.
- Waypoints from GPX `<wpt>` elements are stored in a global array and rendered as a map symbol layer.
