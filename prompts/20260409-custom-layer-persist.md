read git log -10 for context

let's work on improving the custom layer and local layer situation. research and turn thos ramblings into a strong plan:

double-check whether calling scanAndRegisterDesktopTileFolder(folderPath) will actually get it remembered in the backend settings. I didn't see config::save_config(&cfg)?;
I'm unclear how settings persistence should work in general (things like custom sources, tile cache size)
I see 2 paths:
A server-side persistence - but then UI has to retrieve it to display state (currently missing get_cache_max_size counterpart to set_cache. anyweay I want a generic path eg get_config_key/set_config_key instead of set_cache_max_size
B browser-side persistence together with the web stuff - but then the server starts fresh and the UI has to send it the settings to load sources etc, not efficient ?

consider that custom layers should be available client-side too, we were supposed to register any tileJSON server in the web mode. basically there should be a web UI for custom tiles input 
- if I drag a tilejson, it should get into those custom tiles
- if I drag a local mbtiles/pmtile/folder, only then should the extended desktop mode be triggerred : ie the local source needs addded to the server, to be served AND registered on the UI. but in that case we should avoid duplication of state that then needs sync, that's where the UI auto-discovery of backend layers should kick-in.

make a more in-depth comparison, recommend an aproach both for settings and layers, and implement it. make sure to have the full read/write server<>ui flow is working where relevant (at least custom sources, cache size)


---

look at git diff for context.
finish the job with strong tests (mix of unit, e2e,  tauri-e2e as adequate) and commit.
finish with a full coverage run accros the 4 test suites and report on important missing coverage

---

continue. avoid 'covereage-only' tests, try to keep them useful 
do you best to investigate unrelated test failures. if they are random, stabilize them. 

---

include Suite 4: Tauri WebDriver E2E — not run (requires cargo build --features webdriver + running binary; desktop-only)
and consolidate the report. remember to ALWAYS run that one.

if you still find important coverage missing after that, add it.

I also want specific screenshot tests:
- @01-dem-tile-404.png  should be producted by the test, versioned and check against, as it represents the expected state of the UI with nothing loaded (it's a bit out-of date right now for some reason)
-  @02-custom-mbtiles-active.png  should be versioned as well but crop the screenshot (there's already a tool somewhere) so we check only map content ; and make sure to display only the dummy source (the others require internet connection)
- I want a pmtiles screenshot as well in the same test

---

"The error is a fetch failure from the pmtiles protocol. This is expected — the PMTiles rendering works but generates a network error that gets captured." mmm why does it generate a network error ? the dummy pmtiles has z1-3 so set the map zoom before the test and you should not have network errors ? only filter it if it's really expected otherwise investigate.
continue.
if you still find important coverage missing after that, add it.

---

continue
finsh with a commit and a ./report/ymd-...
be aware that some default layers are requiring internet connection
-  without test_mode there osm
- with test_mode, it is not clear whether test_mode strategy is effective
>  state.showHillshade = false;
>  state.showContours = false;
it would probably be better to hook into the normal setup than trying to override it partially afterwards.
once a hillshade / contour / 3d / terrainAnalysis is enabled, dem tiles will be requested. it is not clear whether tests/tauri-e2e/tests/dem-tile-serving.spec.mjs properly mocks the DEM data. An example of how to do it on web side is tests/e2e/dem-loading.spec.js -- but in tauri it would be better to use the dem tile cache content as the mock, to exercise it.

---

"I’ve switched the DEM assertion to the real normal-mode path with basemap=none"
this will still trigger dem tile load and display of  hillshade, terrain-analysis, contour. is that what you expected ?
also, I think you may have been tripped by the aggressive default. without test_mode (which seems not used everywhere?), a ton of layer will be present eg OSM, terrain analysis, ...

in practice:
* tests/tauri-e2e/screenshots/01-dem-tile-404.png as it is now seems OK to me, it is pure-white
* tests/tauri-e2e/screenshots/01-dem-tile-cache-working.png seem **broken**, it shows OSM basemap layer which requires internet, definitely means basemap was not correctly disabled.
* the custom-layer ones are working OK

continue, write a ./report/ymd-... and important strategic notes in tests/README.md, commit
then if you still find important coverage missing after that, add it.

---

context: /Users/eoubrayrie/code/MAPS/slopedothtml/reports/20260409-DEM-TAURI-FLAKINESS-REPORT.md

- use playwright's page.route so that non-local URLs return 404, this way the test always operated in offline-like mode even if we mess up. set that up as a common helper, use a whitelist if needed.

- delete all references to state.basemap, STATE_DEFAULTS.basemap, and initialView.basemap, etc. they have been superseded by basemapStack. the only thing that remains is the URL hash basemap, which feeds basemapStack directly with split(',').

- remove applyTestModeState and syncTestModeUi, those are very brittle. instead, define a STATE_TEST_MODE and use that instead of STATE_DEFAULT when test_mode=true.

- note that there is no actual onChange registered for our store, shouldn't we add one ?

- update "Tauri WebDriver E2E Tests (wdio)" tests/README.md section with the updated list of tests

- build a ./plan/ymd-... for a future unification of setBasemapStack and setOverlay ; and  state.basemapStack and state.activeOverlays (unless you have a *very* good rationale not to do it

commit after each task, complement 20260409-DEM-TAURI-FLAKINESS-REPORT.md as you go

