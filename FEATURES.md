# Slope Mapper — Feature summary

## Map & Visualization
- **Analysis modes** — `Slope + Color relief` (default), `Slope`, `Aspect`, `Color relief`, and an empty `none` mode that disables the DEM analysis overlay entirely
- **Slope + Color relief mode** — hybrid mode showing slope analysis at zoom ≥ 14 and color-relief below, with a one-zoom-level crossfade
- **Slope / Aspect overlay** — built-in `terrain-analysis` layer type from `@eslopemap/maplibre-gl`, with configurable opacity and color ramp
- **Color relief** — built-in `terrain-analysis` layer with `elevation` attribute
- **Hillshade** — multiple methods (`standard`, `basic`, `combined`, `multidirectional`, `igor`), configurable opacity
- **3D terrain compatibility** — hillshade and the debug `color-relief` fallback each use their own duplicated raster-dem source so they stay independent from the terrain-analysis / `setTerrain()` DEM path
- **Contour lines** — generated client-side from DEM via `maplibre-contour`, auto-shown for OSM only (other basemaps have their own contours), manual toggle available
- **Multiply blend** — optional compositing mode for the DEM analysis overlay on the basemap
- **3D terrain** — toggle with configurable exaggeration

## Basemaps & Layer Catalog
- **Declarative layer catalog** — single `LAYER_CATALOG` array in `layer-registry.js` defines all basemaps and overlays with sources, layers, regions, and default views
- **User tile sources** — `registerUserSource()` / `unregisterUserSource()` allow runtime addition of `.mbtiles`/`.pmtiles` tile sources; `buildCatalogEntryFromTileSource()` auto-generates catalog entries from tile server URLs
- **Multi-basemap stack** — `basemapStack[]` state allows stacking multiple basemaps with independent per-basemap opacity via `basemapOpacities{}`; `setBasemapStack()` handles style-backed and catalog basemaps
- **Unified Layers panel** — all active layers (basemaps + overlays) shown in a single panel with visibility toggle, opacity slider, remove button, and drag-and-drop reorder; basemaps shown bold
- **Add layer dropdown** — single structured `<select>` with `<optgroup>`s for Basemaps and Overlays; replaces separate basemap-stack and overlay controls
- **Primary basemap selector** — dedicated `<select>` for choosing the main basemap, separate from additional layer stacking
- **Auto-open Layers panel** — Layers panel auto-shows when adding a layer via the dropdown
- **Built-in basemaps**: OSM (default), OTM, IGN plan (FR), SwissTopo vector, SwissTopo raster, IGN topo (FR), IGN ortho (FR), Kartverket topo (NO), None
- **Auto fly-to** — selecting a regional basemap outside its supported area recenters the view
- **URL persistence** — center, zoom, basemap, mode, opacity, terrain state, bearing, and pitch are encoded in the URL hash
- **Settings migration** — `migrateSettings()` handles legacy `basemap` string → `basemapStack[]` and legacy overlay booleans → `activeOverlays[]`

## Overlays
- **OpenSkiMap** — independent checkbox overlay (ski areas, runs, lifts, spots) on top of any basemap
- **SwissTopo ski routes (CH)** — ski touring routes overlay from swisstopo
- **SwissTopo slope >30° (CH)** — avalanche-relevant steep terrain overlay from swisstopo
- **IGN ski routes (FR)** — winter hiking routes overlay from IGN
- **IGN slope >30° (FR)** — steep terrain overlay from IGN
- **DEM tile grid** — debug overlay toggle for visible DEM tile coverage

