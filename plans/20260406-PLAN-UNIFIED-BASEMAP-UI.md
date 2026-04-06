# Plan: Unified Basemap Selection UI (Online + Local Tile Sources)

**Date**: 2026-04-06
**Status**: Draft
**Prerequisite**: Dynamic tile source management (MBTiles/PMTiles) — completed in `65b84b9`

## Problem Statement

Currently, basemaps and overlays are defined statically in `layer-registry.js` (`LAYER_CATALOG`). In desktop mode, users can now register local `.mbtiles` and `.pmtiles` files via `addTileSource`, but there is no UI to:

1. Browse and register local tile files as map sources
2. Use local tile sources as basemaps or overlays
3. Combine online and local basemaps (e.g. local topo + online satellite)
4. Stack multiple basemaps (the current model is single-basemap-at-a-time)

## Design Goals

- **Unified catalog**: online and local sources appear in the same list
- **Multi-basemap**: allow stacking 2+ basemaps with independent opacity
- **Web+Desktop**: the UI works in both modes; file picking is desktop-only
- **Discoverable**: local tile files are auto-detected when a folder is mapped
- **Persistent**: user's source configuration survives app restarts
- **Non-breaking**: existing single-basemap behavior is the default

## Architecture

### Current State

```
layer-registry.js  →  LAYER_CATALOG (static array)
                       ├── basemaps (single active, <select> dropdown)
                       └── overlays (multi-select checkboxes)

layer-engine.js    →  setBasemap(map, state, id)
                       └── hides all basemap layers, shows selected one
                       setOverlay(map, state, id, visible)
                       └── toggles individual overlay visibility
```

### Target State

```
layer-registry.js  →  LAYER_CATALOG (static, built-in entries)
                       +
                       userSources (dynamic, from addTileSource / folder scan)
                       =
                       mergedCatalog (union, exposed via same API)

layer-engine.js    →  setBasemapStack(map, state, [id1, id2, ...])
                       └── shows all in stack with independent opacity
                       setOverlay (unchanged)

state.js           →  basemap: 'osm'           →  basemapStack: ['osm']
                       basemapOpacity: 1        →  basemapOpacities: { osm: 1 }
```

## Implementation Phases

### Phase 1: Extend Catalog to Support User Sources (JS only)

**Files**: `layer-registry.js`

1. Add a mutable `_userSources` array alongside `LAYER_CATALOG`
2. Add `registerUserSource(entry)` / `unregisterUserSource(id)` functions
3. Modify `getCatalogEntry`, `getBasemaps`, `getOverlays` to merge both lists
4. User source entries have the same `CatalogEntry` shape, with an extra `userDefined: true` flag and `localPath` for desktop sources
5. Auto-generate catalog entries from `TileSourceEntry` objects returned by `listTileSources()`:
   - **MBTiles raster**: `type: 'raster'`, tiles URL = `http://127.0.0.1:14321/tiles/{name}/{z}/{x}/{y}.{ext}`
   - **PMTiles**: same pattern, once PMTiles serving is implemented
   - **Extension detection**: inspect MBTiles metadata table for `format` (png/jpg/pbf) to determine raster vs vector
   - **Default category**: `basemap` (user can change later)

**Tests**: Unit tests in `tests/unit/layer-engine.test.mjs` for register/unregister, merged catalog lookups

### Phase 2: Multi-Basemap State Model

**Files**: `state.js`, `layer-engine.js`, `main.js`, `persist.js`

1. **State migration**: `basemap` (string) → `basemapStack` (string[]), `basemapOpacity` (number) → `basemapOpacities` ({[id]: number}). Keep `basemap` as a computed getter pointing to `basemapStack[0]` for backward compat.
2. **`setBasemapStack(map, state, ids)`**: shows all basemaps in the stack (bottom-to-top z-order), hides all others. Each layer gets its own opacity from `basemapOpacities`.
3. **Migration path**: `loadSettings` detects old `basemap` string and converts to `basemapStack: [basemap]`.
4. **URL hash**: encode stack as `basemap=osm,local-topo` (comma-separated).

**Tests**: Unit tests for state migration, stack application, opacity isolation

### Phase 3: Desktop Tile Source Discovery

**Files**: `tauri-bridge.js`, `main.js`, Rust `main.rs`

