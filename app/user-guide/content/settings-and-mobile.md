## Settings that matter most

If you only change a few controls regularly, start with these:

- `Mode`
- `Basemap`
- `Contour lines`
- `3D terrain`
- `Analysis opacity`
- `Pause threshold`
- `Profile smoothing`

These settings cover most viewing and profile workflows without needing to touch the deeper rendering options.

![Settings panel open with the main terrain and profile controls visible.](./assets/settings-panel.png)

For a stable default setup, keep a terrain mode enabled, leave basemap opacity high and analysis opacity near the middle.

You can also clear data (at the bottom) to start fresh.

## Mobile editing behavior

On mobile, Slope Mapper uses a center crosshair to make editing practical on a small screen.

Typical mobile workflow:

1. Select a track.
2. Enter edit mode.
3. Pan the map so the crosshair sits where the point should move.
4. Tap to insert a point or select an existing point first, then pan to reposition it.

A desktop-style touch mode is also available, but the crosshair workflow is usually more precise.

On a small screen, it often helps to collapse the track and profile panels (top-right buttons) you are not actively using before moving points.

## Persistence

Slope Mapper saves tracks and most interface settings to local storage. When you reopen the page in the same browser, your workspace and display preferences are restored automatically.

If you need a clean slate, use `Clear saved data` in the advanced settings panel.

This is especially useful before testing a new import workflow or before capturing repeatable documentation screenshots.

## Useful adjustments for different tasks

| Situation | Suggested setting change |
| --- | --- |
| Terrain layer is too dominant | Lower `Analysis opacity` |
| Basemap labels are hard to read | Raise `Basemap opacity` or reduce hillshade |
| Profile pause markers are too sensitive | Increase `Pause threshold` |
| 3D terrain looks exaggerated | Lower `Terrain exaggeration` |
| Cursor readout gets in the way | Switch `Elevation & slope` to `Corner` or `No` |

## Mobile-specific tips

- Keep one active track at a time while editing on touch devices.
- Use the crosshair workflow for precise moves and inserts.
- Reopen the profile only when needed if vertical space is limited.
- If the interface feels crowded, start by hiding panels instead of disabling useful data layers.
