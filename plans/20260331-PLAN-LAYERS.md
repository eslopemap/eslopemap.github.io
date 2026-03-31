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

Note: the overalays should be in a dropdown (still with checkboxes) to save space

### 4. User-Built Composite Maps

**Decision Point 1: Storage format**
- Option A: Store active basemap + list of overlay IDs in a "map preset" (`{basemap: 'swisstopo-raster', overlays: ['swisstopo-ski', 'contours']}`)
- Option B: Full serializable style-spec subset
- **Recommendation**: Option A — simple, forward-compatible, and the catalog provides the full style data

**Decision Point 2: UI for composite maps**
- Option A: Named presets with save/load (like browser bookmarks)
- Option B: A builder panel with drag-and-drop layer ordering
- **Recommendation**: Start with Option A (save/load named presets), evolve to B later

**Decision Point 3: Layer ordering**
- Currently basemap layers are moved below `dem-loader` at runtime
- For composites, user may want overlay Z-order control
- **Recommendation**: The catalog entry order defines default Z-order. Presets can optionally store explicit ordering.

Note: each map can have an opacity and blend-mode

### 5. Persistence

Instead of per-overlay boolean keys (`showOpenSkiMap`, `showSwisstopoSki`, ...):

```js
// persisted settings shape:
{
  basemap: 'osm',
  activeOverlays: ['contours', 'swisstopo-ski'],
  mapPresets: [
    { name: 'Ski CH', basemap: 'swisstopo-raster', overlays: ['swisstopo-ski'] },
    { name: 'Rando FR', basemap: 'ign-topo', overlays: ['ign-slopes', 'contours'] }
  ]
}
```

### 6. Migration Path

1. Create `layer-registry.js` with current layers expressed declaratively
2. Create `layer-engine.js` with build/toggle functions
3. Refactor `main.js` to use `buildStyleFromCatalog()` instead of inline style
4. Refactor `ui.js` to use engine functions instead of per-overlay apply functions
5. Generate HTML UI dynamically
6. Migrate persistence to `activeOverlays` array (with backward-compat reader)
7. Add preset save/load UI

Steps 1-4 are purely mechanical refactoring; the existing behavior is preserved. Steps 5-7 add new functionality.

### Files Affected

| Current file | After refactoring |
|---|---|
| `main.js` (sources, layers, listeners) | `layer-registry.js` (data) + `layer-engine.js` (logic) + `main.js` (init call only) |
| `constants.js` (layer group arrays) | `layer-registry.js` |
| `state.js` (per-overlay booleans) | `state.js` (single `activeOverlays` array) |
| `persist.js` (key list) | `persist.js` (reads `activeOverlays`) |
| `ui.js` (per-overlay apply functions) | `layer-engine.js` |
| `index.html` (hardcoded options/checkboxes) | dynamic DOM |

### Estimated Complexity

- Registry + engine: ~200 lines of new code
- main.js simplification: removes ~200 lines of inline style
- Net effect: similar LOC but single-point-of-entry for layers