## Track Editor
- **Drag & drop import** — GPX (tracks, segments, routes, waypoints with names) and GeoJSON files, with visual drop overlay; also supports dropping directories
- **Single-file  and Directory import** — progressive support: File System Access API (Chrome/Edge) for read+write, `<input webkitdirectory>` fallback for read-only, drag & drop directory via `webkitGetAsEntry`
- **Workspace tree** — hierarchical tree view in the track panel showing folder → file → track → segment/route/waypoint nodes with disclosure toggles and type icons (📁📄🛤️🧭📍)
- **Context menu** — right-click, long-press, the row kebab (⋮), or the persistent top-right actions button opens the relevant context menu for the selected item; file nodes expose `New track` and `Export GPX`, while track and route nodes expose edit/profile/geometry actions plus `Export GPX`
- **Route-aware tree actions** — route nodes now expose `Convert to track` and `Convert and replace`; track and segment nodes expose `Simplify`, `Add intermediate points`, and `Split`; grouped track nodes expose `Merge segments into one`
- **Info editor** — modal dialog for editing GPX metadata fields per node type: name/desc for files, name/desc/cmt/type for tracks and routes, name/desc/cmt/sym/type for waypoints; saves through the existing persistence flow; Ctrl/Cmd+I shortcut opens Info for the active track
- **Top-right track workspace** — compact floating panel for track management; the always-visible header row now carries global workspace actions only (new, import file/folder, profile, active-item actions, track list)
- **Left edit rail** — vertically centered rail on the left side of the map with New (+), Edit (✎), Undo (↩), Rectangle selection (⬚), and Mobile (📱) buttons; mirrors the existing toolbar actions and the Edit button directly toggles edit mode for the active track
- **Action scopes** — object-specific geometry and export actions now live in the active-item context menu and per-row kebab menu, while the persistent top row stays reserved for global workspace actions to avoid duplicate entry points
- **Selection-context highlighting** — when a rectangle selection span is active, eligible actions turn bright blue while unrelated actions dim or disable; hovering an action updates the anchored selection hint with its consequence preview
- **Keyboard shortcuts** — central shortcut registry with focus guards (no firing inside inputs/textareas); Ctrl/Cmd+P (toggle profile), Ctrl/Cmd+L (toggle track list), N (new track), E (edit active track), R (toggle rectangle selection), Ctrl/Cmd+I (Info editor), Esc (exit edit mode or clear selection); macOS Cmd parity for all Ctrl shortcuts
- **Draw mode** — `+` button creates a new track and enters edit mode; click to add vertices, double-click or `Escape` to finish; when a newly drawn track is finished, the `Info` editor opens automatically (preferring the parent file when the track was created in a new file)
- **Track rename** — double-click a track name in the panel (or group header) to inline-edit; press Enter to commit, Escape to cancel
- **Track list button state** — pin button is greyed out when there are no tracks and becomes a close button while the track panel is open
- **Track panel auto-scroll** — selecting or activating a track scrolls the workspace tree so the active row stays visible
- **Multi-track management** — color-coded tracks with selection, deletion (with confirmation), export actions, and active-track emphasis
- **Select vs Edit** — selecting a track widens the line and shows the profile; clicking the edit button (✎) enters edit mode with fully interactive vertices. No separate draw mode — editing new and existing tracks uses the same unified editing state.
- **Vertex selection** — clicking a vertex (desktop) or tapping it (mobile) selects it with blue highlight; an on-map "+" popup appears next to the selected vertex
- **Insert-here** — clicking the on-map "+" popup toggles insert-after mode where new points are inserted between the selected vertex and the next one
- **Insert preview** — dashed line shows where the next point will connect: from last point (append) or between neighbouring vertices (insert-after mode)
- **Track stats** — total distance (km), elevation gain (↑), loss (↓), point count, average slope, and max slope for the active track
- **Elevation enrichment** — all track points (imported and drawn) are enriched from the same DEM source and re-enriched when new DEM tiles load
- **Track markers** — green start / red end dots; mid-point vertices shown only in edit mode
- **Smart hover-insert (desktop)** — when cursor is near the track line between vertices, a single grey marker appears at the closest point; clicking and dragging inserts a new vertex
- **Shift/Ctrl/Meta+click delete** — remove individual track vertices (edit mode only)
- **Delete from insertion point** — Delete key or Backspace deletes the currently selected vertex first, then the insertion-point vertex, then the last point as fallback
- **Undo stack** — real undo (Ctrl+Z / Cmd+Z / ↩ toolbar button) with coordinate snapshots; captures state before every mutation (add, delete, move, rect-delete); max 50 entries; cleared on enter/exit edit mode
- **Rectangle delete** — ⬚ button in toolbar (visible during editing); drag a rectangle on the map to select all track points inside, then delete them; red dashed feedback overlay, toast notification with count. On mobile, touch-drag draws the rectangle and a confirmation dialog appears before deleting.
- **Rectangle selection** — explicit `Rectangle selection` mode resolves all hit points on the active track to the smallest enclosing continuous span, keeps the selection anchored with an informational popup, and reuses the existing action row for follow-up operations; works during both editing and non-editing modes; `Esc` clears the active selection span
- **Add intermediate points** — densifies the full active track or the selected span so no surviving gap exceeds 5 m; interpolates elevation and timestamps when present
- **Simplify** — defaults to Visvalingam-Whyatt with elevation-extrema protection and a post-pass max-gap rule (`15 × horizontal tolerance`); Douglas-Peucker is available as an advanced prompt option
- **Split / Merge** — split can operate on a selected point or selected span; grouped sibling segments can be merged back into one segment from the tree context menu or the action row when a grouped track is active
- **Route to track conversion** — imported GPX routes stay typed as routes in the workspace tree and can be converted to a sibling track or replaced in-place with track metadata
- **Desktop vertex editing** — drag vertices to reposition (works in unified edit mode); right-click always pans/rotates (never adds points)
- **Mobile vertex editing** — mobile-friendly mode is default on mobile (📱 toggle); crosshair at center, tap inserts at center, tap vertex then pan to reposition. Desktop-style mode also available (tap=click, long-press-drag=move vertex). On localhost, the 📱 toggle is shown on desktop for debugging.
- **Export** — active track as GPX or GeoJSON from the footer export bar; individual file, track, and route export as GPX from the context menu; all tracks as GPX preserving group structure (grouped → one `<trk>` per group with `<trkseg>` per segment); includes `<wpt>` elements and route exports
- **Directory export** — 'Save to folder…' button for File System Access browsers; writes one GPX per track
- **GPX waypoints** — `<wpt>` elements parsed from GPX via gpxjs; rendered as amber circles with text labels on the map; included in 'Export All GPX'
- **GPX timestamps** — `<time>` elements parsed from GPX and stored as epoch-ms in `coords[3]`; preserved in export; enables speed/pace computation and time-based profile x-axis
- **Two-level nesting** — multi-segment GPX tracks import as grouped tracks; panel shows collapsible group header with aggregate stats and nested segments (group names also editable on double-click)
- **localStorage persistence** — tracks and settings auto-save to localStorage with 300ms debounce; restored on page reload; 'Clear saved data' button in advanced settings

