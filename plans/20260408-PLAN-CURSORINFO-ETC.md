# Plan: Cursor-info, UI cleanup, persistence & polish

**Source:** `prompts/20260408-4-cursorinfo-etc.md`  
**Date:** 2025-04-08  
**Scope:** tasks spanning JS frontend, Rust backend, tests, and UX.

Previous state

FEATURES.md
reports/20260409-unify-persist-bookmark-report.md


## Task 4 - Silence TS lint noise

`@ts-nocheck` directive was added in bookmark.spec.js (untyped JS with custom Playwright fixtures), check other tests in e2e and tauri-e2e where it makes sense.

---

## Task 5 — Remove legacy Basemap dropdown from Settings

**Problem:** The old `<select id="basemap">` (now hidden) and `<select id="basemap-primary">` in the Layers panel are redundant with the "Add layer" dropdown which supports multi-basemap stacking. The primary basemap selector still encourages single-basemap thinking.

**Current state:**
- `index.html:74` — hidden `<select id="basemap">` for backward compat
- `index.html:118-121` — `<select id="basemap-primary">` in Layers panel
- `main.js:955-966` — `#basemap` change handler (single-basemap logic)
- `main.js:1104-1118` — `renderBasemapPrimary()`
- `main.js:1178-1189` — `renderBasemapSelect()` (legacy)
- `state.js:19` — `basemap: 'osm'` (backward compat scalar)
- `persist.js:73` — `'basemap'` in SETTING_KEYS
- `layer-engine.js:192` - setBasemap() wrapper


**Change:**
- Remove `<select id="basemap-primary">` from `index.html` and its `.basemap-row` container.
- Remove `<select id="basemap" style="display:none">` hidden element.
- Remove `renderBasemapPrimary()`, `renderBasemapSelect()`, and their callers.
- Remove the `#basemap` and `#basemap-primary` event listeners.
- Keep `state.basemap` as a **derived getter** (= `basemapStack[0] || 'none'`) — set it in `setBasemapStack` only (already done at `layer-engine.js:122`).
- Keep `'basemap'` in `SETTING_KEYS` for migration: on load, if `basemapStack` is absent/empty, initialize from `basemap`. Remove `basemap` from the URL hash write (keep reading for migration).
- In the "Add layer" dropdown, move basemaps to the top of the list and highlight the bottom (primary) one if it's the only basemap.
- Add a label "Primary basemap" in the Layer order panel for the bottom-most basemap entry, or bold it (already done via `.layer-basemap`).

**Persistence/cache/bookmark impact:** Migration path from single `basemap` → `basemapStack` already exists in `migrateSettings`. Keep it. Remove `basemap` from URL hash writes, keep reads.  
**Multi-stack impact:** This *is* the multi-stack cleanup.

---

## Task 6 — Cursor info: try all DEM sources

**Problem:** `queryLoadedElevationAtLngLat` (`dem.js:29-84`) only queries `DEM_HD_SOURCE_ID` (`dem-hd`). If hillshade is disabled (no `dem-loader` layer visible), the `dem-hd` tile manager may not have loaded tiles, causing "no loaded tile" for cursor info. But other sources (`dem-terrain` for 3D terrain, or contour source) may have DEM data available.

**Current state:**
- `dem.js:31` — hardcoded: `style.tileManagers[DEM_HD_SOURCE_ID]`
- Two raster-dem sources exist: `DEM_TERRAIN_SOURCE_ID` and `DEM_HD_SOURCE_ID` (both defined in `main.js:363-364`)
- The contour source (`demContourSource`) is a vector tile source from `maplibre-contour` — not directly queryable for elevation.

**Change in `dem.js`:**
- Make `queryLoadedElevationAtLngLat` try multiple DEM source IDs in priority order: `[DEM_HD_SOURCE_ID, DEM_TERRAIN_SOURCE_ID]`.
- For each, check if the tileManager exists and has renderable tiles.
- Return the first successful result.
- Import `DEM_TERRAIN_SOURCE_ID` from constants.

