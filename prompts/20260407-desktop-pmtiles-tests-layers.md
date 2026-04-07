- tests:
  * you worked around an error in the console in web mode related to the pmtiles vendor-ing
    `Uncaught TypeError: The specifier “fflate” was a bare specifier, but was not remapped to anything. Relative module specifiers must start with “./”, “../” or “/”.`
    coming from vendor/.../index.js - could it be because fflate is not vendored ?
    investigate, don't do things blindly, try hard to check the logs !
  * add real tests that cover mbtiles and pmtiles, and the user catalog
    use tests/fixtures/tiles/dummy-z1-z3.mbtiles for the mbt test
    and convert it to pmtiles (eg by command-line, with official tool) to use that for the pmtiles test.
    include expected.png screenshots but make a special utility to crop screenshot to center to avoid having those tests impacted by non-map ui-chrome/decorations user changes
  * concisely list the functionality of the current desktop & web tests in new `tests/README.md`. link it in README and AGENTS give advice on how to setup a test coverage for both front and back

- progress on the @20260406-PLAN-UNIFIED-BASEMAP-UI.md:
  * note that sources are not fundamentally basemap or overlay, but they can have a 'preferred' state -- eg basemaps will be below and use full opacity by default while overlay would be above and use a blend (typically multiply at least for raster overlays). So I think the UI should not force the distinction too much, edit @20260406-PLAN-UNIFIED-BASEMAP-UI.md with various proposals with different UX ideas around this topic.
  * note: only one of the maps can use the full map.setStyle(.../style.json) (like SwissTopo Vector) at a given time. but it could be a basemap or layer, it depends where we put it in the stack. UI should reflect this, by at least warning that previous one will be removed.

- drag and drop does not seem to work on desktop ?

- as usual frequent commits and ./report

---

look at @20260406-DESKTOP-MODE-REPORT.md 
keep working on those items especially tauri e2e tests (the app is not functioning well so fix issues as discovered by the tests) ; and ensuring good coverage overall. report on current coverage. refine, update  and implementcoverage archi from @README.md 
setup the github-action lightweight CI checks (web/desktop/e2e tests) + CD delivery (tauri packaging. investigate how to package the app as single executables/installers using github releases). keep GHA adherence at a minimum (ie try to keep logic outside of it)
remain critical of what has been planned and done, fix issues you find on the way to provide a strong balance of maintainable and KISS. 
as usual frequent commits and ./report

---

-  Add Tauri integration tests
- I don't think you added coverage for the e2e and backend tests ?
I don't want high unit-test coverage with useless micro-tests, (actrually, remove thos that don't add value) but I want *overall* the code to be covered so it's important to get those.
-  Push and verify CI pipeline runs on GitHub
-  Test release workflow with a v0.1.0 tag
- Continue with unified basemap UI (phases 2-4)

---

- cargo tauri dev is stuck on this, am I doing it wrong :   
       Warn Waiting for your frontend dev server to start on http://localhost:8089/app/ 
- update main README and CONTRIBUTING with all the tauri stuff, make clear in the structure and content what is for web / desktop / both. how should I dev/start etc.
- reagarding plans/20260406-PLAN-UNIFIED-BASEMAP-UI.md , keep working on phase 3. regarding phase 4, move the part of 'Basemap' which shows added basemaps into the 'Layers' panel (' (which currently is missing baselayers):
Also unify the Add basemaps and the Overlays dropdown within a single structured dropdown
the overall idea is that a first map choice should remain separate from the exact layer order (in Layers). in Layers add a visibility toggle
I think Layers panel should be shown beside Settings panel when layers are being added. figure out a proper UX for this.
- update FEATURES with what has been done (stay concise)

---

address those follow-ups:
- the visibility toggle are a bit buggy and not sync'ed when changing other settings, reloading page. it's also not clear if layer visibility and opacity are stored in the persistemce layer and the bookmark layer ? make sure code & state is well shared between those features.
- dragging the opacity sliders does not work
- move the '3d terrain' setting into its own standalone button with a clear svg depicting a 3D cube, positioned just above maplibre's geolocation control
- when toggling 3d terrain off, un-tilt the map.
- most of what is in Settings should go in Layers, below the layer list, because those are layer-related. go through the list and do it. also swap 'Settings' and 'Layers' buttons and positions 
- the track panel can get very wide with long  names of file/track/segment, figure out the proper  way (css...) to get something like an ellipsis in the middle of the name and a popup with full name
- fix tests including pre-existing failures. check carefully whether issue is with the test or the app !