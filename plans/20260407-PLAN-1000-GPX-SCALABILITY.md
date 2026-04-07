# Plan — Scaling to 1 000 GPX Files

## Context

The app currently creates **one MapLibre GeoJSON source + two layers (line + circle)** per track.
A single GPX file may contain multiple `<trk>` with multiple `<trkseg>`, so 1 000 files can easily yield 1 500–3 000 track objects.
Each track also triggers: elevation enrichment, stats computation, tree node DOM creation, and localStorage serialization.

### Current bottlenecks (by severity)

| Area | Cost per track | At 2 000 tracks |
|---|---|---|
| **MapLibre sources/layers** | 1 source + 2 layers | 2 000 sources, 4 000 layers — well past the ~500 layer perf cliff |
| **GeoJSON point features** | Every vertex becomes a Point feature (start/mid/end) | Millions of features; `setData()` serialisation alone takes seconds |
| **Tree DOM** | Full `innerHTML = ''` rebuild on every `renderGpxTree()` | Thousands of DOM nodes recreated on each interaction |
| **localStorage** | JSON.stringify of all coords on every debounced save | 100 MB+ payload; quota exceeded in most browsers |
| **Elevation enrichment** | `queryLoadedElevationAtLngLat` per coord on DEM tile events | O(n × points) synchronous pixel reads |
| **Stats computation** | Terrain slope sampling + haversine loop | Blocks UI on each `renderTrackList()` |
| **`fitToTrack` per file** | Called once per parsed track during import | 2 000 `fitBounds` calls |

---

## Deep dive: how MapLibre handles a GeoJSON source internally

Understanding this pipeline is critical to answering: "if we put everything into one huge GeoJSON, is MapLibre smart enough?"

### 1. Main thread → Web Worker hand-off

When you call `map.addSource('tracks', { type: 'geojson', data: featureCollection })` or later `source.setData(fc)`, the `GeoJSONSource` (main thread, `geojson_source.ts`) serializes the entire FeatureCollection and posts it to a `GeoJSONWorkerSource` running in a **Web Worker** (`geojson_worker_source.ts`). This transfer uses structured clone — the main thread is blocked only for serialization, not tiling.

Key code path: `GeoJSONSource.setData()` → `_updateWorkerData()` → `actor.sendAsync(MessageType.loadData, ...)` → worker `loadData()`.

### 2. Worker: convert + simplify (one-time, O(n) cost)

Inside the worker, `loadData()` calls `geojsonvt(data, options)` which invokes:

1. **`convert()`** (`convert.ts`): projects every coordinate to Mercator `[0,1]` space. For each LineString, it runs **Douglas-Peucker simplification** and stores the squared-distance importance value as the **3rd component** of each projected coordinate (`coords[i+2]`). The tolerance is computed from `maxZoom` and `extent`:
   ```
   tolerance = (options.tolerance / ((1 << maxZoom) * extent))²
   ```
   With MapLibre defaults (`tolerance=0.375 pixels`, `maxZoom=18`, `extent=4096`), this is very fine — it preserves detail down to sub-pixel at zoom 18. **All simplification data is precomputed once** in this step.

2. **`wrap()`**: handles features crossing the antimeridian.

### 3. Worker: recursive tile splitting (top-down, lazy below `indexMaxZoom`)

`splitTile()` (`index.ts`) recursively clips features into quadtree children:

- It starts at tile `z=0/x=0/y=0` and works **down** to `indexMaxZoom` (default **5**) or until a tile has fewer than `indexMaxPoints` (default **100 000**) points.
- Each tile stores its clipped features (via `clip()` which does axis-aligned Sutherland-Hodgman clipping).
- Tiles up to `indexMaxZoom` are **eagerly pre-split** and **cached** in `this.tiles{}` (a plain JS object keyed by `toID(z,x,y)`).
- Below `indexMaxZoom`, tiles **retain `tile.source`** — the parent's raw feature array — so they can be drilled into later.

### 4. Worker: on-demand drilling for zoom > indexMaxZoom

When the renderer requests a tile at, say, z=12, the worker calls `geoJSONIndex.getTile(12, x, y)`:

1. If `tiles[id]` exists (cache hit) → return it.
2. Otherwise, **walk up** the zoom pyramid to find the nearest ancestor that has `tile.source` still attached.
3. Call `splitTile(parent.source, z0, x0, y0, targetZ, targetX, targetY)` — this drills down only the branch needed, creating and caching intermediate tiles along the way.
4. The result is cached in `tiles{}` for future requests.

