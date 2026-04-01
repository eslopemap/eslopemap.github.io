## Choose a terrain mode

The `Mode` menu controls which terrain layer is drawn above the basemap.

- `Slope + Color relief` (defualt)  shows both steepness (at high zoom) and a color-relief at lower zoom.
- `Slope` isolates steep terrain.
- `Aspect` colors terrain by direction.
- `Color relief` emphasizes elevation bands.
- The empty option turns terrain analysis off.

## Work with basemaps and overlays

The `Basemap` menu switches the reference map underneath the analysis layer. Some overlays are specific to a region, so Slope recenters automatically when needed.

Use the checkboxes for:

- contour lines,
- OpenSkiMap,
- SwissTopo ski layers,
- IGN ski and slope layers,
- 3D terrain.

## Use advanced controls when needed

Open `Advanced` when you need finer control over the rendering:

- lower `Basemap opacity` to emphasize the terrain layer,
- raise or lower `Analysis opacity` depending on the basemap,
- change the hillshade method,
- pick where cursor elevation and slope are displayed,
- adjust `Terrain exaggeration` in 3D mode.

## Read the map while moving

The legend updates automatically for the active analysis mode. Cursor elevation and slope can be shown near the pointer, in the corner, or hidden entirely.

On mobile, a center crosshair keeps the terrain readout stable while you pan.

If the cursor readout feels distracting during editing, you can move it to the corner or turn it off completely in the Advanced settings.

## When to use each view

| Goal | Recommended setup |
| --- | --- |
| Evaluate avalanche or steepness context | `Slope` or `Slope + Color relief` with contours enabled |
| Compare elevation bands over a route | `Color relief` with medium basemap opacity |
| Inspect direction of terrain faces | `Aspect` |
| Focus only on imported tracks | Basemap opacity reduced, analysis opacity increased |

## Quick troubleshooting

- If the map looks too busy or labels are hard to read, reduce either `Analysis opacity` or the number of active overlays.
- If 3D terrain makes the route hard to follow, lower `Terrain exaggeration` or switch back to 2D before editing geometry.