```js
const DEM_SOURCE_IDS = [DEM_HD_SOURCE_ID, DEM_TERRAIN_SOURCE_ID];

export function queryLoadedElevationAtLngLat(map, lngLat) {
  for (const sourceId of DEM_SOURCE_IDS) {
    const result = queryElevationFromSource(map, lngLat, sourceId);
    if (result) return result;
  }
  return null;
}
```

- Extract the current body into `queryElevationFromSource(map, lngLat, sourceId)`.

**Persistence/cache/bookmark impact:** None.  
**Multi-stack impact:** None.

---

## Task 7 — Folder drop: register folder path instead of individual files (Tauri)

**Problem:** Dropping a folder of tile files registers each `.mbtiles`/`.pmtiles` individually via `handleTileFile`, making the config unmanageable. Should register the *folder* on the server side.

**Current state (`io.js:819-836`):**
- `readDirectoryEntries` recurses into dropped directories, calling `handleTileFileEntry` per file.
- `handleTileFile` calls `addTileSource(name, path)` per file.
- The Tauri side has `scanTileFolder(folderPath)` which scans and auto-registers a whole folder.
- `openFolderTauri()` already uses `scanAndRegisterDesktopTileFolder(folderPath)` correctly.

**Change:**
- In the drop handler (`io.js:604-609`), when a directory entry is detected AND `isTauri()`, call `scanAndRegisterDesktopTileFolder(dirEntry.fullPath || dirEntry.name)` for the directory instead of recursing file-by-file for tile files.
- Keep the per-file recursion for GPX/GeoJSON files (those are read client-side).
- For non-Tauri (web), keep current behavior (no tile registration possible anyway).

**Actual code path:**
```js
if (entry.isDirectory) {
  if (isTauri()) {
    // Register folder as tile source
    const folderPath = resolveDroppedTilePath(entry, null) || entry.fullPath;
    await scanAndRegisterDesktopTileFolder(folderPath, { refreshUi: window.refreshTileLayers });
  }
  // Still read GPX files from the directory
  await readDirectoryEntries(entry); // but skip tile files inside
}
```

- In `readDirectoryEntries`, skip tile files if called from a folder-level drop that already did `scanAndRegisterDesktopTileFolder`. Pass a flag or check if parent was already scanned.

**Persistence/cache/bookmark impact:** None (tile sources already persisted via Tauri config).  
**Multi-stack impact:** None.

---

## Task 8 — Server tile cache size from UI

**Problem:** The tile cache max size is set in `slopemapper.toml` (`[cache] max_size_mb = 100`). There's no UI to change it.

**Change:**
- **Rust side:** Add a new Tauri command `update_config(cache_max_size_mb: u64)` in `src-tauri/src/main.rs`
  1. Updates the in-memory `AppConfig.cache.max_size_mb`
  2. Writes the updated config to `slopemapper.toml`
  3. Updates the `TileCache` instance's max size
- **JS side (`saved-data.js`):** In the "Server tile cache" row, add an editable max-size display:
  - Show current max as `(max 100 MB)` — already done at line 151.
  - Add a small "edit" icon button next to the max size.
  - Clicking it shows an inline `<input type="number">` with the current MB value.
  - On change, call a new `setTileCacheMaxSize(mb)` bridge function.
- **tauri-bridge.js:** Add `setTileCacheMaxSize(maxSizeMb)` → `invoke('set_cache_max_size', { maxSizeMb })`.

**UX sketch (in Saved Data panel):**
```
Server tile cache
/Users/x/Library/Caches/slopemapper/tiles/
42.3 MB — 1,234 tiles (max [100] MB ✎)    [Clear]
```

Clicking ✎ turns `100` into an input. Enter/blur confirms.

**Persistence/cache/bookmark impact:** Persists to TOML config file.  
**Multi-stack impact:** Desktop only.

---

## Task 9 — Delete custom sources from UI

**Problem:** No way to remove user-defined tile sources from the UI. Backend has `removeTileSource(name)` and JS has `unregisterUserSource(id)`, but no UI trigger.

**Change:**

### A. "Clear all custom sources" in Saved Data panel
- Add a new row in `saved-data.js` (Tauri mode only): "Custom tile sources" showing count + source names.
- "Clear" button calls `clearUserSources()` (JS) + iterates `listTileSources()` → `removeTileSource(name)` for each (Tauri).
- Refresh UI.