## Profile
- **Elevation profile** — bottom panel showing configurable data curves vs distance or time, with dynamic Y-axes
- **Profile datasets** — elevation (m), track slope (°), terrain slope (°), horizontal speed (km/h), vertical speed (m/h); each toggled via the ⚙ display menu
- **X-axis modes** — Distance (km, default), Time (elapsed), Time (no pauses), Date/Time; time modes require GPX timestamps and are auto-disabled for hand-drawn tracks
- **Pause detection** — pauses detected from GPX timestamps exceeding a configurable threshold (default 5 min, adjustable 1–30 min in Advanced settings); shown as red dots with duration labels on the profile chart
- **Display settings menu** — ⚙ button in the profile header opens a dropdown with checkboxes for each dataset and an x-axis selector; settings are persisted to localStorage
- **Reopenable profile** — the track panel includes a profile toggle so closing the chart is not terminal
- **Profile-to-map hover linkage** — hovering the profile highlights the corresponding track vertex on the map and shows cursor tooltip at the vertex
- **Hover pan assist** — if the hovered vertex is out of view, the map pans to bring it back on screen
- **Profile span filter** — when a rectangle selection span is active, the profile switches to that continuous span, shows a filter badge in the header, and provides a one-click `Full` reset button

## UX
- **Settings toggle** — top-left `🌍 Settings` button with auto-collapse when you start dragging the map
- **Elevation & slope display** — configurable via dropdown: `At cursor` (floating tooltip near pointer, default on desktop), `Corner` (fixed in legend panel, default on mobile), `No` (hidden)
- **Mobile center crosshair** — a small '+' crosshair is always shown at the center of the screen on mobile, continuously updating the corner elevation & slope info as the map moves. During track editing, the crosshair becomes larger and blue.
- **Mobile tap crosshair** — tapping the map on mobile shows a crosshair at tap location with elevation/slope info; disappears on pan
- **Track panel header layout** — when open, the header stays sticky while the tree scrolls so the workspace actions remain visible
- **Panel styling** — controls, legend, profile, and the open track panel share the same translucent blurred panel surface
- **Bottom-right controls** — native MapLibre bottom-right stack with navigation, geolocate, ruler, and attribution
- **Legend behavior** — dynamic color ramp for the current mode; in `Mode: none`, the legend collapses to cursor info only
- **Search** — Nominatim geocoding with collapsible search box
- **Ctrl/Cmd+drag** — tilt and rotate the map (same as right-click drag)
- **Toast notifications** — ephemeral messages for track editing hints (mobile mode, rect-delete count, editing stopped on double-click)
- **PWA installable** — manifest.json with icons at 192, 512, 180 (apple-touch), 32, 16 sizes; SVG favicon with mountain/slope theme
- **Localhost debug** — mobile-friendly mode toggle (📱) shown on desktop when served from localhost
- **Help link** — toolbar link to the user guide
- **Geolocate on first run** — triggers browser geolocation on first visit (no saved URL hash or settings)
- **Test mode** — `#test_mode=true` URL flag disables all basemaps, overlays, and DEM rendering for fast E2E testing
- **Root redirect** — `index.html` at repo root redirects to `app/index.html` for GitHub Pages

