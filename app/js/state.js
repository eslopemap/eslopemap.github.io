// Reactive state store using Proxy.
//
// Side effects (repaint, URL sync, UI updates) are driven from a single
// onChange dispatcher instead of being scattered after every `state.foo = …`.

export function createStore(initial, onChange) {
  return new Proxy({...initial}, {
    set(target, key, value) {
      const old = target[key];
      target[key] = value;
      if (old !== value && onChange) onChange(key, value, old);
      return true;
    }
  });
}

export const STATE_DEFAULTS = {
  mode: 'slope+relief',
  basemapStack: ['osm'],     // ordered list of active basemaps (bottom→top)
  basemapOpacity: 1,         // global basemap opacity (legacy single-basemap)
  basemapOpacities: {},      // per-basemap opacity overrides: { [id]: number }
  showHillshade: true,
  hillshadeOpacity: 0.10,
  hillshadeMethod: 'igor',
  slopeOpacity: 0.45,
  showContours: true,
  activeOverlays: [],       // catalog IDs of active overlays
  layerOrder: [],            // z-order of active overlays, bottom→top
  layerSettings: {},         // { [catalogId]: { opacity?, blend? } }
  bookmarks: [],             // saved layer presets
  showTileGrid: false,
  cursorInfoMode: 'cursor',
  multiplyBlend: true,
  terrain3d: false,
  terrainExaggeration: 1.4,
  pauseThreshold: 5,  // minutes
  profileSmoothing: 20,  // moving-average half-window radius (0 = off)
  mapPixelRatio: 0,
};

export const STATE_TEST_MODE = {
  basemapStack: [],
  mode: '',
  showHillshade: false,
  showContours: false,
  activeOverlays: [],
  layerOrder: [],
  terrain3d: false,
  hillshadeOpacity: 0,
};

// ---- Workspace tree UI state (not persisted in settings) ----

export const TREE_STATE_DEFAULTS = {
  selectedNodeIds: [],
  contextMenuState: null,    // { nodeId, x, y } or null
  infoEditorState: null,     // { nodeId } or null
  expandedNodeIds: new Set(),
  activeActionContext: null,  // future — for action dispatch
};
