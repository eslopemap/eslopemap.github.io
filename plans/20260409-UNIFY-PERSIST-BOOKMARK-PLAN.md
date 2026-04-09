# Plan: Cursor-info, UI cleanup, persistence & polish

**Source:** `prompts/20260408-4-cursorinfo-etc.md`  
**Date:** 2025-04-08  
**Scope:** 2 tasks spanning JS frontend, Rust backend, tests, and UX.

---

## Task 1 — Unified map layer state (architecture analysis)

**Problem:** Hillshade, contour, analysis mode, overlays, and custom layers each have independent persistence and sync logic. This causes inconsistencies when restoring bookmarks or reloading. The prompt asks whether MapLibre's `map.style` could be the single source of truth.

**Analysis of alternatives:**

### Discarded - Option A: MapLibre `map.getStyle()` as source of truth
- **Pros:** Single authoritative state; no drift; MapLibre handles z-order natively.
- **Cons:**
  - Composite layers (OpenSkiMap = 4 layers, SwissTopo vector = ~100 layers) make serialization bloated.
  - Custom metadata (catalog IDs, user-defined flag, hidden state) not representable in MapLibre style JSON.
  - Track overlays and DEM analysis layers use non-standard layer types (`terrain-analysis`).
  - MapLibre style is mutable and doesn't offer change events for external mutations.
- **Verdict:** **Not viable** as the sole source of truth.

### Option B: App-level canonical state (current approach, cleaned up)
- Keep `state.basemapStack`, `state.activeOverlays`, `state.layerOrder`, `state.layerSettings` as the source of truth.
- Add `state.showHillshade`, `state.hillshadeOpacity`, `state.hillshadeMethod`, `state.showContours`, `state.mode`, `state.slopeOpacity` to the same `layerOrder` / `layerSettings` model as **virtual entries** (e.g. `_hillshade`, `_analysis`, `_contours`).
- Bookmark save/restore then captures the full `layerOrder` + `layerSettings` including system layers → perfect round-trip.
- `renderLayerOrderPanel()` already renders them — just need stable IDs.
- **Pros:** Minimal refactor; single state shape for persistence, bookmarks, and sync.
- **Cons:** Need to unify the system-layer state keys with the catalog-layer settings format.

### Discarded - Option C: Derive MapLibre style *from* app state on every change
- Keep app state as truth; generate a complete `map.setStyle()` call from it.
- **Pros:** Guarantees no drift between state and map.
- **Cons:** `setStyle()` is destructive (removes all sources/layers and re-adds); breaks in-flight tiles, tracks, etc. Not practical.

**Recommendation:** **Option B** — promote system layers (hillshade, analysis, contours) to first-class entries in `layerOrder` / `layerSettings` with virtual catalog IDs. This unifies:
1. **Persistence** — single `saveSettings(state)` already covers everything via `SETTING_KEYS`.
2. **Bookmarks** — `createBookmark` already snapshots `layerOrder` + `layerSettings`; just include system layers.
3. **Sync** — `applyAllLayerSettings` + `applyLayerOrder` already loop over these; extend to handle virtual IDs.

**Change :**
- Add `_hillshade`, `_analysis`, `_contours` to `LAYER_CATALOG` as virtual entries (no real sources/layers; just metadata).
- `syncLayerOrder` includes them in the order.
- `renderLayerOrderPanel` renders them via the same loop (already close — `buildSystemLayerRow` just needs to be folded in).
- `createBookmark` / `applyBookmark` capture and restore mode, hillshade, contours as layerSettings.

**Persistence/cache/bookmark impact:** This IS the persistence unification.  
**Multi-stack impact:** Improves it.

---

## Task 2 — Fix bookmark restore glitchiness + add E2E test

**Problem:** Clicking a bookmark to restore layers can feel glitchy — multiple re-renders, possible race conditions in `setBasemapStack` (async) followed by synchronous overlay/settings application.

**Root cause analysis (`layer-engine.js:421-436` + `main.js:1427-1436`):**
1. `applyBookmark` sets `state.activeOverlays`, `state.layerOrder`, `state.layerSettings`, `state.basemapOpacities` — all trigger Proxy `set` traps.
2. `setBasemapStack` is `async` (may call `__ensureBasemapStyle` which loads a style.json).
3. After `await`, `applyAllOverlays` and `applyAllLayerSettings` run synchronously.
4. Back in `main.js`, `renderBasemapPrimary`, `renderAddLayerSelect`, `syncOverlayCheckboxes`, `renderLayerOrderPanel`, `renderBookmarkList` all fire, causing multiple DOM thrashes.
5. No batching — each state mutation can trigger `scheduleSettingsSave`.

**Fix:**
- Batch bookmark application: wrap `applyBookmark` body in a "silent" flag that suppresses reactive side-effects.
- Consolidate the post-apply UI refresh into a single `refreshAllLayerUI()` helper called once.
- Ensure `map.triggerRepaint()` is called once at the end.
- `applyBookmark` should also snapshot and restore: `mode`, `showHillshade`, `hillshadeOpacity`, `showContours`, `slopeOpacity` (if Task 3's virtual-layer approach is done, this is automatic).

**E2E test (`tests/e2e/bookmark.spec.js` — new file):**
```
1. Load app in test_mode
2. Add OSM + OpenSkiMap overlay, set analysis opacity to 0.7
3. Save bookmark
4. Switch to different basemap, remove overlay
5. Click bookmark to restore
6. Assert: basemapStack, activeOverlays, layerOrder, slopeOpacity match saved state
7. Assert: layer-order-panel rows match expected layers
8. Repeat with 2+ basemaps stacked + 2 overlays
```

**Persistence/cache/bookmark impact:** Directly improves bookmark reliability.  
**Multi-stack impact:** Tests multi-basemap restore.

---

## Task 3 — Ensure all 4 test suites pass

The 4 suites are:
1. **JS unit tests** — `npm run test:unit` (vitest, 14 files)
2. **Playwright E2E** — `npm test` (73 tests)
3. **Rust unit tests** — `cd src-tauri && cargo test` (48 tests)
4. **Tauri WebDriver E2E** — `cd tests/tauri-e2e && npm test` (8 tests, requires `cargo build --features webdriver`)

**Action:** Run each suite after every task, fix any regressions. Particularly watch for:
- Removed `#basemap` / `#basemap-primary` selectors breaking E2E locators.
- Changed bookmark behavior breaking persistence tests.

---

don't take existing thigs for granted unless well tested, be critical, address debt as you go.
Git commits: one per task, prefixed `feat:` / `fix:` / `chore:`.
report in ./report/20260409-unify-persist-bookmark-report.md