## Desktop app (Tauri v2)
- **GPX folder sync** — `pickAndWatchFolder()` watches a folder for GPX changes, with live reload via `notify` file watcher and conflict resolution (keep-disk / keep-app)
- **Local tile server** — built-in HTTP tile server on port 14321 serving `.mbtiles` (via rusqlite) and `.pmtiles` (via HTTP Range serving) as `{z}/{x}/{y}` tiles
- **Tile source management** — `addTileSource()` / `removeTileSource()` / `listTileSources()` IPC commands; sources auto-registered into the JS layer catalog
- **Tile source discovery** — `scanTileFolder()` scans a directory for `.mbtiles`/`.pmtiles` files, reads MBTiles metadata (name, format, bounds, center, zoom range, description), and auto-registers all found sources
- **Runtime adapter** — `tauri-bridge.js` provides a unified API; browser mode falls back gracefully (no-op or error for desktop-only features)
- **Desktop config injection** — Rust injects `__SLOPE_RUNTIME__` and `__SLOPE_DESKTOP_CONFIG__` globals into the webview at startup

## Module structure
- **index.html** — shell with HTML markup, CDN script tags, importmap for `@we-gold/gpxjs`, `<link>` to css/main.css, `<script type="module" src="js/main.js">`
- **css/main.css** — all styles including track group nesting, workspace tree, context menu, Info editor, left edit rail
- **js/main.js** — entry point: creates map, imports all modules, wires settings event handlers, persistence, shortcuts, left rail, exposes window getters for tests
- **js/constants.js** — pure data/config: DEM constants, analysis color ramps, basemap config, parsing/legend CSS helpers
- **js/dem.js** — Elevation sampling from loaded DEM tiles (cursor elevation & slope)
- **js/ui.js** — basemap/contour/terrain apply functions, legend, cursor tooltip, URL hash parsing/sync, Nominatim search
- **js/tracks.js** — track data model, CRUD, map sources/layers, stats, panel UI (with group rendering), waypoint layer, tree integration
- **js/track-edit.js** — interactive track editing: vertex click/drag, insert popup, hover-insert, mobile editing, keyboard shortcuts, undo stack, draw/undo buttons
- **js/io.js** — import/export (GPX via gpxjs with timestamp preservation, GeoJSON), drag-drop, directory import/export, file generation; calls `onFileBatchImported` for tree sync
- **js/persist.js** — localStorage persistence for tracks, settings, profile display settings, and workspace tree (thin wrapper, no deps)
- **js/profile.js** — Chart.js elevation profile with speed, pause detection, display settings menu, multiple x-axis modes
- **js/track-ops.js** — pure FEAT2 operation layer for normalized selection spans, route conversion, simplify, split, merge, densify, and consequence descriptions
- **js/selection-tools.js** — rectangle selection controller with touch/desktop drag handling, enclosing-span resolution, and anchored hint popup
- **js/layer-registry.js** — declarative layer catalog (`LAYER_CATALOG`), user source registry, catalog lookup helpers
- **js/layer-engine.js** — basemap stack, overlay toggle, z-order, per-layer opacity, bookmarks, settings migration
- **js/tauri-bridge.js** — runtime adapter: Tauri IPC commands (desktop) with browser fallbacks (web)
- **js/state.js** — reactive Proxy store (`createStore`) + `STATE_DEFAULTS` + `TREE_STATE_DEFAULTS`
- **js/utils.js** — pure utility functions (haversine, tile math, Terrarium codec, color utils, file download)
- **js/gpx-model.js** — GPX workspace tree data model: node constructors (folder, file, track, segment, route, waypoint), stable IDs, tree traversal helpers, action-target resolution shell
- **js/gpx-tree.js** — workspace tree renderer: hierarchical tree in track panel, context menu (right-click/long-press/kebab), Info editor modal, tree–track data sync
- **js/shortcuts.js** — central keyboard shortcut registry with focus guards, macOS Cmd parity

