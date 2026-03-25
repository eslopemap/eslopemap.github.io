# new tweaks:

* new option 'show elevation & slope' with values 'at cursor / corner / no'. existing behaviour maps to 'corner' but new default should be 'at cursor' which shows <div id="cursor-info"> slightly below-right cursor and not in the corner.
this cursor-panel should also show beside any selected point when mousing / mobile-touching over the profile-panel 
* on mobile, when I tap the screen, a cross should appear (with the elevation & slope panel if configured). it should disappear when panning
* ask confirmation before deleting track

* it seems the track export gpx syntax is a bit minimalist, garmin cannot import it, check for the basic gpx fields. let me edit the name. add the already computed statistics to the description.

# new track edition features:


* on desktop, it should be possible to edit the past points by dragging them before the track is done

* it should be possible to select a track without editing it. selecting it just makes line wider and profile appears (like now) but no extra markers are shown. 'edit' is how beside delete-track for the editing behaviour to trigger.

* on both desktop on mobile, during drawing or track selected a small bin appears on top right, left of track panel, to delete last point

* on desktop, hide the grey middle markers used to add points in existing track. instead, when cursor is cloe enough to track, a single grey marker should appear at closest point. clicking and dragging should create a new marker between the corresponding 2 points of the track. make sure the implementation is reasonably efficient.

* on mobile, I would like a better edition mechanism:
  - when I click new track, a cross appears in middle with a toast 'tap anywhere to add a point in the center'
  - screen keeps showing what will happen when I tap ie which point and line will be added
  -  right now I have to touch the 'middle markers' before I can move them, make them draggable right away
  - in edition mode (only) clicking an existing marker to edit it will display a toast 'drag screen to move', and when dragging the point will be moved in a way that it remains on same display coordinates.

Fill in the blanks in this feature for a coherent experience (eg validating an edit, ...)

try to make this implementation modularized and maintainable.

-> implementation:

> Track select vs edit — Clicking a track name selects it (wider line, profile shown, only start/end markers). A new ✎ edit button in each track row toggles edit mode, which reveals all mid-vertex markers and enables vertex dragging and hover-insert.
> Smart hover-insert (desktop) — Replaced the old static midpoint insert markers. When the cursor is near the track line (within 20px, but not near vertex endpoints), a single grey marker appears at the closest point. Clicking and dragging it inserts a new vertex and starts dragging immediately.
> Drag during draw — Desktop users can drag existing vertices while still in draw mode (before the track is finished).



# finally

* update slope.md keep the existing sections concise as they are and also add '## Detailed behaviour' with enough spec-like information to recreate the app, without being verbose.
* new workspace memories: remember to always update slope.md

after you're done, give me a commentary on the state of this project, and how to enable enable easier maintenance for more map features (more gpx features, session storage, ...). suggest adequate strategy incl relevant libraries/fwks (still without any build step). write it straight to new file FUTURE.md