1. **Folder scanning**: When user picks a GPX folder (or a dedicated "Map tiles" folder), scan for `*.mbtiles` and `*.pmtiles` files
2. **Rust command**: `scan_tile_folder(path)` → returns `Vec<TileSourceEntry>` for all tile files found
3. **Auto-register**: On folder scan, call `addTileSource` for each found file, then `registerUserSource` in JS
4. **MBTiles metadata**: Read `metadata` table to extract name, format, bounds, min/max zoom — expose via `get_tile_source_info(name)` command
5. **Persistence**: Save user source config to a JSON file in the app data directory (`~/.slope-desktop/sources.json` or Tauri's `appDataDir`)

**Tests**: Rust unit tests for folder scanning, metadata parsing

### Phase 4: UI — Basemap Stack Panel

**Files**: `app/js/main.js` (UI wiring), `app/index.html` (markup), `app/css/main.css` (styles)

Replace the current `<select id="basemap">` with a richer panel:

```
┌─── Basemap Stack ────────────────────────────┐
│ ☐ SwissTopo raster    [opacity ━━━━━━━━━] ✕  │
│ ☐ Local DEM hillshade  [opacity ━━━━━━━━━] ✕  │
│                                               │
│ [+ Add basemap ▼]                             │
│   ├── Online                                  │
│   │   ├── OpenStreetMap                       │
│   │   ├── OpenTopoMap                         │
│   │   ├── IGN plan (FR)                       │
│   │   └── ...                                 │
│   └── Local files                             │
│       ├── alps-topo.mbtiles                   │
│       ├── satellite.pmtiles                   │
│       └── [Browse for file...]  (desktop only)│
└───────────────────────────────────────────────┘
```

**UI behavior**:
- Each row in the stack has: checkbox (visibility), label, opacity slider, remove button
- Drag to reorder (same pattern as existing layer-order panel)
- "Add basemap" dropdown groups by online vs local
- "Browse for file..." opens native file picker (Tauri dialog), auto-registers the source
- Single-click on a row makes it the "primary" (for URL hash backward compat)
- Backward compat: if only one basemap in stack, UI collapses to a simple dropdown

**Detailed sub-steps**:
1. Add `<div id="basemap-stack-panel">` in `index.html` settings section
2. Implement `renderBasemapStack(state)` to create stack rows from `state.basemapStack`
3. Wire opacity sliders to `state.basemapOpacities[id]` → `setScaledNativeOpacityForLayer`
4. Wire "Add" dropdown from `getBasemaps()` (merged catalog)
5. Wire drag-reorder using same DnD pattern as `renderLayerOrderPanel`
6. Wire "Browse" button to `dialog.open({ filters: [{ name: 'Tiles', extensions: ['mbtiles', 'pmtiles'] }] })`
7. Keep existing `<select id="basemap">` as a hidden fallback for `test_mode`

**Tests**: Playwright e2e test: add basemap to stack, verify layer count changes, opacity slider works

### Phase 5: PMTiles Serving Implementation

**Files**: `src-tauri/Cargo.toml`, `src-tauri/src/tile_server.rs`

1. Add `pmtiles` crate dependency
2. Implement `resolve_pmtiles_request`: open PMTiles archive, read tile by z/x/y
3. Cache open PMTiles readers (one per source, lazy-opened)
4. Detect tile format from PMTiles header (png/jpg/webp/pbf)
5. Replace the current 501 stub with real implementation

**Tests**: Rust unit tests with a test PMTiles fixture

## Migration & Backward Compatibility

| Area | Current | New | Migration |
|------|---------|-----|-----------|
| State key | `basemap: 'osm'` | `basemapStack: ['osm']` | Auto-upgrade in `loadSettings` |
| URL hash | `basemap=osm` | `basemap=osm,local-topo` | Comma-split; single value = array of 1 |
| UI | `<select>` dropdown | Stack panel | Collapse to dropdown when stack.length ≤ 1 |
| API | `setBasemap(map, st, id)` | `setBasemapStack(map, st, [ids])` | Keep `setBasemap` as wrapper |
| Catalog | `LAYER_CATALOG` only | Merged static + user | Same `getCatalogEntry` API |

## Risks & Mitigations

- **Performance**: Multiple raster basemaps = more tile requests. Mitigate: warn user when stack > 3, lazy-load tiles.
- **z-order conflicts**: Overlays and basemaps share the same layer stack. Mitigate: basemaps always below `dem-loader`, overlays above. Use existing `applyLayerOrder`.
- **PMTiles crate maturity**: The `pmtiles` Rust crate may have API changes. Mitigate: pin version, wrap in a thin adapter.
- **Large MBTiles files**: Opening a multi-GB MBTiles could be slow. Mitigate: use SQLite read-only mode with shared cache, lazy connection.

## Effort Estimate

| Phase | Effort | Priority |
|-------|--------|----------|
| 1: Extend catalog | 2-3h | High (enables everything else) |
| 2: Multi-basemap state | 3-4h | High |
| 3: Desktop discovery | 2-3h | Medium (desktop-only) |
| 4: UI panel | 4-6h | High (main user-facing change) |
| 5: PMTiles serving | 2-3h | Medium (extends format support) |
| **Total** | **13-19h** | |

## Open Questions

1. Should local tile sources persist across sessions automatically, or require explicit "save configuration"?
   → **Recommendation**: Auto-persist in `~/.slope-desktop/sources.json`, loaded on startup.

2. Should the user be able to set a local source as overlay vs basemap?
   → **Recommendation**: Yes, via a toggle in the UI. Default to basemap for raster, overlay for vector.

3. Should we support remote PMTiles URLs (HTTP range requests)?
   → **Recommendation**: Defer to a later phase. Desktop mode focuses on local files; web mode can use protomaps CDN directly.

4. Should we read MBTiles `metadata.bounds` to auto-set the region/defaultView?
   → **Recommendation**: Yes, in Phase 3. Parse the bounds from metadata and use for fly-to behavior.
