# Desktop Persistence and Tile Drop Report

## Scope

Worked from `prompts/20260408-persist-desktop.md`.

This pass focused on:
- making desktop startup/restoration rely on persisted state where the web app previously relied on the URL hash,
- preserving the existing rule that URL state overrides persisted defaults,
- fixing desktop tile drag-and-drop path handling,
- adding regression coverage around the new behavior.

## Implemented Changes

### 1. Desktop view state now persists

The app now persists and restores the following map view fields through `slope:settings`:
- `viewCenter`
- `viewZoom`
- `viewBearing`
- `viewPitch`

This lets desktop sessions reopen with the previous viewport even when there is no meaningful startup URL.

### 2. URL overrides remain authoritative, but only when explicitly provided

`parseHashParams()` was changed to return only explicit, validated hash overrides.

This fixes an important edge case from the previous behavior: a partial URL hash could accidentally replace persisted state with fallback defaults. Example: `#mode=color-relief` no longer also forces the center to `0,0` or resets unrelated state.

The startup flow is now:
- load persisted settings,
- build default initial view,
- apply persisted viewport defaults,
- apply explicit URL overrides on top.

The same explicit-only behavior is now used for `hashchange` navigation.

### 3. Additional desktop-relevant settings are now persisted

The persistence whitelist was extended for:
- `showHillshade`
- `showTileGrid`
- `viewCenter`
- `viewZoom`
- `viewBearing`
- `viewPitch`

`clearAll()` also now clears persisted user tile sources.

### 4. Tile drag-and-drop fixes

#### Direct tile file drops

Direct `.mbtiles` / `.pmtiles` drops now attempt desktop registration when running under Tauri instead of immediately warning as if the app were in web mode.

#### Folder tile drops

Dropped-folder tile registration now resolves paths using a shared helper that prefers `file.path` over `entry.fullPath`.

This matters because `entry.fullPath` can be folder-relative for drag-dropped entries, while `file.path` is the real filesystem path exposed by the desktop runtime.

## Current State Inventory

### A. Persisted state

#### Settings (`slope:settings`)
- `basemap`
- `basemapStack`
- `basemapOpacities`
- `mode`
- `slopeOpacity`
- `basemapOpacity`
- `hillshadeOpacity`
- `hillshadeMethod`
- `terrain3d`
- `terrainExaggeration`
- `multiplyBlend`
- `showHillshade`
- `showContours`
- `showTileGrid`
- `activeOverlays`
- `layerOrder`
- `layerSettings`
- `bookmarks`
- `cursorInfoMode`
- `pauseThreshold`
- `profileSmoothing`
- `viewCenter`
- `viewZoom`
- `viewBearing`
- `viewPitch`

#### Other persisted browser data
- tracks via `slope:tracks`
- waypoints via `slope:waypoints`
- workspace tree metadata via `slope:workspace`
- profile chart display settings via `slope:profile-settings`
- user-defined tile/catalog sources via `slope:user-sources`

### B. URL-overridable state

Current validated hash overrides:
- `lng` + `lat` -> `center`
- `zoom`
- `basemap`
- `mode`
- `opacity` -> `slopeOpacity`
- `terrain` -> `terrain3d`
- `exaggeration` -> `terrainExaggeration`
- `test_mode`
- `bearing`
- `pitch`

These overrides apply on top of persisted/default state.

### C. Transient UI/runtime-only state

These are currently not persisted and are only held in runtime/UI state:
- settings panel open/closed state
- layers panel open/closed state
- tracks panel open/closed state
- profile panel open/closed state
- current active track / hover state / tooltip state
- edit mode / selection mode / rectangle mode / undo interaction state
- drag-and-drop overlay visibility
- temporary geolocation state
- temporary import/export dialog state
- current debug panel expansion state

This split still seems reasonable overall. The strongest remaining candidate for future persistence would be panel visibility if desktop users want exact UI restoration across launches.

## Debt / Opportunities Observed

### 1. URL and persisted settings are still split across multiple concepts

The current architecture is workable, but the app still has two separate state channels:
- persisted app state,
- URL-derived view state.

A future simplification would be to centralize this into one explicit `deriveInitialState()` function and one explicit `applyUrlOverrides()` function.

### 2. Panel visibility is mostly DOM-owned instead of state-owned

Panel visibility is managed through DOM classes in `main.js`, which makes it harder to persist and reason about consistently. If panel restoration becomes important, those flags should move into an explicit UI-state object.

### 3. Tile discovery and registration paths are duplicated

There is still overlap between:
- folder scan registration,
- dropped tile registration,
- desktop startup TileJSON discovery.

The new shared path resolver helps, but tile registration could still be consolidated further into one reusable flow.

## Tests Added / Updated

### Added
- `tests/unit/ui-url-state.test.mjs`
- `tests/unit/io-tile-drop.test.mjs`

### Updated
- `tests/unit/persist.test.mjs`
- `tests/tauri-e2e/tests/folder-tile-operations.spec.mjs`

## Test Results

### Passed
- `npm run test:unit`
- focused unit validation for persistence, URL parsing, tile drop path resolution, and Tauri bridge behavior

### Blocked by local environment
- `npx playwright test tests/e2e/persist.spec.js`
  - failed because the configured local web server on `http://localhost:8089` returned `ERR_EMPTY_RESPONSE`
  - `:8089` was already occupied during this run
- `npx wdio run wdio.conf.mjs --spec ./tests/folder-tile-operations.spec.mjs`
  - failed because the desktop tile server could not bind `127.0.0.1:14321` (`Address already in use`)
  - this prevented the Tauri app from fully starting its WebDriver session

These failures look environmental rather than feature-regression failures.

## Files Changed

- `app/js/ui.js`
- `app/js/main.js`
- `app/js/persist.js`
- `app/js/io.js`
- `tests/unit/persist.test.mjs`
- `tests/unit/ui-url-state.test.mjs`
- `tests/unit/io-tile-drop.test.mjs`
- `tests/tauri-e2e/tests/folder-tile-operations.spec.mjs`

## Commit Note

The prompt asked for commits per task, but no commits were created in this pass.
