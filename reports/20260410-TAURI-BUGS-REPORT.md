# 2026-04-10 Tauri Bugs Report

## Scope

This pass addressed three desktop issues reported during `cargo tauri dev --features webdriver`:

1. DEM upstream fetch failures with `invalid peer certificate: UnknownIssuer`
2. `Uncaught ReferenceError: chart is not defined` in `profile.js`
3. Broken Tauri drag-and-drop for tile files and folders

## Root Causes

### 1. DEM TLS failures in desktop dev

The desktop tile cache used strict upstream TLS verification by default.

Behind a corporate VPN/proxy, upstream DEM requests to `https://tiles.mapterhorn.com/...` can fail with `UnknownIssuer`, which then propagates to the frontend as a local tile-server `502`.

### 2. Profile panel resize bug

`app/js/profile.js` stored the chart instance in `profileChart` but the resize handler still referenced `chart`, which does not exist in that module scope.

### 3. Tauri drag-and-drop path handling

`app/js/io.js` only processed HTML5 `webkitGetAsEntry()` drops when at least one dropped item was a directory.

That caused two desktop-specific problems:

- single dropped tile files skipped the entry-based path resolution and fell back to `File` objects that may not expose `file.path`
- dropped folders used a folder-scan path assumption that can be invalid in WKWebView/Tauri drag-and-drop, producing `Not a directory`

A secondary issue was that directory reading only consumed a single `readEntries()` batch instead of draining the reader fully.

## Implemented Fixes

### `src-tauri/src/tile_cache.rs`

- added `SLOPE_INSECURE_UPSTREAM_TLS=1` opt-in support
- kept Tauri e2e insecure mode support
- added a debug-only retry path when the initial secure fetch fails with an `UnknownIssuer`-style certificate error
- improved the returned 502 body to explain the TLS issue and mention the opt-in env var
- logged the debug insecure retry once instead of spamming every tile request

### `app/js/profile.js`

- replaced `chart.resize()` with `profileChart.resize()`

### `app/js/io.js`

- fixed dropped-entry collection so only real `FileSystemEntry` objects are processed
- processed dropped file entries as well as directories, instead of only handling the directory case
- removed the drag-drop-time dependency on bulk folder scanning by folder path
- recursively handled dropped directories through entry traversal instead
- added `readAllDirectoryEntries()` to fully drain the browser directory reader API

## Validation

### Passed

- `npx --yes vitest run --config vitest.config.mjs tests/unit/io-tile-drop.test.mjs`
- `cargo test tile_cache -- --nocapture`
- `npx playwright test tests/e2e/profile.spec.js`

## Notes

- The TLS change is intentionally scoped: release builds still do not silently disable verification by default.
- In debug desktop development, certificate-validation failures now recover automatically for this specific proxy/interception scenario.
- If needed, the manual override remains available via `SLOPE_INSECURE_UPSTREAM_TLS=1`.

## Remaining Risk

The Tauri drag-and-drop fix aligns the implementation with how entry-based desktop drops are already expected to work in this codebase, but the current automated tests do not fully synthesize a real native macOS drop gesture into the running desktop app. A focused manual desktop verification remains useful for final confirmation.
