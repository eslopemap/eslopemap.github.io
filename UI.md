# UI Layout

This ASCII sketch reflects the current **edit mode** layout as seen in `app/user-guide/assets/edit-mode.png`, cross-checked with `app/index.html`, `app/css/main.css`, and the MapLibre `addControl(...)` setup in `app/js/main.js`.



## ASCII Layout

Based on [app/index.html](cci:7://file:///Users/eoubrayrie/code/MAPS/slopedothtml/app/index.html:0:0-0:0), [app/css/main.css](cci:7://file:///Users/eoubrayrie/code/MAPS/slopedothtml/app/css/main.css:0:0-0:0), and the MapLibre `addControl(...)` calls in [app/js/main.js](cci:7://file:///Users/eoubrayrie/code/MAPS/slopedothtml/app/js/main.js:0:0-0:0), here is the current on-screen placement.

```text
+--------------------------------------------------------------------------------------------------+
| [Settings toggle] [Search]                               [Track tools (7 icons)] [Tracks toggle] |
|                    [Search dropdown]                                                             |
| +----------------+                                                    +--------------------+     |
| | Settings panel |                                                    |    Tracks panel    |     |
| |                |                                                    |                    |     |
| |                |                                                    |                    |     |
| |                |                                                    |                    |     |
| |                |                        [Draw crosshair]            |                    |     |
| |                |                        [Cursor tooltip]            |                    |     |
| +----------------+                                                    +--------------------+     |
|                                                                                                  |
| [Edit rail]                              [Mobile crosshair]                                      |
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

Conditional overlays / floating popups:
- `B` can expand downward with search results under the search button/input.
```

## Legend

- **Settings panel** (`#controls`)
  - Mode, basemap, overlays, 3D terrain, advanced display/profile settings.
  - Contains the settings toggle plus the currently open settings content:
    - mode
    - basemap
    - contour toggle
    - overlay toggles
    - 3D terrain toggle
    - advanced section toggle

- **Search** widget (`#search-box`)
  - Search button, expanding input, and results dropdown for place search.

- **Edit rail** (`#edit-rail`) -- unclear future use
  - Quick edit actions: edit active track.

- **Top-right track toolbar row** (`#track-tool-row`)
  - New track, import/open/export, profile toggle, workspace actions, selection/edit ops, track list.

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

- **Settings toggle** (`#settings-controls-toggle`)
  - Opens/collapses the left settings panel.

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
  - Top-left: settings and search
  - Top-right: track workspace panel
  - Mid-left: edit rail
  - Bottom-left: legend
  - Bottom-right: MapLibre controls
  - Bottom full width: profile panel
