# Plan: Unified Basemap Selection UI (Online + Local Tile Sources)

**Date**: 2026-04-06 (updated 2026-04-07)
**Status**: In progress — Phase 1 ✅, Phase 5 ✅
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

## Key Design Decisions

### Basemap vs Overlay: A Fluid Distinction

Sources are not fundamentally basemaps or overlays — any raster or vector tile source could be used as either. The distinction is about **rendering defaults and position in the layer stack**:

| Trait | Basemap default | Overlay default |
|---|---|---|
| Stack position | Below analysis layers | Above analysis layers |
| Default opacity | 1.0 (opaque) | Variable (e.g. 0.5) |
| Default blend mode | Normal | Multiply (for raster overlays) |
| Typical use | Background map context | Additional data layer |
| On-click behaviour | Radio button (only one active) | Checkbox (allow multiple) |

A source should carry a `preferredRole: 'basemap' | 'overlay'` hint that determines initial behavior, but users must be able to override this freely. By moving a source to overlay they allow multiple selection.

If there are no basemaps, a white layer is shown so 'multiply' blend works.

### UX Proposals for Source Role

**Proposal A — Unified Stack (Recommended)**

A single ordered list of all active map sources. Each row has:
- Drag handle for reorder
- Label
- Opacity slider
- Blend mode toggle (normal / multiply)
- Remove button

The "basemap" is simply the bottom-most raster source. No separate basemap/overlay sections — just a stack.

```
┌─── Map Sources ─────────────────────────────────┐
│ ≡  SwissTopo raster    [━━━━━━━━━] normal    ✕  │  ← bottom
│ ≡  Local hillshade     [━━━━━━━━━] multiply  ✕  │
│ ≡  IGN ortho overlay   [━━━━━━━━━] multiply  ✕  │  ← top
│                                                  │
│ [+ Add source ▼]                                 │
└──────────────────────────────────────────────────┘
```

**Pros**: Simple mental model, maximum flexibility, no forced categorization.
**Cons**: Users might not understand that order matters; need visual cue ("bottom = background").

**Proposal B — Two Sections with Cross-Move**

Keep separate Basemap and Overlay sections, but allow dragging sources between them (or a "Move to overlay/basemap" context action).

```
┌─── Basemaps ───────────────────────────────────┐
│ ☐ OpenStreetMap       [opacity ━━━━━━━━━]  ✕   │
│ ☐ Local topo          [opacity ━━━━━━━━━]  ✕   │
├─── Overlays ───────────────────────────────────┤
│ ☑ IGN ortho           [opacity ━━━━━] multiply │
│ ☑ Hiking trails       [opacity ━━━━━] multiply │
│                                                 │
│ [+ Add source ▼]                                │
└─────────────────────────────────────────────────┘
```

**Pros**: Familiar two-zone model; clear visual separation.
**Cons**: Arbitrary boundary; sources at the basemap/overlay boundary behave identically.

**Proposal C — Role Badge (Hybrid)**

Single list, but each source has a small badge (🅱️/🅾️) showing its role. Click the badge to toggle. Role affects default opacity and blend.

**Pros**: Single list simplicity, but role is still visible.
**Cons**: Extra UI element; badge meaning needs explanation.

**Current recommendation**: **Proposal A** (Unified Stack) — simplest mental model, most flexible. The `preferredRole` hint auto-sets initial opacity and blend when adding a source, but doesn't constrain where it can go.

### The `setStyle` Constraint (Vector Styles)

Only one source can use `map.setStyle(url)` at a time (e.g. SwissTopo Vector). This is a MapLibre limitation: `setStyle()` replaces the entire style, wiping all layers. See `reports/20260406-SWISSTOPO-VECTOR-SETSTYLE-REPORT.md`.

**Impact on the unified stack:**
- A source that requires `setStyle()` (i.e. has a `styleUrl` field) is a **"full-style source"**
- Only one full-style source can be active at a time
- If the user adds a second full-style source, the UI should warn: _"Activating this will replace {current}. Only one vector style can be active at a time."_
- Raster sources added on top of a full-style source work fine (they're added after rehydration)
- Implementation: `setBasemapStack` checks for `styleUrl` entries, shows confirmation dialog if conflict

**UI indicators:**
- Full-style sources get a small ⚡ icon and tooltip: "Vector style — replaces all other vector styles"
- The confirmation dialog offers: "Replace" / "Cancel"
- After replacement, the old full-style source is removed from the stack

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

### Phase 1: Extend Catalog to Support User Sources (JS only) ✅

**Status**: Completed

**Files**: `layer-registry.js`

1. ✅ Mutable `_userSources` array alongside `LAYER_CATALOG`
2. ✅ `registerUserSource(entry)` / `unregisterUserSource(id)` / `clearUserSources()` / `getUserSources()`
3. ✅ All lookup helpers merge built-in + user sources
4. ✅ `buildCatalogEntryFromTileSource` auto-generates catalog entries:
   - MBTiles → `tiles: [url/{z}/{x}/{y}.png]`
   - PMTiles → `url: pmtiles://host/pmtiles/{name}` (uses pmtiles JS protocol)
5. ✅ 11 unit tests + 4 e2e tests covering registration, rendering, and Range serving

**Note**: `preferredRole` field should be added to `CatalogEntry` in Phase 2 to support the fluid basemap/overlay distinction.

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
4. **MBTiles metadata**: Read `metadata` table to extract name, format, bounds, min/max zoom — expose via `get_tile_source_info(name)` command. Hooks into current mechanism to allow flying to an area covered by the mbtiles if needed.
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

### Phase 5: PMTiles Serving Implementation ✅

**Status**: Completed (HTTP Range approach)

**Files**: `src-tauri/src/tile_server.rs`, `app/js/pmtiles-protocol.js`, `deps.json`

Instead of server-side tile extraction (pmtiles Rust crate), we use **client-side extraction via HTTP Range requests** — same code path as remote PMTiles:

1. ✅ `/pmtiles/{source}` endpoint serves raw `.pmtiles` files with HTTP Range support
2. ✅ `pmtiles` 4.4.0 JS library vendored + `fflate` 0.8.2 (required dependency)
3. ✅ `pmtiles-protocol.js` registers `pmtiles://` protocol with MapLibre (lazy dynamic import)
4. ✅ CORS preflight for Range header access
5. ✅ 6 Rust unit tests + 2 e2e tests (PMTiles rendering + Range requests)

**Rationale**: Client-side extraction means the same JS `pmtiles` library works for both local and remote PMTiles. No Rust pmtiles crate needed.

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

2. ~~Should the user be able to set a local source as overlay vs basemap?~~
   → **Resolved**: Sources have a `preferredRole` hint but can be freely repositioned in the unified stack. See UX Proposal A above.

3. ~~Should we support remote PMTiles URLs (HTTP range requests)?~~
   → **Resolved**: The `pmtiles` JS library handles both local (via tile server Range endpoint) and remote PMTiles with the same code path.

4. Should we read MBTiles `metadata.bounds` to auto-set the region/defaultView?
   → **Recommendation**: Yes, in Phase 3. Parse the bounds from metadata and use for fly-to behavior.

5. How should the UI handle the `setStyle` mutual exclusion for vector styles?
   → **Recommendation**: Show a confirmation dialog when adding a second full-style source. See "The `setStyle` Constraint" section above.

6. Should the unified stack replace both the basemap `<select>` and the overlay panel?
   → **Recommendation**: Yes, eventually. In the transition, the `<select>` can remain as a compact single-basemap shortcut that maps to stack position 0.
