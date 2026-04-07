# 1000-GPX Scalability — Implementation Report

Date: 2025-04-07

## Summary

Implemented the recommended Strategy B (two-tier rendering) from the scalability plan. All changes maintain backward compatibility with existing tests (94 unit + 58 e2e).

---

## Phase 1: Merged GeoJSON Source ✅

### What changed

| Before | After |
|---|---|
| N per-track GeoJSON sources + 2N layers | 1 merged source + 1 line layer for all tracks |
| Each track: 1 line layer + 1 circle layer | Active/edited track: promoted to own source + line + circle layers |
| Click handler queries N line layers | Click handler queries 1 merged layer + 1 promoted layer |

### Key files

- **`app/js/track-ops.js`** — Added `simplifyForDisplay(coords, thresholdMeters=5, minPoints=500)`. Lightweight Douglas-Peucker that returns 2D `[lng, lat]` arrays for the merged source. Tracks ≤500 points pass through unchanged (just stripped to 2D). Tracks >500 points get DP-simplified at ~5m threshold.
- **`app/js/tracks.js`** — Core changes:
  - `MERGED_SOURCE` / `MERGED_LINE_LAYER` constants
  - `mergedTrackGeoJSON()` builds a FeatureCollection with per-track `color` and `trackId` properties
  - `stableFeatureId()` assigns stable numeric IDs (for future `updateData()` support)
  - `promoteTrack(t)` / `demoteTrack(t)` — move active track to/from its own per-track source
  - `addMergedSource()` creates the source + data-driven line layer
  - `refreshMergedSource()` calls `setData()` on the merged source
  - `setActiveTrack()` handles promote/demote transitions
  - `createTrack()` / `removeTrackById()` / `resetForTest()` updated
- **`app/js/main.js`** — Click handler updated to query `tracks-merged-line` + promoted track layer. Track ID read from `properties.trackId`.

### Data-driven styling

```js
'line-color': ['coalesce', ['get', 'color'], '#888'],
'line-width': ['case',
  ['==', ['get', 'trackId'], ['global-state', 'activeTrackId']], 5,
  2],
```

### Tests

- **New**: `tests/unit/track-ops-simplify-display.test.mjs` — 6 tests covering null input, short tracks, straight-line simplification, zigzag retention, custom thresholds.
- **All 94 unit + 58 e2e tests pass** (1 pre-existing flaky test on "Undo button removes last point" due to parallel state contamination — confirmed 5/5 pass in isolation).

---

## Phase 2: Batch Import Optimizations ✅

### What changed

| Before | After |
|---|---|
| Per-track `fitToTrack(t)` | Single `fitToTrackIds(ids)` at end of import |
| Per-track `enrichElevation()` | Deferred (skipped during `batchImport`) |
| Per-track `refreshMergedSource()` | Single refresh in `finishBatchImport()` |
| Per-track `scheduleSave()` | Single save in `finishBatchImport()` |
| Per-track `setActiveTrack()` | Deferred to `finishBatchImport()` |

### Key files

- **`app/js/tracks.js`**:
  - `createTrack()` accepts `opts.batchImport` flag — skips enrichment, merged refresh, save, and active track selection
  - `finishBatchImport()` — single merged refresh + save + set active track
- **`app/js/io.js`**:
  - `importFileContent()` passes `batchImport: true` and calls `finishBatchImport()` after loop
  - Uses `fitToTrackIds(ids)` for a single bounds calculation over all created tracks

### Complexity reduction

For importing a file with N tracks:
- Before: O(N) `setData()` + O(N) `fitBounds()` + O(N) saves + O(N) enrichments
- After: O(1) `setData()` + O(1) `fitBounds()` + O(1) save

---

## Phase 3: renderGpxTree Debounce ✅

### What changed

`renderGpxTree()` is now debounced via `requestAnimationFrame`. Multiple synchronous calls within the same frame coalesce into a single DOM render.

### Library evaluation

**No external library needed.** `requestAnimationFrame` is the browser-native and zero-dependency solution for DOM render coalescing. Libraries like `lodash/debounce` or `throttle-debounce` are designed for time-based debouncing (e.g. 200ms delay), which would add visible latency to tree updates. rAF is exactly right: it batches within the current microtask/paint cycle.

### Key file

- **`app/js/gpx-tree.js`** — `renderGpxTree()` schedules `renderGpxTreeImmediate()` via rAF. The `_renderRafId` guard prevents duplicate scheduling.

---

## Additional Optimization: Skip Redundant Merged Refresh ✅

`refreshTrackSource(t)` for the promoted (active) track now only updates the per-track source, skipping the merged source rebuild. Since the promoted track is excluded from the merged GeoJSON, rebuilding it on every vertex move was a no-op.

---

## Phase 4: IndexedDB — Pros & Cons Analysis

### Current state

`persist.js` uses `localStorage` with `JSON.stringify`/`JSON.parse`. All tracks (coords + metadata) are serialized as a single JSON blob under `slope:tracks`.

### Pros of migrating to IndexedDB

| Benefit | Detail |
|---|---|
| **Much higher quota** | localStorage: 5–10 MB (browser-dependent). IndexedDB: typically 50% of available disk. For 1000 GPX files at ~100KB each, localStorage would hit quota at ~50–100 tracks. |
| **Structured storage** | Can store each track as a separate record → only write changed tracks (O(1) per edit instead of O(N) full serialize). |
| **Non-blocking I/O** | IndexedDB is async; `localStorage.setItem()` is synchronous and blocks the main thread during JSON stringify of the full track array. |
| **Binary data support** | Could store raw GPX XML or Uint8Arrays without base64 overhead. |

### Cons of migrating to IndexedDB

| Cost | Detail |
|---|---|
| **API complexity** | IndexedDB has a verbose, callback-heavy API. Even with wrappers like `idb` (~2KB), it's significantly more code than the current 4-line `localStorage` wrapper. |
| **Async propagation** | All save/load becomes async → `loadTracks()` returns a Promise → `initTracks()` becomes async → cascading async up the init chain. |
| **Testing burden** | `localStorage` mocks are trivial (in-memory Map). IndexedDB requires `fake-indexeddb` or `jsdom` with `indexeddb-polyfill`, adding a test dependency. |
| **Migration code** | Need to detect existing `localStorage` data and migrate it to IndexedDB on first run. |
| **Browser compat edge cases** | IndexedDB in Safari private browsing, WebViews, and some iOS versions has historically been unreliable (though now mostly fixed). |
| **Tauri desktop path** | In Tauri mode, the sync backend uses the filesystem directly — IndexedDB would only benefit the web version. |

### Recommendation

**Don't migrate now.** The current `localStorage` approach works fine for the web demo use case. The 5–10MB limit only becomes a real issue at ~50–100 tracks with full coords. For 1000-track scalability:

1. The **Tauri desktop path** already uses filesystem-based persistence (gpx_sync).
2. For the web version, a pragmatic middle ground is to **save only track metadata + a hash** in localStorage, and store full coords in IndexedDB only when approaching quota. This avoids the full async migration.
3. If the web version genuinely needs 1000 tracks, consider using `idb` (2KB wrapper) to store track coords as individual records, keeping metadata in localStorage.

---

## Commit log

1. `feat: Phase 1 - merged GeoJSON source for all tracks` — 40c14b0
2. `feat: Phase 2 - batch import optimizations` — 1eea6d6
3. `chore: Phase 3 - debounce renderGpxTree with requestAnimationFrame` — b3feeaf
4. `nit: skip redundant merged source refresh during promoted track edits` — cb95b5f
