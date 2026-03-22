// Reactive state store using Proxy (FUTURE.md step 3).
//
// Side effects (repaint, URL sync, UI updates) are driven from a single
// onChange dispatcher instead of being scattered after every `state.foo = …`.

export function createStore(initial, onChange) {
  return new Proxy(initial, {
    set(target, key, value) {
      const old = target[key];
      target[key] = value;
      if (old !== value) onChange(key, value, old);
      return true;
    }
  });
}

export const STATE_DEFAULTS = {
  mode: 'slope+relief',
  basemap: 'osm',
  basemapOpacity: 1,
  hillshadeOpacity: 0.10,
  hillshadeMethod: 'igor',
  slopeOpacity: 0.45,
  effectiveSlopeOpacity: 0.45,
  showContours: true,
  showOpenSkiMap: false,
  showTileGrid: false,
  cursorInfoMode: 'cursor',
  multiplyBlend: true,
  terrain3d: false,
  terrainExaggeration: 1.4,
  internalCount: 0,
  fallbackCount: 0
};
