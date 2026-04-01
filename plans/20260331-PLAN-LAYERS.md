# Layer Architecture Refactoring Plan

## Problem Statement

Layer definitions are scattered across multiple files:
- **`main.js`**: source definitions (inline in style object), layer definitions (inline), event listeners for overlay toggles
- **`constants.js`**: `BASEMAP_LAYER_GROUPS`, `BASEMAP_DEFAULT_VIEW`, `OPENSKIMAP_LAYER_IDS`, `SWISSTOPO_SKI_LAYER_IDS`, `IGN_SKI_LAYER_IDS`, `ALL_BASEMAP_LAYER_IDS`
- **`state.js`**: boolean toggles per overlay (`showOpenSkiMap`, `showSwisstopoSki`, `showIgnSlopes`)
- **`persist.js`**: settings key list for persistence
- **`ui.js`**: `applyXxxOverlay()` functions, `applyBasemapSelection()`
- **`index.html`**: `<select>` options for basemaps, `<input>` checkboxes for overlays

Adding a new layer requires touching **6 files** and ~10 code locations. This doesn't scale, especially toward user-built composite maps.

## Proposed Design

### 1. Declarative Layer Registry (`js/layer-registry.js`)

A single array-of-objects describing every available layer source + map layers + UI metadata:

```js
export const LAYER_CATALOG = [
  {
    id: 'osm',
    label: 'OSM',
    category: 'basemap',         // 'basemap' | 'overlay'
    region: null,                // null = global, or bounding box [w,s,e,n]
    defaultView: null,           // {center, zoom, bounds} — fly-to when selected
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256, maxzoom: 19,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      { id: 'basemap-osm', type: 'raster', source: 'osm',
        paint: { 'raster-opacity': ['basemapOpacity', 1] } }
    ]
  },
  {
    id: 'swisstopo-ski',
    label: 'SwissTopo ski routes (CH)',
    category: 'overlay',
    region: [5.9, 45.8, 10.5, 47.8],
    sources: { /* ... */ },
    layers: [ /* ... */ ]
  },
  // ...
];
```

### 2. Basemap / Overlay Engine (`js/layer-engine.js`)

Functions that consume the registry:

- **`buildStyleFromCatalog(catalog, defaults)`** — generates the MapLibre style `sources` and `layers` arrays at init time
- **`setBasemap(map, state, id)`** — toggles visibility of basemap layer groups, with fly-to logic
- **`setOverlay(map, state, id, visible)`** — toggles overlay visibility
- **`getActiveOverlayIds(state)`** — returns list of active overlays
- **`getAvailableBasemaps()` / `getAvailableOverlays()`** — for dynamic UI generation

### 3. Dynamic UI Generation

Instead of hard-coded `<option>` and `<input>` tags:

```js
function renderBasemapSelect(catalog) {
  const sel = document.getElementById('basemap');
  sel.innerHTML = '';
  for (const entry of catalog.filter(e => e.category === 'basemap')) {
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = entry.label;
    sel.appendChild(opt);
  }
}

function renderOverlayCheckboxes(catalog) {
  const container = document.getElementById('overlay-list');
  container.innerHTML = '';
  for (const entry of catalog.filter(e => e.category === 'overlay')) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = `overlay-${entry.id}`;
    cb.addEventListener('change', () => { /* setOverlay(...) */ });
    label.append(cb, ` ${entry.label}`);
    container.appendChild(label);
  }
}
```

Note: the overlays should be in a dropdown (still with checkboxes) to save space

### 4. Bookmark System (Layer Presets)

Locally-persisted bookmarks that capture the current layer configuration for quick recall.

**Storage format**: Option A — `{basemap, overlays[], layerOrder[], layerSettings{}}` per bookmark.

**Auto-generated names**: Format is `"<BasemapLabel> + <OverlayLabel> [+ N others]"`.
- 0 overlays → `"SwissTopo raster"`
- 1 overlay → `"SwissTopo raster + ski routes (CH)"`
- 2+ overlays → `"SwissTopo raster + ski routes (CH) + 1 other"` / `"… + 2 others"`

