## Import files

Slope accepts GPX and GeoJSON data through:

- `Open file`,
- drag and drop,
- directory import when the browser supports it,
- GPX import from URL.

GPX files can include tracks, routes, segments, waypoints, and timestamps. Multi-segment tracks stay grouped in the workspace tree.

## Understand the workspace tree

Imported content appears in a hierarchy:

- folder,
- file,
- track or route,
- segment,
- waypoint.

Each row exposes actions that make sense for that level. File rows focus on import and export. Track and route rows expose editing and geometry actions.

## Export options

Use the footer buttons in the workspace panel for common exports:

- export the active track as GPX,
- export the active track as GeoJSON,
- export all tracks as GPX.

Context menus also expose GPX export for a file, track, or route. On supported browsers, `Save to folder...` writes one GPX file per track.

## What is preserved

During import and export, Slope keeps as much structure as possible:

- grouped GPX segments remain grouped,
- waypoints stay attached to the workspace,
- timestamps remain available for profile time views,
- routes can remain routes until you explicitly convert them.

## Recommended import workflow

1. Import a single GPX file.
2. Confirm the correct track is active in the workspace tree.
3. Open the profile to inspect elevation and timing.
4. Enter edit mode only after selecting the exact track or segment you want to modify.