### Dependency flow
- `constants.js` ← `utils.js` (pure, no DOM)
- `dem.js` ← `constants.js` (no DOM)
- `ui.js` ← `constants.js`, `utils.js` (DOM access for settings UI)
- `persist.js` — standalone (localStorage only)
- `io.js` ← `utils.js`, `@we-gold/gpxjs` (GPX parsing/serialization)
- `track-edit.js` ← `ui.js` (cursor tooltip)
- `gpx-model.js` — standalone (pure data)
- `gpx-tree.js` ← `gpx-model.js`, `persist.js`
- `shortcuts.js` — standalone (DOM keydown listener)
- `tracks.js` ← `utils.js`, `constants.js`, `dem.js`, `track-edit.js`, `io.js`, `persist.js`, `gpx-tree.js`
- `profile.js` ← `utils.js`, `dem.js`, `ui.js`, `persist.js` (Chart.js + DOM)
- `main.js` ← all modules (orchestrator), `shortcuts.js`, `gpx-tree.js`
- `state.js` — standalone, imported by `main.js` which creates the store and passes it to modules

## Technical gotchas

- **Contour initialization order** — contour visibility must be re-applied after the contour layers are added, otherwise first-load state can disagree with the checkbox
- **Contour/basemap coupling** — contour lines are auto-enabled only for OSM; switching basemaps intentionally resets the contour checkbox unless you change the logic
- **`Mode: none` behavior** — empty mode hides both `terrain-analysis` layers and the legend ramp/labels, but keeps cursor info visible
- **Color relief split path** — both slope/aspect and color-relief use the built-in `terrain-analysis` layer type from `@eslopemap/maplibre-gl`; in `slope+relief` mode two `terrain-analysis` layers are active with zoom-dependent opacity expressions providing the crossfade
- **Slope + Color relief mode** — this hybrid mode uses a threshold zoom ≥ `SLOPE_RELIEF_CROSSFADE_Z`; both terrain-analysis layers use MapLibre zoom interpolation expressions for their opacity; legend switches dynamically at the zoom threshold
- **Track button state** — `tracks-btn` must be explicitly synced on startup so the disabled state matches the empty track list before any interaction
- **Native attribution control** — when adding attribution manually in the bottom-right stack, the map must be created with `attributionControl: false` to avoid duplicate attribution UI
- **editingTrackId vs activeTrackId** — `activeTrackId` controls selection (wider line, profile); `editingTrackId` controls which track's vertices are interactive; when creating a new track via the draw button, `editingIsNewTrack` is set for auto-cleanup
- **Hover-insert layer** — a separate GeoJSON source (`hover-insert-point`) holds at most one feature for the smart insert marker, avoiding re-rendering the full track GeoJSON on every mousemove

