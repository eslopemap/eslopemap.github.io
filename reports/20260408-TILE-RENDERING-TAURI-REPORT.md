# Tile Rendering and Tauri E2E Report

## Scope

This pass focused on the desktop tile-rendering investigation and on replacing misleading web-style coverage with Tauri-desktop coverage that exercises the real registration and TileJSON discovery flow.

## Implemented Changes

### 1. Added a dedicated Tauri custom MBTiles test

Added:
- `tests/tauri-e2e/tests/custom-tile-serving.spec.mjs`

This test:
- registers a fixture MBTiles source via Tauri IPC,
- verifies the source appears in the Tauri registry,
- fetches `/tilejson` and `/tilejson/{source}` from the desktop tile server,
- verifies direct tile fetching via `/tiles/{source}/{z}/{x}/{y}.png`,
- waits for the frontend to discover the source and expose it in the add-layer UI,
- activates the custom source through the actual UI,
- captures a screenshot (`02-custom-mbtiles-active.png`),
- probes the map canvas and fails if the rendered center region remains effectively white.

This gives desktop coverage that follows the real app path instead of mutating MapLibre directly.

### 2. Corrected TileJSON identity drift

A real feature bug was found in the desktop flow:
- the backend registry identity came from the registered tile source name,
- the frontend catalog identity came from `TileJSON.name`,
- MBTiles metadata could therefore silently rename a source for the frontend.

This made the feature fragile and made tests look flaky.

The fix was:
- add a stable `id` field to generated TileJSON descriptors,
- keep `name` as the human-readable label,
- make frontend catalog/source identifiers prefer `TileJSON.id` instead of `TileJSON.name`.

Changed files:
- `src-tauri/src/tile_server.rs`
- `app/js/tauri-bridge.js`

### 3. Fixed broken `/tilejson/{source}` handling

While tracing the desktop flow, the single-source TileJSON endpoint in `src-tauri/src/tile_server.rs` was found to be broken and duplicated.

The handler now:
- returns a proper JSON TileJSON document for cached upstream sources,
- returns a proper JSON TileJSON document for MBTiles/PMTiles sources,
- returns 404 for unknown sources,
- no longer contains the duplicated handler block.

This is important because the desktop discovery path depends on TileJSON being authoritative.

### 4. Updated folder/tile drag-drop Tauri tests

Updated:
- `tests/tauri-e2e/tests/folder-tile-operations.spec.mjs`

Changes include:
- removing the invalid assumption that desktop source discovery is an IPC call,
- verifying discovery through HTTP `/tilejson`,
- aligning assertions with stable TileJSON `id` plus metadata-derived label,
- replacing a brittle module-import pattern inside WebDriver,
- fixing broken captured-error assertions.

## Investigation Findings

### Existing web Playwright coverage is not authoritative for desktop

`tests/e2e/tile-serving.spec.js` is useful for a browser-side tile-server experiment, but it is not a trustworthy Tauri-desktop end-to-end test because it bypasses:
- Tauri IPC registration,
- desktop TileJSON discovery,
- the real add-layer UI activation path.

### CORS was not the main problem

The desktop tile server already adds CORS headers. The more important failures were:
- broken single-source TileJSON handling,
- unstable source identity,
- tests asserting against the wrong identity.

## Tests Run

### Passed
- `npm run test:unit -- tests/unit/desktop-tile-sources.test.mjs`
- `cargo test tile_server -- --nocapture`
- focused Tauri WDIO runs for `tests/tauri-e2e/tests/dem-tile-serving.spec.mjs`
- focused Tauri WDIO runs for `tests/tauri-e2e/tests/folder-tile-operations.spec.mjs`

### Partially blocked / environment-sensitive
- focused Tauri WDIO runs were intermittently blocked by WebDriver startup issues on `127.0.0.1:4445`
- later it became clear that Tauri e2e runs must consistently use `cargo build --features webdriver`

## Follow-up Pass: Error Policy, TLS, and Custom-Source Activation

### 5. Tauri error capture was tightened to fail on any captured page/runtime/network/resource error

Updated:
- `tests/tauri-e2e/tests/helpers.mjs`
- `tests/tauri-e2e/tests/dem-tile-serving.spec.mjs`
- `tests/tauri-e2e/tests/folder-tile-operations.spec.mjs`
- `tests/tauri-e2e/tests/custom-tile-serving.spec.mjs`

Instead of selectively filtering a subset of failures, the Tauri desktop specs now fail if any captured page error, unhandled rejection, fetch failure, or resource load failure occurs.