**Bookmark shape**:
```js
{
  id: crypto.randomUUID(),
  name: '<auto or user-edited>',
  basemap: 'swisstopo-raster',
  overlays: ['swisstopo-ski', 'contours'],
  layerOrder: ['swisstopo-ski', 'contours'],      // z-order bottom→top
  layerSettings: {                                  // per-overlay overrides
    'swisstopo-ski': { opacity: 0.9, blend: 'normal' }
  }
}
```

**UI**: A dropdown/list below the overlay checkboxes:
- ⭐ **Save** button → saves current config, auto-names it, opens inline rename
- List of saved bookmarks → click to apply, kebab menu for rename/delete
- Active bookmark is highlighted

### 5. Layer Order Panel

A **separate panel** ("Layer order") that controls z-order, per-layer opacity, and blend mode — independent from the layer *selection* panel.

**Behavior**:
- Lists only currently-active layers (basemap + active overlays)
- Each row: drag handle, layer label, opacity slider, blend-mode toggle
- Drag-and-drop reorders layers on the map in real time (`map.moveLayer()`)
- Order is persisted and saved into bookmarks

**UI**: Opened via a new panel-toggle button (🗂 Layers) in `#panel-toggles`.

**Implementation**:
- `state.layerOrder` — array of catalog IDs, bottom→top
- `state.layerSettings` — `{ [catalogId]: { opacity, blend } }`
- `layer-engine.js` owns `applyLayerOrder(map, state)` and `applyLayerSettings(map, state, catalogId)`
- Drag-and-drop uses pointer events (no library dependency)

Note: each layer can have an opacity and blend-mode

### 6. Persistence

Instead of per-overlay boolean keys (`showOpenSkiMap`, `showSwisstopoSki`, ...):

```js
// persisted settings shape:
{
  basemap: 'osm',
  activeOverlays: ['contours', 'swisstopo-ski'],
  layerOrder: ['contours', 'swisstopo-ski'],        // z-order
  layerSettings: { 'swisstopo-ski': { opacity: 0.9 } },
  bookmarks: [
    { id: '...', name: 'Ski CH', basemap: 'swisstopo-raster',
      overlays: ['swisstopo-ski'], layerOrder: ['swisstopo-ski'],
      layerSettings: {} },
  ]
}
```

Backward-compat: on load, if old boolean keys exist, migrate them to `activeOverlays`.

### 7. Migration Path

1. Create `layer-registry.js` with current layers expressed declaratively
2. Create `layer-engine.js` with build/toggle/order/bookmark functions
3. Refactor `main.js` to use `buildStyleFromCatalog()` instead of inline style
4. Refactor `ui.js` to use engine functions instead of per-overlay apply functions
5. Generate HTML UI dynamically (basemap select, overlay dropdown, bookmark list)
6. Add Layer Order panel with drag-and-drop, opacity, blend
7. Migrate persistence to new shape (with backward-compat reader)
8. Wire bookmark save/load/rename/delete UI

Steps 1-4 are purely mechanical refactoring; the existing behavior is preserved. Steps 5-8 add new functionality.

### Files Affected

| Current file | After refactoring |
|---|---|
| `main.js` (sources, layers, listeners) | `layer-registry.js` (data) + `layer-engine.js` (logic) + `main.js` (init call only) |
| `constants.js` (layer group arrays) | `layer-registry.js` |
| `state.js` (per-overlay booleans) | `state.js` (`activeOverlays`, `layerOrder`, `layerSettings`, `bookmarks`) |
| `persist.js` (key list) | `persist.js` (reads new shape, migrates old booleans) |
| `ui.js` (per-overlay apply functions) | `layer-engine.js` |
| `index.html` (hardcoded options/checkboxes) | dynamic DOM + layer-order panel + bookmark UI |

### Estimated Complexity

- Registry + engine: ~350 lines of new code
- Layer-order panel + bookmark UI: ~200 lines
- main.js simplification: removes ~250 lines of inline style
- Net effect: ~300 more LOC but single-point-of-entry for layers, reordering, and presets
