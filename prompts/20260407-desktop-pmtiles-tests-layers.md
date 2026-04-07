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