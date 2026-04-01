## What Slope is for

Slope combines terrain visualization with a browser-based GPX editor. You can inspect steepness, switch basemaps, import existing tracks, draw new lines directly on the map, and inspect an elevation profile without leaving the page.

![Overview map with terrain analysis and controls visible.](./assets/overview-map.png)

*The default map view combines terrain analysis, controls, and the floating workspace UI.*

## Quick start

1. Open the main app from the docs sidebar or go directly to `index.html`.
2. Pick an analysis mode from the `Settings` panel.
3. Import a GPX or GeoJSON file with `Open file`, or create a new line with `+`.
4. Use the track panel to select the active item.
5. Open the profile panel with `Profile` to inspect elevation and slope.

## The main areas of the interface

| Area | What it does |
| --- | --- |
| Settings panel | Terrain mode, basemap, contour, 3D terrain, and advanced display options. |
| Left edit rail | Fast access to edit mode and selection tools for the active track. |
| Workspace panel | Lists imported files, tracks, segments, and routes with actions. |
| Profile panel | Shows elevation, slope, pauses, and time-based views for the active track. |
| Map canvas | The main surface for navigation, drawing, moving vertices, and reading terrain. |

## Recommended first workflow

Start by importing one GPX file so the app can auto-select a track and open the profile. After that, switch between `Slope + Color relief` and `Slope` to understand how the route lines up with the terrain, then enter edit mode if you need to clean up vertices.

> The guide is split by task. If you already know the basics, jump straight to the Track editing or Elevation profile sections from the sidebar.