### B. Per-source delete in Layer catalog panel
#### Discarded - option A
- Turn the dropdown catalog into its own expandable surface.  Individual Delete: Add remove button (✕) to custom source entries in there for user-defined entries (`entry.userDefined === true`) (layer order is NOT a good place):
- add a small 🗑 icon next to custom sources in the "Add layer" dropdown's "Custom maps" optgroup. Clicking it removes the source.
  - "Delete source" calls `unregisterUserSource(entry.id)` + `removeTileSource(entry.tileJson?.id)` (Tauri).
#### Recommended - option B
- Add a separate "Manage sources" section in Saved Data panel listing each custom source with individual delete buttons, listing folders as a single item (mapping to the server).

**UX sketch (Saved Data panel, Tauri mode):**
```
Custom tile sources (3)
  ├ swisstopo-25k          [🗑]
  ├ my-local-osm            [🗑]  
  └ terrain-rgb              [🗑]
                        [Clear all]
```

**Persistence/cache/bookmark impact:** Removes from `persist.js` user sources storage + Tauri server.  
**Multi-stack impact:** Desktop only for Tauri sources; web user sources handled by `clearUserSources()`.

---

## Task 10 — Cargo build warnings check

**Problem:** Cargo warnings may go unnoticed during development.

**Options:**
1. **`#![deny(warnings)]` in `main.rs`** — too invasive during development (blocks compilation).
2. **CI-only:** `RUSTFLAGS="-D warnings"` in `.github/workflows/ci.yml` — catches warnings in CI without blocking local dev.
3. **Justfile recipe:** `just check-warnings` that runs `cargo check 2>&1 | grep warning` and fails if any.
4. **Clippy in CI:** Add `cargo clippy -- -D warnings` to CI.

**Recommended:** Options 2 + 4 (CI enforcement) + 3 (local convenience).

**Change:**
- Add `RUSTFLAGS: "-D warnings"` to the `rust-tests` job env in `.github/workflows/ci.yml`.
- Add `cargo clippy -- -D warnings` step to CI.
- Add to `justfile`:
  ```
  # Check for Rust warnings (CI-equivalent strictness)
  check-warnings:
      cd src-tauri && RUSTFLAGS="-D warnings" cargo check 2>&1
  
  # Run clippy with warnings as errors
  clippy:
      cd src-tauri && cargo clippy -- -D warnings
  ```

**Persistence/cache/bookmark impact:** None.  
**Multi-stack impact:** None.

---

## Task 11 — Ensure all 4 test suites pass

The 4 suites are:
1. **JS unit tests** — `npm run test:unit` (vitest, 14 files)
2. **Playwright E2E** — `npm test` (73 tests)
3. **Rust unit tests** — `cd src-tauri && cargo test` (48 tests)
4. **Tauri WebDriver E2E** — `cd tests/tauri-e2e && npm test` (8 tests, requires `cargo build --features webdriver`)

**Action:** Run each suite after every task, fix any regressions. Particularly watch for:
- Removed `#basemap` / `#basemap-primary` selectors breaking E2E locators.
- Changed bookmark behavior breaking persistence tests.
- New DEM source fallback changing cursor-info test expectations.

---

## Task 12 — Assess cross-cutting concerns

Each task above includes a mini-assessment. Summary:

| Concern | Tasks that affect it |
|---|---|
| **Persistence** | T2 (basemap migration), T3 (layer state unification), T4 (bookmark fix), T5 (bookmark rename), T8 (cache config) |
| **Caching** | T6 (DEM source fallback), T8 (cache size) |
| **Bookmarks** | T3 (virtual layers in bookmarks), T4 (restore fix), T5 (rename fix) |
| **Multi-stack (web+tauri)** | T7 (folder drop), T8 (cache UI), T9 (delete sources) — all Tauri-only with web fallbacks |

## Task 13 - Update doc

check git log -30 to see what changed
Update FEATURES.md, UI/md, and user-doc

---

**S** = small (~1h), **M** = medium (~2-4h), **L** = large (~1 day)

single report : reports/20260409-cursorinfo-etc-report.md
Git commits: one per task, prefixed `feat:` / `fix:` / `chore:`.