**This means MapLibre never computes tiles it doesn't need.** Only tiles visible in the current viewport are generated. Panning to a new area triggers drilling on demand.

### 5. Per-tile simplification at render time (zoom-dependent detail)

When `createTile()` (`tile.ts`) produces the final tile features, it applies **zoom-dependent simplification**:

```js
const tolerance = z === options.maxZoom ? 0 : options.tolerance / ((1 << z) * options.extent);
```

For each LineString ring, only points whose precomputed importance value (`coords[i+2]`) exceeds `sqTolerance` survive into the tile:

```js
for (let i = 0; i < geom.length; i += 3) {
    if (tolerance === 0 || geom[i + 2] > sqTolerance) {
        tile.numSimplified++;
        ring.push(geom[i], geom[i + 1]);
    }
    tile.numPoints++;
}
```

**This is the key answer to "do we need to swap low-res for high-res when zooming?"** — **No.** `geojson-vt` already does this automatically. At zoom 5, a 10 000-point GPX track might be rendered with only ~50 points. At zoom 15, it might be 2 000. The full original coords are never sent to the GPU at low zoom.

### 6. Tile cache in the TileManager (main thread)

Back on the main thread, `TileManager` (`tile_manager.ts`) maintains:

- **`_inViewTiles`** — tiles currently needed for rendering (determined by `coveringTiles()` which computes the visible tile pyramid from the current transform/pitch/bearing).
- **`_outOfViewCache`** — an **LRU cache** of recently used tiles that left the viewport. Default size: `ceil(viewportWidth/tileSize + 1) * ceil(viewportHeight/tileSize + 1) * MAX_TILE_CACHE_ZOOM_LEVELS`. This means panning back to a previously viewed area reuses the cached tile without re-requesting from the worker.

When a `setData()` call completes on the worker, the TileManager **invalidates and reloads** in-view tiles. With `updateData()` (diff API), it only reloads tiles whose bounds intersect the changed features — this is the incremental path.

### 7. Cost summary for a single merged GeoJSON of 2 000 tracks

| Step | When | Cost | Worker? |
|---|---|---|---|
| Structured clone of FeatureCollection | `setData()` | ~50 ms for 2 000 LineStrings (50 MB JSON) | Main→Worker transfer |
| `convert()` + simplify | Once after `setData()` | ~200–500 ms for 2M points | ✅ Worker |
| `splitTile()` down to `indexMaxZoom=5` | Once after `setData()` | ~100 ms | ✅ Worker |
| Per-viewport `getTile()` drilling | On pan/zoom | ~1–5 ms per tile (cached after first hit) | ✅ Worker |
| Tile parse + bucket upload to GPU | Per tile | ~5–10 ms per tile | Main thread |

**Bottom line: a single merged GeoJSON source with 2 000 tracks is viable.** The initial `setData()` has a one-time ~0.5–1 s cost (all on the worker), but after that, rendering is efficient because only viewport tiles are computed, and each tile only contains simplified geometry appropriate for the current zoom.

### 8. `updateData()` — the incremental diff API

MapLibre also has `source.updateData(diff)` (`geojson_source_diff.ts`), which accepts `{ add, remove, update }` operations keyed by feature ID. This:
- Patches the in-memory feature map on both main thread and worker.
- Only invalidates tiles that intersect the bounding box of changed features.
- Avoids the full `setData()` re-tiling cost.

**This is highly relevant for Strategy B**: when a single track is edited (vertex moved, point added), we can use `updateData()` instead of `setData()` to patch just that one feature in the merged source, invalidating only the affected tiles. Cost: ~1 ms vs ~500 ms for a full rebuild.

Requirements: features must have unique `id` values (or use `promoteId`). Our tracks already have `t.id`.

---

## E2E strategies to avoid overloading MapLibre

### Strategy A — Merge all tracks into a single shared GeoJSON source

**Approach**: Maintain one `geojson` source (`tracks-all`) with one `line` layer and one `circle` layer. Each Feature carries `properties.trackId`, `properties.color`, etc. Line color and width are driven by data-driven expressions.

**Pros**:
- Drastic reduction: 1 source + 2 layers regardless of track count.
- MapLibre handles data-driven styling efficiently; works with `global-state` expressions for active/editing highlights.

