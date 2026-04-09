
context: start of FEATURES.md

- the hillshade checkbox and transparncy setting is redundant now it is shown in the 

- the basemap dropdown does not make sense now that we have the 'Add layer' dropdown.
remove it and all the persistence logic around it. we have multiple basemap support now so it should be arrays everywhere (except for the special case of only one composite style.json layer at a time).

- currently displayed custom layers are not well persisted, neither the state of hillshade / contour / analysis. 
  we should attempt to unify hillshade / contour / analysis with the layer order system, to have one single consistent 'map layer state' that can be used for [1] maplibre-sync [2] persistency and [3] bookmark save/restore.
  I am almost leaning towards 'maplibre's `map.style` being that source of truth, but it's tricky for composite layers (eg openskimap being ~4 layers) and the extra stuff like the tracks overlays. but dig into it, if we can adress this and have everything based of the map's own state, that will probably reduce sync issues >? suggets several alternatives.

- restoring a bookmark (by clicking on it) seems glitch-y. add a test for this with multiple layers bookmarked & restored

- the cursor info indicator should try any dem source to fetch information, right now if no hillshade, it fails, but it could use terrain-analysis / contour / terrain ...

- dropping a folder should attempt to add the *folder* on server side directly, not every single file, this will make the config more manageable for the user. (may already be fixed)

- the bookmark edit name is broken


- let me change size of the 'Server tile cache' from the UI

- let me delete custom sources (all, from the 'seved data' panel ; and individually, somewhere it makes sense UX-wise) from the ui.

- there are cargo build warnings, can we add a check for them ? eg put warning as error somewehere it's not too invasive during development, but where we won't miss it ?

- make sure all 4 test suites pass.

- assess carefully impact of features on persistence, cacheing, bookmark-ing, and the multi-stack (web+tauri).
- git commit for each task

---> analyze carefully and make a plan in ./plan/<ymd>-... . include visual details where UX changes.


---

we are on
@20260409-UNIFY-PERSIST-BOOKMARK-PLAN.md 
at
@20260409-unify-persist-bookmark-report.md 

review the code changes, be critical
- there are some inconsistencies, eg I expect 'system layers' (Hillshade / Contour / Analysis) to be always shown in the 'Layer order', just with visibility toggled or not. the old checkboxes can be removed
- rename 'Mode' to 'Terrain analysis mode' for consistency. sync the Mode visibility state with the dropdown empty value, both ways.
- the test is too verbose
- then proceed with the testing and finish the task.