## Layer Z-Order (bottom to top)
1. Basemap
2. Hillshade
3. DEM analysis overlay (`Slope` / `Aspect`) or `Color relief`
4. OpenSkiMap overlay (moved above analysis on load so blend mode composites cleanly)
5. Contour lines
6. Track lines, vertices, hover-insert marker, and profile-hover marker
7. Waypoint circles and labels

## Detailed behaviour

### Startup
1. Parse URL hash for `lng`, `lat`, `zoom`, `basemap`, `mode`, `opacity`, `terrain`, `exaggeration`, `bearing`, `pitch`. Missing keys fall back to Mont Blanc area at zoom 12, slope mode, 0.45 opacity.
2. Load persisted settings from localStorage (URL hash takes priority over persisted values).
3. Build the MapLibre map with all sources (OSM, OTM, IGN, SwissTopo vector, Kartverket, OpenSkiMap, DEM raster-dem, contour vector tiles).
3. Style layers are defined inline: basemap raster/vector, OpenSkiMap fill/line/symbol, hillshade, and contours.
4. On `map.on('load')`: apply basemap selection, terrain state, debug grid, global-state properties, add the `terrain-analysis` layers for slope/aspect and color-relief, contour layers, and wire up elevation sampling.
5. Call `updateCursorInfoVisibility()` to set initial cursor-info display mode.

### DEM analysis rendering
- Two built-in `terrain-analysis` layers (`analysis` for slope/aspect, `analysis-relief` for elevation) from `@eslopemap/maplibre-gl` replace the old custom WebGL shader. The layer type natively supports `['slope']`, `['aspect']`, and `['elevation']` attribute expressions, step/interpolate color ramps, and blend modes.
- `applyModeState()` switches attributes, colors, visibility, opacity, and blend mode via `setPaintProperty()`.

### Cursor elevation & slope
- **At cursor** (default): a small `#cursor-tooltip` div positioned at `clientX+15, clientY+15` shows elevation and slope. Updated every frame via `requestAnimationFrame`. On profile hover, it repositions to the hovered vertex's screen coordinates.
- **Corner**: the `#cursor-info` element inside the legend panel shows the values (original behaviour).
- **No**: both hidden.
- On mobile: a permanent center crosshair (`#draw-crosshair`) always shows elevation & slope in the `#cursor-info` corner display, updated on `map.move`. A `#mobile-crosshair` also appears at tap points with the tooltip. Cursor info defaults to `corner` mode on mobile.

### Settings panel
Contains dropdowns and sliders for: Mode, Basemap, Basemap opacity, Hillshade opacity, Hillshade method, Analysis opacity, Show contour lines, OpenSkiMap overlay, Show DEM tile grid, **Elevation & slope** (cursor/corner/no), Multiply blend, Enable 3D terrain + exaggeration. The debug color-relief layer is suppressed while 3D terrain is active.

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