**Cons**:
- Every track mutation (add point, move vertex, delete) must rebuild or patch the entire FeatureCollection and call `setData()` — O(total features) on each edit.
- Lose per-source granularity: can't `setData()` on just the changed track.

**Verdict**: ⚠️ Good for display, but editing a single track triggers a full geometry re-serialise. This is the standard "simple merge" approach.

---

### Strategy B — Two-tier rendering: merged source for display + per-track source only for the active/edited track

**Approach**: A merged GeoJSON source renders all tracks as thin lines (no circle layer). When a track is selected or edited, **only that track** gets promoted to its own per-track source with full vertex circles, highlights, insertion preview etc. The merged source filters out the promoted track to avoid double-drawing.

**Pros**:
- Best of both worlds: O(1) layers for the bulk view, full editing fidelity for the one active track.
- The editing path doesn't change much — it already operates on a single track's source.
- Only mid-point circles for 1 active track → circle layer stays cheap.
- **Zoom-dependent simplification is free** — `geojson-vt` inside the merged source automatically simplifies tracks at low zoom (see deep dive §5). A 10 000-point track shows ~50 points at zoom 5. No need for a manual low-res/high-res swap.
- **Incremental edits via `updateData()`** — when the active track is modified, we can use `source.updateData({ update: [{ id: trackId, newGeometry: ... }] })` to patch just that feature in the merged source. Only tiles overlapping the track's bbox are regenerated. Cost: ~1 ms vs ~500 ms for a full `setData()` rebuild.

**Cons**:
- Promoting/demoting a track requires updating both the merged source and the per-track source atomically — slightly more coordination.
- Initial `setData()` for 2 000 tracks has a one-time ~0.5–1 s cost (but it runs in the worker, so the UI stays responsive — see deep dive §7).
- Features need unique `id` values for `updateData()` to work. Our tracks already have `t.id`.

**Verdict**: ✅ **Recommended as the primary MapLibre strategy.** This is the proven pattern used by Strava, GPX Studio, etc. for bulk track display.

---

### Strategy C — Viewport-aware lazy rendering (only draw visible tracks)

**Approach**: Maintain a spatial index (R-tree) of track bounding boxes. On `moveend` / `zoomend`, query the index for tracks whose bbox intersects the viewport. Only those tracks exist as MapLibre sources/layers. Tracks outside the viewport are removed from the map.

**Pros**:
- Hard cap on active source/layer count ≈ number of tracks visible on screen.
- Memory scales with viewport, not dataset size.

**Cons**:
- Complex lifecycle management: must add/remove sources on every map move.
- Adds/removes during pan cause flicker unless pre-buffered.
- Not needed if Strategy B already reduces to 1–3 sources.

**Verdict**: ⛔ Over-engineered when combined with Strategy B. Could revisit if track count reaches 10 000+.

---

### Strategy D — Replace GeoJSON sources with a single vector tile source (client-side tiling)

