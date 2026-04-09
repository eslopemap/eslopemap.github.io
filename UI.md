# UI Layout

This ASCII sketch reflects the current **edit mode** layout as seen in `app/user-guide/assets/edit-mode.png`, cross-checked with `app/index.html`, `app/css/main.css`, and the MapLibre `addControl(...)` setup in `app/js/main.js`.



## ASCII Layout

Based on [app/index.html](cci:7://file:///Users/eoubrayrie/code/MAPS/slopedothtml/app/index.html:0:0-0:0), [app/css/main.css](cci:7://file:///Users/eoubrayrie/code/MAPS/slopedothtml/app/css/main.css:0:0-0:0), and the MapLibre `addControl(...)` calls in [app/js/main.js](cci:7://file:///Users/eoubrayrie/code/MAPS/slopedothtml/app/js/main.js:0:0-0:0), here is the current on-screen placement.

```text
+--------------------------------------------------------------------------------------------------+
| [Layers] [Settings] [Profile] [Tracks] [Help] [🔍]    [✎] [⬚]    [+ 🔗 📄 📁 ⋮ ▣ …]              |
|  #bar-left (panel toggles + help + search)           #bar-center   #bar-right (track-tool-row)   |
| +---------------+----------------+                                           +--------------------+
| | Layers panel  | Settings panel |                                           |    Tracks panel    |
| |               |                |                                           |                    |
| |               |                |                                           |                    |
| |               |                |               [Draw crosshair]            |                    |
| |               |                |               [Cursor tooltip]            |                    |
| +---------------+----------------+                                           +--------------------+
|                                                                                                  |
|                                          [Mobile crosshair]                                      |
|                                                                                                  |
|                                                                                      [Geolocate] |
|                                                                                             [+]  |
|                                                                                             [-]  |
| +-------------------+                                                                 [Compass]  |
| |      Legend       |                         [Toast]                             [Attribution]  |
| +-------------------+                                                                   [Scale]  |
+--------------------------------------------------------------------------------------------------+
|                                         [Profile panel]                                          |
+--------------------------------------------------------------------------------------------------+

Mobile (≤640px): #controls-wrapper moves to bottom, labels hidden, search/help hidden.
Panels (#layer-order-panel, #controls, #track-panel-shell) stay at top-left/top-right respectively.
```

## Legend

- **Panel toggles** (`#panel-toggles`) — inside `#bar-left`
  - Four unified toggle buttons: Layers, Settings, Profile, Tracks.
  - Active state uses `#4a90d9` blue highlight.

- **Layers panel** (`#layer-order-panel`) — positioned below `#bar-left`, left of Settings panel
  - Add layer dropdown for basemaps and overlays.
  - Layer order list with drag-and-drop reordering.
  - Layer settings (basemap opacity, terrain analysis mode, overlay opacity).
  - Bookmarks for saving/loading layer configurations.

- **Settings panel** (`#controls`) — positioned below `#bar-left`, right of Layers panel
  - Elevation & slope display mode, pause threshold, profile smoothing.
  - DEM tile grid toggle, saved data management, mobile mode toggle.

- **Search** widget (`#search-box`) — inside `#bar-left`
  - Search button, expanding input, and results dropdown for place search.

- **Edit buttons** (`#bar-center`)
  - Edit active track (✎) and rectangle select (⬚) buttons.

- **Track toolbar row** (`#track-tool-row`) — inside `#bar-right`
  - New track, import/open/export, workspace actions, selection/edit ops.

- **Legend** (`#legend`)
  - Slope color ramp, labels, cursor elevation/slope readout.

- **Cursor tooltip** (`#cursor-tooltip`)
  - Small floating tooltip that follows the mouse.

- **Draw crosshair** (`#draw-crosshair`)
  - Center crosshair used in mobile/draw/edit modes.

- **Mobile crosshair** - Mobile crosshair (`#mobile-crosshair`)
  - Appears at tap position on mobile.

- **Profile menu** (`#profile-menu-dropdown`)
  - Dropdown menu for X axis and metric selection..

- **[Toast]** - (`#toast`)
  - Temporary centered notification near the bottom - also `#mobile-move-hint` as a special toast case.

- **MapLibre controls** : [Geolocate], Zoom [+]/[-], [Compass], [Attribution], [Scale]
  - Added at `bottom-right`, stacked with the other controls.

## Toggled panels

- **Layers toggle** (`#layer-order-toggle`) — in `#panel-toggles`
  - Opens/collapses the Layers panel. Active by default. Active class highlights blue.

- **Settings toggle** (`#settings-controls-toggle`) — in `#panel-toggles`
  - Opens/collapses the Settings panel. Active class highlights blue.

- **Profile toggle** (`#profile-toggle-btn`) — in `#panel-toggles`
  - Shows/hides the bottom profile panel.

- **Tracks toggle** (`#tracks-btn`) — in `#panel-toggles`
  - Opens/collapses the right track panel.

- **Track panel** (`#track-panel`)
  - Track list plus export/save actions; shown under the top-right toolbar when opened.

- **Profile panel** (`#profile-panel`)
  - Full-width elevation/profile panel anchored to the bottom.
  - Includes profile chart and profile header controls.


### Not represented

- Map canvas (`#map`)
  - Everything not labeled above is the main MapLibre map canvas.

- Drop overlay (`#drop-overlay`)
  - Full-screen drag-and-drop target overlay for GPX / GeoJSON import.
  - Covers the whole viewport when dragging files over the app.


## Placement summary
  - Top bar (`#controls-wrapper`): full-width flex bar with 3 zones
    - Left (`#bar-left`): panel toggles (Layers | Settings | Profile | Tracks), Help link, search
    - Center (`#bar-center`): edit/rect-select buttons
    - Right (`#bar-right`): track tool row (new, import, actions, ops)
  - Below top-left: Layers panel (`#layer-order-panel`) and Settings panel (`#controls`)
  - Below top-right: track panel (`#track-panel-shell`)
  - Bottom-left: legend
  - Bottom-right: MapLibre controls
  - Bottom full width: profile panel
  - Mobile (≤640px): top bar moves to bottom, labels hidden, panels stay at top
