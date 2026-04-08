context: start of FEATURES.md

- in web mode, the active basemap, viewport, and more are imported from url so they're not all persisted to local storage.
but in desktop mode (tauri) no url exists.
make a review of what is missing, and persist it, still allowing for URL overrides.
in the report outline the current list of things that can be (a) persisted (b) overriden though url (c) only set transiently in the UI.

- bug: if I drop I get `Tile file drag-and-drop requires desktop mode:"x.mbtiles"` when using `cargo tauri dev`. definitely attempt to e2e test this one in the tauri webdriver e2e.

- bug: if I drop a folder in `cargo tauri dev` I get `[tile-drop] registering x.mbtiles from /mbtiles/x.mbtiles` then `[tile-drop] failed to register tile file:"File not found: /somefolder/x.mbtiles"` where somefolder is the folder I dropped, but **not its full path**.

- while you do this pay attention to any debt / oportunities for simplification / missing tests.

finish with a new ./report/<ymd>-... ; commit for each task