**Approach**: Use `geojson-vt` (or MapLibre's built-in GeoJSON tiling at source creation time) to tile the merged FeatureCollection. MapLibre only renders tiles in the viewport.

**Pros**:
- Built-in in MapLibre (`geojson` sources already use `geojson-vt` internally) — just set `{ type: 'geojson', data: ..., generateId: true }` and it tiles automatically.
- Viewport-efficient rendering without manual R-tree.

**Cons**:
- This is actually what Strategy B already uses under the hood — MapLibre's GeoJSON source *is* `@maplibre/geojson-vt`.
- The worker `GeoJSONWorkerSource.loadData()` calls `geojsonvt(data, params.geojsonVtOptions)` → builds the tile index. `loadVectorTile()` calls `this._geoJSONIndex.getTile(z, x, y)` to serve tiles on demand.
- Incremental updates are possible via `updateData()` (diff API) — see deep dive §8.

**Verdict**: ℹ️ Not a separate strategy — it's the internal mechanism of A and B. No extra work needed. The important thing is that this gives us **automatic zoom-dependent simplification and viewport-clipping** for free, which directly answers the question about high-point-count tracks at low zoom.

---

### Strategy E — WebGL custom layer / deck.gl overlay

**Approach**: Bypass MapLibre's layer system entirely. Render all track lines via a custom WebGL layer or `deck.gl`'s PathLayer with GPU instancing.

**Pros**:
- Can render 100 000+ line segments at 60 fps.
- Decoupled from MapLibre's layer limits.

**Cons**:
- Huge engineering effort; loses MapLibre style expressions, hit testing, global-state reactivity.
- Editing interaction must be reimplemented from scratch.
- Massive dependency addition.

**Verdict**: ⛔ Nuclear option. Not justified for the 1 000–5 000 file range.

---

## Recommended plan

**Strategy B** is the primary change. The remaining bottlenecks are addressed with targeted fixes:

### Phase 1 — Merged display source (MapLibre layer reduction)

1. **Create a single `tracks-merged` GeoJSON source** with one `line` layer.
   - All tracks' LineString features are stored in one FeatureCollection.
   - Color driven by `['get', 'color']` property per feature.
   - Width: `['case', ['==', ['get', 'trackId'], ['global-state', 'activeTrackId']], 5, 2]`.
   - **No circle layer** on the merged source — vertices only shown for the active track.

2. **Active track promotion**: when `setActiveTrack(id)` is called:
   - Add a per-track source + line + circle layers (current `addTrackToMap` logic, mostly unchanged).
   - Filter the active track out of the merged source via `['!=', ['get', 'trackId'], activeTrackId]`.

3. **Active track demotion**: when switching away:
   - Remove per-track source/layers.
   - Re-include the track in the merged source.

4. **Batch `setData()`**: new helper `rebuildMergedSource()` called once after import batch, not per-track.

5. **Use `updateData()` for single-track edits**: when a vertex is moved/added/deleted on the active track, call `source.updateData({ update: [{ id: trackId, newGeometry: updatedLineString }] })` to patch only that feature. Requires assigning `feature.id = track.id` on each Feature in the merged source.

6. **Use `updateData()` for promote/demote**: when switching active track, use `updateData({ remove: [oldId], add: [newFeature] })` rather than rebuilding the entire FeatureCollection.

### Phase 2 — Import pipeline optimisations

7. **Remove per-track `fitToTrack()`** during batch import. Replace with a single `fitBounds(combinedBbox)` at the end of `importFileContent` / `onFileBatchImported`.

8. **Defer elevation enrichment**: don't call `enrichElevation()` in `createTrack()` during bulk import. Instead, enqueue and process in idle callbacks (`requestIdleCallback`) or in small batches (50 tracks per frame).

9. **Defer tree rendering**: during import, suppress `renderGpxTree()`. After the batch completes, call it once.

### Phase 3 — Tree virtualisation

10. **Virtual scroll for the workspace tree**: only render DOM rows for the visible portion of the tree (≈30–50 rows). Use a fixed-height row assumption (28px) and translate a single container. This eliminates the O(n) DOM rebuild.

11. **Debounce / coalesce `renderGpxTree()`**: collapse multiple rapid calls (e.g. during import) into one `requestAnimationFrame`.

### Phase 4 — Persistence scaling

12. **Move track storage from localStorage to IndexedDB** (via `idb-keyval` or raw IDB). This removes the ~5 MB quota limit and avoids synchronous JSON serialization on the main thread.

13. **Incremental saves**: only write changed tracks, not the full array. Key tracks by `id` in an object store.

14. **Compress coords** (optional): store coords as a delta-encoded Float32Array blob instead of JSON arrays. ~4× size reduction.

### Phase 5 — Stats & enrichment throttling

15. **Lazy stats computation**: compute `trackStats()` only when a track's stats are actually displayed (on-screen in the tree or in the profile). Use the existing `_statsCache` pattern but don't eagerly compute during DEM reload.

16. **Throttle DEM re-enrichment**: on `data` events, batch all tracks but process them in chunks of 20 per `requestIdleCallback`, not all at once.

---

## Implementation priority & effort

| Phase | Effort | Impact |
|---|---|---|
| **Phase 1** (merged source) | Medium (1–2 days) | Eliminates the primary MapLibre bottleneck |
| **Phase 2** (import pipeline) | Small (0.5 day) | Removes import-time jank for large batches |
| **Phase 3** (tree virtualisation) | Medium (1 day) | Eliminates DOM bottleneck |
| **Phase 4** (IndexedDB) | Medium (1 day) | Removes persistence limit |
| **Phase 5** (stats/enrichment) | Small (0.5 day) | Reduces background CPU usage |

**Phases 1 + 2 together give the biggest bang for the buck** and should be implemented first. Phase 3 is important for UI responsiveness once tracks are loaded. Phase 4 is needed for persistence correctness (localStorage will simply fail at ~5 MB). Phase 5 is polish.

---

## Test strategy

- **Unit tests**: merged-source geometry builder; batch import without `fitToTrack`; IndexedDB round-trip.
- **E2E (Playwright)**: import a fixture folder of 200 small GPX files → assert map has ≤5 sources, panel scrolls, active track shows vertices.
- **Performance smoke test**: import 1 000 GPX files (generated fixture), measure time-to-interactive; assert < 10 s on CI hardware.
- **Regression**: all existing e2e tests must pass (they operate on 1–5 tracks and are unaffected by the merged source, since the active track still gets its own layers).

---

## FAQ — Answers to specific design questions

### Q: Tracks have many points which is useless at low zoom. Should we swap a low-res GeoJSON for full-res ones when zooming in?

**No. `geojson-vt` handles this automatically.** During the one-time `convert()` step, Douglas-Peucker runs on every LineString and tags each point with its visual importance (squared distance from the simplified baseline). When a tile is built for a given zoom, only points exceeding that zoom's tolerance threshold are emitted:

```
zoom  5 → tolerance ≈ 4.7e-8  → a 10 000-pt track renders ~50 pts
zoom 10 → tolerance ≈ 1.5e-9  → same track renders ~500 pts
zoom 15 → tolerance ≈ 4.7e-11 → same track renders ~5 000 pts
zoom 18 → tolerance = 0       → all 10 000 pts rendered
```

This happens transparently inside the GeoJSON source worker. No application-level low-res/high-res swap is needed.

### Q: If there is one huge GeoJSON, is MapLibre smart enough to optimize it?

**Yes, in several ways:**

1. **Tiling**: the full FeatureCollection is sliced into a tile quadtree. Only tiles covering the current viewport are requested from the worker and uploaded to the GPU.
2. **Zoom-dependent simplification**: each tile only contains the points appropriate for its zoom level (see above).
3. **Lazy drilling**: tiles below `indexMaxZoom` (z=5) are computed on demand and cached — panning into a new area generates only the needed tiles.
4. **LRU tile cache**: tiles that scroll out of view are kept in an LRU cache (`TileCache`) so panning back is instant.
5. **Worker-based**: all convert/simplify/clip/tile work runs in a Web Worker — the main thread stays responsive.

The one cost that is *not* optimized away is `setData()`: calling it with a new FeatureCollection re-runs the full `convert()` + `splitTile()` pipeline (~0.5–1 s for 2M points). This is why we use `updateData()` (diff API) for edits to a single track.

### Q: Does Strategy B already address the points-at-low-zoom concern?

**Yes.** Strategy B puts all tracks into a single merged GeoJSON source. That source is backed by `geojson-vt`, which provides all the optimizations listed above. At low zoom:
- Only a fraction of each track's points are rendered.
- Only tiles in the viewport are computed.
- Tracks entirely outside the viewport contribute zero rendering cost.

The only additional consideration is **line rendering cost**: even simplified, 2 000 tracks showing on screen at zoom 5 means 2 000 features per tile. This is well within MapLibre's capability (vector tile servers routinely serve tiles with 10 000+ features). The merged source's line layer renders them in a single draw call with data-driven color.

### Q: Source code references (for verification)

| File | Role |
|---|---|
| `maplibre-gl-js/src/source/geojson_source.ts` | Main-thread GeoJSON source; `setData()`, `updateData()` |
| `maplibre-gl-js/src/source/geojson_worker_source.ts` | Worker; calls `geojsonvt()`, serves `getTile()` |
| `maplibre-gl-js/src/source/geojson_source_diff.ts` | Diff API: `applySourceDiff()`, `mergeSourceDiffs()` |
| `@maplibre/geojson-vt/src/index.ts` | Tile index: `splitTile()`, `getTile()`, `invalidateTiles()` |
| `@maplibre/geojson-vt/src/convert.ts` | Mercator projection + Douglas-Peucker simplify |
| `@maplibre/geojson-vt/src/tile.ts` | `createTile()`: zoom-dependent point filtering |
| `@maplibre/geojson-vt/src/simplify.ts` | Douglas-Peucker with importance tagging |
| `@maplibre/geojson-vt/src/clip.ts` | Sutherland-Hodgman tile clipping |
| `maplibre-gl-js/src/tile/tile_manager.ts` | Viewport tile lifecycle, LRU cache |
| `maplibre-gl-js/src/tile/tile_cache.ts` | LRU cache implementation |