### Workspace tree
- `js/gpx-model.js` defines node types: `folder`, `file`, `track`, `segment`, `route`, `waypoint`. Each node has a stable auto-generated ID (`uid(prefix)`), type-specific metadata fields, and optional `children[]`.
- `gpx-tree.js` builds the workspace tree on import via `onFileBatchImported()` which creates one file node per imported file containing its tracks and segments. On restore from persistence, orphan tracks are rebuilt via `buildWorkspaceFromTracks()`.
- The tree is rendered directly in the `#track-list` element and is now the only panel renderer. Tree rows show disclosure toggles, type icons, node names, and inline stats.
- `treeState` holds UI state: `expandedNodeIds` (Set), `selectedNodeId`, `contextMenu`, `infoEditor`.
- `saveWorkspace()` / `loadWorkspace()` persist the workspace tree structure and metadata to localStorage under `slope:workspace`. On restore, the saved workspace structure is authoritative, with orphan tracks and waypoints appended as a fallback.
- `saveTracks()` / `loadTracks()` now preserve stable track IDs, and waypoints are persisted independently so file placement and waypoint nodes survive reloads exactly.

### Context menu
- Triggered by right-click, long-press (600ms on mobile), or clicking the kebab (⋮) button on any tree row.
- Menu items depend on node type:
  - All except segment: **ℹ Info…** (opens Info editor), **🗑 Delete** (with confirmation dialog)
  - Track / segment / route: **✎ Edit**, **📈 Profile**, **🔎 Zoom to**
  - File: **＋ New file**, **＋ New track**, **⧉ Duplicate**, **Copy**, **Cut**, **Paste**, **🔎 Zoom to all**
  - Track: **＋ New segment**
  - Track / segment / waypoint: **⧉ Duplicate**, **Copy**, **Cut**
  - File / folder: **Paste**, **🔎 Zoom to all**
- The track panel header also has a workspace kebab menu for root-level **New file** and **Paste**.
- Closes on outside click.

### Info editor
- Modal overlay (`#info-editor-overlay`) shown over the map.
- Editable fields per node type: folder (name), file (name, desc), track (name, desc, cmt, type), route (name, desc, cmt, type), waypoint (name, desc, cmt, sym, type).
- Name changes sync back to the track data model via `renameTrack` / `renameGroup`.
- Waypoint metadata changes also sync back into the waypoint store used for export and persistence.
- Metadata changes are persisted through the workspace save flow.
- Esc or Cancel closes without saving; Enter (in single-line fields) or Save commits. Focus is placed on the first input on open.

### Left edit rail
- Vertically centered floating column (`#edit-rail`) on the left side of the map with buttons: New (+), Edit (✎), Undo (↩), Rect select (⬚), Mobile (📱).
- Each rail button delegates to the corresponding existing toolbar button.
- Edit button enables when a track is active, highlights (active class) when editing is in progress, and directly toggles edit mode for the active track.
- Undo and Mobile buttons visibility matches the existing toolbar button state.
- Rail state syncs every 500ms via `setInterval`.

### Keyboard shortcuts
- All shortcuts registered via `js/shortcuts.js` with focus guards: shortcuts do not fire inside `<input>`, `<textarea>`, `<select>`, or `contenteditable` elements.
- `Ctrl/Cmd+P` — toggle elevation profile panel.
- `Ctrl/Cmd+L` — toggle track list panel.
- `N` — create new track (delegates to draw button).
- `E` — edit active track (delegates to edit rail button).
- `Ctrl/Cmd+I` — open Info editor for the active track (finds the tree node matching `activeTrackId`).
- `Esc` — exit edit mode.
- Future stubs reserved: `R` (rectangle select), `Ctrl/Cmd+Shift+S` (save), selection clipboard shortcuts.

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