This removed a class of false-confidence runs where the test body passed but the embedded WKWebView had already recorded a real runtime problem.

### 6. Desktop test-mode TLS bypass was simplified around `ureq 3`

The first implementation used a custom `rustls` certificate verifier wired manually into `ureq 2`.

That worked, but it was heavier than necessary.

The current direction is:
- upgrade `src-tauri` from `ureq = "2"` to `ureq = "3"`
- remove the direct custom verifier implementation
- use `ureq::tls::TlsConfig::builder().disable_verification(true).build()` only when `TAURI_E2E_TESTS=1`

This keeps the bypass explicit, test-only, and much easier to audit.

### 7. A real single-file registration bug was found in the desktop helper

While investigating why the custom-source Tauri spec still stalled before rendering validation, another logic bug was found in `app/js/desktop-tile-sources.js`.

After `add_tile_source(cleanName, path)`, the helper fetched the TileJSON index and looked up the newly added source using:

- `source.name === cleanName`

That is wrong for MBTiles where metadata can set a human label such as `dummy-z1-z3` while the stable TileJSON identity remains `id = custom-mbtiles`.

The helper now prefers:

- `source.id === cleanName`

and falls back to `source.name` only if needed.

This aligns the helper with the earlier TileJSON identity fix.

### 8. Newly imported single custom sources now become the active basemap immediately

Requested behavior change:
- when a single custom tile file is imported/dropped, it should be added as a basemap layer by default
- folder scans should keep their previous multi-source behavior

Implementation direction:
- `registerDesktopTileSource()` now returns the registered catalog id
- `app/js/io.js` uses that catalog id after a successful single-file registration
- it then drives the existing `#basemap-primary` change flow so the imported source becomes the active basemap through the normal UI path

This avoids adding a second activation code path and reuses the existing `setBasemapStack()` flow, UI refresh, settings persistence, and layer-order updates.

### 9. The custom-source Tauri spec was adjusted to follow the visible label, not just one assumed option value

User observation during manual verification:
- the custom source appears in the dropdown
- it may appear multiple times
- the human-readable label is correct

Because of that, the test was updated to:
- clear persisted frontend state at the beginning of the run
- wait for the visible custom source label (`dummy-z1-z3`) in the UI controls
- activate the source through whichever real control currently exposes that label
- continue forward toward screenshot capture and canvas validation instead of failing early on a single hard-coded option value

This should better match the real desktop behavior and help distinguish:
- “source is present but test assumed the wrong value/id”
- from
- “source is present but still not activated/rendered correctly”

### 10. The custom-source Tauri spec now reaches screenshot capture, and the screenshot clarifies the current state

After the helper fix and the single-file auto-activation change, the custom Tauri spec was pushed further so it can:
- verify backend registration and TileJSON exposure,
- seed the same frontend user-source state that the single-file import flow now establishes,
- reload into a state where the custom source is selected as the primary basemap,
- capture a screenshot for direct visual inspection.

Current observed outcome:
- the spec now passes far enough to save `tests/tauri-e2e/screenshots/02-custom-mbtiles-active.png`
- the screenshot shows `dummy-z1-z3` selected in the `Basemap` control
- visually, the map area still appears blank/white in the screenshot

That means the latest pass successfully proved:
- the custom source can be registered,
- the frontend can expose/select it as the active basemap,
- the test can now capture authoritative visual evidence.

But it also means the current canvas probe is not yet a trustworthy rendering oracle, because it reported a fully non-white center sample while the saved screenshot still looks blank.

So the rendering investigation is now narrowed to:
- “selected and added in UI” is working,
- “visually rendered as expected on screen” is still not proven.

## Files Changed In This Pass

- `src-tauri/src/tile_server.rs`
- `app/js/tauri-bridge.js`
- `tests/tauri-e2e/tests/custom-tile-serving.spec.mjs`
- `tests/tauri-e2e/tests/folder-tile-operations.spec.mjs`
- `tests/tauri-e2e/tests/helpers.mjs`
- `src-tauri/src/tile_cache.rs`
- `src-tauri/Cargo.toml`
- `app/js/desktop-tile-sources.js`
- `app/js/io.js`
- `tests/unit/desktop-tile-sources.test.mjs`

## Remaining Follow-up

 The current follow-up is narrower now:
 - keep the `ureq 3` migration and helper changes committed together with the report updates
 - treat the screenshot as the current source of truth for the custom-source desktop rendering state
 - replace or refine the current canvas probe so it agrees with saved screenshot output instead of producing a false-positive non-white result
 - continue from “source selected in UI but map still visually white” as the next rendering-debug target
