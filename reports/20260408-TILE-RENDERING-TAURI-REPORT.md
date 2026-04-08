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

### Partially blocked / environment-sensitive
- focused Tauri WDIO runs were intermittently blocked by WebDriver startup issues on `127.0.0.1:4445`
- later it became clear that Tauri e2e runs must consistently use `cargo build --features webdriver`

## Files Changed In This Pass

- `src-tauri/src/tile_server.rs`
- `app/js/tauri-bridge.js`
- `tests/tauri-e2e/tests/custom-tile-serving.spec.mjs`
- `tests/tauri-e2e/tests/folder-tile-operations.spec.mjs`

## Remaining Follow-up

The next pass should:
- make shared Tauri helpers fail tests on any captured page/network/resource error,
- remove selective error filtering from DEM coverage,
- handle upstream TLS certificate issues in desktop tests running behind a corporate proxy/VPN,
- rerun focused Tauri WDIO specs using a webdriver-enabled build.
