import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let applyLayerOpacity;
let setBasemap;

function createMapMock() {
  const layers = new Map([
    ['dem-loader', { id: 'dem-loader', type: 'hillshade', layout: { visibility: 'visible' }, paint: {} }],
    ['basemap-osm', { id: 'basemap-osm', type: 'raster', layout: { visibility: 'visible' }, paint: {} }],
  ]);
  const sources = new Map();
  const moveCalls = [];
  const paintCalls = [];
  const flyCalls = [];

  return {
    layers,
    sources,
    moveCalls,
    paintCalls,
    flyCalls,
    addLayer(layer, beforeId) {
      layers.set(layer.id, {
        ...layer,
        layout: { ...(layer.layout || {}) },
        paint: { ...(layer.paint || {}) },
      });
      if (beforeId) {
        moveCalls.push({ layerId: layer.id, beforeId, kind: 'add' });
      }
    },
    addSource(id, source) {
      sources.set(id, { ...source });
    },
    flyTo(options) {
      flyCalls.push(options);
    },
    getCenter() {
      return { lng: 8.23, lat: 46.82 };
    },
    getLayer(id) {
      return layers.get(id) || null;
    },
    getSource(id) {
      return sources.get(id) || null;
    },
    moveLayer(layerId, beforeId) {
      moveCalls.push({ layerId, beforeId, kind: 'move' });
    },
    setLayoutProperty(layerId, property, value) {
      const layer = layers.get(layerId);
      if (!layer) return;
      layer.layout = { ...(layer.layout || {}), [property]: value };
      layers.set(layerId, layer);
    },
    setPaintProperty(layerId, property, value) {
      const layer = layers.get(layerId);
      if (!layer) return;
      layer.paint = { ...(layer.paint || {}), [property]: value };
      layers.set(layerId, layer);
      paintCalls.push({ layerId, property, value });
    },
  };
}

function installCanvasDocumentMock() {
  const context = {
    clearRect() {},
    fillRect() {},
    getImageData() {
      return { data: new Uint8ClampedArray([255, 255, 255, 255]) };
    },
    set fillStyle(value) {
      this._fillStyle = value;
    },
    get fillStyle() {
      return this._fillStyle;
    },
  };

  globalThis.document = {
    createElement(tagName) {
      if (tagName !== 'canvas') {
        throw new Error(`Unsupported element in test mock: ${tagName}`);
      }
      return {
        width: 0,
        height: 0,
        getContext() {
          return context;
        },
      };
    },
  };
}

describe('user source registry', () => {
  let registry;

  beforeEach(async () => {
    vi.resetModules();
    installCanvasDocumentMock();
    registry = await import('../../app/js/layer-registry.js');
    registry.clearUserSources();
  });

  afterEach(() => {
    registry.clearUserSources();
    vi.restoreAllMocks();
    delete globalThis.document;
  });

  it('registerUserSource adds entry to catalog lookups', () => {
    const entry = {
      id: 'user-mytiles', label: 'My Tiles', category: 'basemap',
      region: null, defaultView: null,
      sources: { 'user-src-mytiles': { type: 'raster', tiles: ['http://localhost/tiles/mytiles/{z}/{x}/{y}.png'], tileSize: 256 } },
      layers: [{ id: 'basemap-user-mytiles', type: 'raster', source: 'user-src-mytiles', paint: {} }],
    };
    registry.registerUserSource(entry);

    expect(registry.getCatalogEntry('user-mytiles')).toBeTruthy();
    expect(registry.getCatalogEntry('user-mytiles').userDefined).toBe(true);
    expect(registry.getBasemaps().some(e => e.id === 'user-mytiles')).toBe(true);
    expect(registry.getUserSources()).toHaveLength(1);
  });

  it('unregisterUserSource removes entry', () => {
    registry.registerUserSource({ id: 'user-x', label: 'X', category: 'overlay', region: null, defaultView: null, sources: {}, layers: [] });
    expect(registry.getCatalogEntry('user-x')).toBeTruthy();

    const removed = registry.unregisterUserSource('user-x');
    expect(removed).toBe(true);
    expect(registry.getCatalogEntry('user-x')).toBeNull();
    expect(registry.unregisterUserSource('user-x')).toBe(false);
  });

  it('clearUserSources removes all user entries', () => {
    registry.registerUserSource({ id: 'user-a', label: 'A', category: 'basemap', region: null, defaultView: null, sources: {}, layers: [] });
    registry.registerUserSource({ id: 'user-b', label: 'B', category: 'basemap', region: null, defaultView: null, sources: {}, layers: [] });
    expect(registry.getUserSources()).toHaveLength(2);

    registry.clearUserSources();
    expect(registry.getUserSources()).toHaveLength(0);
    expect(registry.getCatalogEntry('user-a')).toBeNull();
  });

  it('registerUserSource replaces existing entry with same id', () => {
    registry.registerUserSource({ id: 'user-dup', label: 'V1', category: 'basemap', region: null, defaultView: null, sources: {}, layers: [] });
    registry.registerUserSource({ id: 'user-dup', label: 'V2', category: 'basemap', region: null, defaultView: null, sources: {}, layers: [] });
    expect(registry.getUserSources()).toHaveLength(1);
    expect(registry.getCatalogEntry('user-dup').label).toBe('V2');
  });

  it('user sources do not shadow built-in entries', () => {
    // Built-in 'osm' should still exist
    expect(registry.getCatalogEntry('osm')).toBeTruthy();
    expect(registry.getCatalogEntry('osm').userDefined).toBeUndefined();
  });

  it('getBasemaps includes user basemaps', () => {
    const builtInCount = registry.getBasemaps().length;
    registry.registerUserSource({ id: 'user-bm', label: 'UBM', category: 'basemap', region: null, defaultView: null, sources: {}, layers: [] });
    expect(registry.getBasemaps().length).toBe(builtInCount + 1);
  });

  it('getOverlays includes user overlays', () => {
    const builtInCount = registry.getOverlays().length;
    registry.registerUserSource({ id: 'user-ov', label: 'UOV', category: 'overlay', region: null, defaultView: null, sources: {}, layers: [] });
    expect(registry.getOverlays().length).toBe(builtInCount + 1);
  });

  it('buildCatalogEntryFromTileSource creates valid entry for mbtiles', () => {
    const src = { name: 'alps-topo', path: '/data/alps.mbtiles', kind: 'mbtiles' };
    const entry = registry.buildCatalogEntryFromTileSource(src, 'http://127.0.0.1:14321');

    expect(entry.id).toBe('user-alps-topo');
    expect(entry.label).toBe('alps-topo');
    expect(entry.category).toBe('basemap');
    expect(entry.userDefined).toBe(true);
    expect(entry.localPath).toBe('/data/alps.mbtiles');
    expect(entry.tileSourceKind).toBe('mbtiles');
    expect(entry.sources['user-src-alps-topo'].tiles[0]).toContain('/tiles/alps-topo/');
    expect(entry.layers).toHaveLength(1);
    expect(entry.layers[0].id).toBe('basemap-user-alps-topo');
  });

  it('buildCatalogEntryFromTileSource creates valid entry for pmtiles', () => {
    const src = { name: 'satellite', path: '/data/sat.pmtiles', kind: 'pmtiles' };
    const entry = registry.buildCatalogEntryFromTileSource(src, 'http://127.0.0.1:14321', 'overlay');

    expect(entry.id).toBe('user-satellite');
    expect(entry.category).toBe('overlay');
    expect(entry.tileSourceKind).toBe('pmtiles');
    // PMTiles sources use pmtiles:// protocol URL, not tiles array
    const srcDef = entry.sources['user-src-satellite'];
    expect(srcDef.url).toBe('pmtiles://http://127.0.0.1:14321/pmtiles/satellite');
    expect(srcDef.tiles).toBeUndefined();
  });

  it('buildCatalogSources includes user sources', () => {
    const entry = registry.buildCatalogEntryFromTileSource(
      { name: 'test', path: '/x.mbtiles', kind: 'mbtiles' },
      'http://localhost:14321'
    );
    registry.registerUserSource(entry);
    const sources = registry.buildCatalogSources();
    expect(sources['user-src-test']).toBeTruthy();
  });

  it('buildCatalogLayers includes user layers', () => {
    const entry = registry.buildCatalogEntryFromTileSource(
      { name: 'test2', path: '/x.mbtiles', kind: 'mbtiles' },
      'http://localhost:14321'
    );
    registry.registerUserSource(entry);
    const layers = registry.buildCatalogLayers();
    expect(layers.some(l => l.id === 'basemap-user-test2')).toBe(true);
  });
});

describe('layer-engine style basemaps', () => {
  beforeEach(() => {
    vi.resetModules();
    installCanvasDocumentMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.document;
  });

  it('loads and activates a style-backed basemap from the catalog', async () => {
    ({ applyLayerOpacity, setBasemap } = await import('../../app/js/layer-engine.js'));
    const map = createMapMock();
    map.__nativeBasemapLayerIds = new Map();
    map.__ensureBasemapStyle = vi.fn(async (catalogId) => {
      if (catalogId !== 'swisstopo-vector') return;
      map.layers.set('swiss-background', { id: 'swiss-background', type: 'background', layout: { visibility: 'none' }, paint: {} });
      map.layers.set('swiss-land', { id: 'swiss-land', type: 'fill', layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.75 } });
      map.layers.set('swiss-labels', { id: 'swiss-labels', type: 'symbol', layout: { visibility: 'none' }, paint: { 'text-opacity': 0.4, 'icon-opacity': 0.8 } });
      map.__nativeBasemapLayerIds.set('swisstopo-vector', ['swiss-background', 'swiss-land', 'swiss-labels']);
    });
    const state = {
      basemap: 'osm',
      basemapOpacity: 0.6,
      activeOverlays: [],
      layerOrder: [],
    };

    await setBasemap(map, state, 'swisstopo-vector');

    expect(map.__ensureBasemapStyle).toHaveBeenCalledWith('swisstopo-vector');

    expect(map.getLayer('swiss-background')?.layout.visibility).toBe('visible');
    expect(map.getLayer('swiss-land')?.layout.visibility).toBe('visible');
    expect(map.getLayer('swiss-labels')?.layout.visibility).toBe('visible');
    expect(map.getLayer('basemap-osm')?.layout.visibility).toBe('none');

    expect(map.paintCalls).toEqual(
      expect.arrayContaining([
        { layerId: 'swiss-land', property: 'fill-opacity', value: 0.44999999999999996 },
        { layerId: 'swiss-labels', property: 'text-opacity', value: 0.24 },
        { layerId: 'swiss-labels', property: 'icon-opacity', value: 0.48 },
      ])
    );
    expect(map.paintCalls).not.toEqual(
      expect.arrayContaining([
        { layerId: 'swiss-background', property: 'background-opacity', value: expect.anything() },
      ])
    );
    expect(map.moveCalls).toEqual(
      expect.arrayContaining([
        { layerId: 'swiss-background', beforeId: 'dem-loader', kind: 'move' },
        { layerId: 'swiss-land', beforeId: 'dem-loader', kind: 'move' },
        { layerId: 'swiss-labels', beforeId: 'dem-loader', kind: 'move' },
      ])
    );
  });

  it('syncLayerOrder includes basemapStack and activeOverlays', async () => {
    const { syncLayerOrder } = await import('../../app/js/layer-engine.js');
    const state = {
      basemapStack: ['osm', 'swisstopo-raster'],
      activeOverlays: ['openskimap', 'swisstopo-ski-ch'],
      layerOrder: [],
    };
    syncLayerOrder(state);
    expect(state.layerOrder).toEqual(['osm', 'swisstopo-raster', 'openskimap', 'swisstopo-ski-ch']);
  });

  it('syncLayerOrder preserves existing order', async () => {
    const { syncLayerOrder } = await import('../../app/js/layer-engine.js');
    const state = {
      basemapStack: ['osm'],
      activeOverlays: ['openskimap', 'swisstopo-ski-ch'],
      layerOrder: ['swisstopo-ski-ch', 'osm', 'openskimap'],
    };
    syncLayerOrder(state);
    // Existing order preserved, all items still present
    expect(state.layerOrder).toEqual(['swisstopo-ski-ch', 'osm', 'openskimap']);
  });

  it('syncLayerOrder removes stale entries', async () => {
    const { syncLayerOrder } = await import('../../app/js/layer-engine.js');
    const state = {
      basemapStack: ['osm'],
      activeOverlays: [],
      layerOrder: ['osm', 'openskimap', 'swisstopo-ski-ch'],
    };
    syncLayerOrder(state);
    expect(state.layerOrder).toEqual(['osm']);
  });

  it('updates opacity for already-loaded style-backed basemap layers', async () => {
    ({ applyLayerOpacity, setBasemap } = await import('../../app/js/layer-engine.js'));
    const map = createMapMock();
    map.__nativeBasemapLayerIds = new Map();
    map.__ensureBasemapStyle = vi.fn(async (catalogId) => {
      if (catalogId !== 'swisstopo-vector') return;
      map.layers.set('swiss-background', { id: 'swiss-background', type: 'background', layout: { visibility: 'none' }, paint: {} });
      map.layers.set('swiss-land', { id: 'swiss-land', type: 'fill', layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.75 } });
      map.layers.set('swiss-labels', { id: 'swiss-labels', type: 'symbol', layout: { visibility: 'none' }, paint: { 'text-opacity': 0.4, 'icon-opacity': 0.8 } });
      map.__nativeBasemapLayerIds.set('swisstopo-vector', ['swiss-background', 'swiss-land', 'swiss-labels']);
    });
    const state = {
      basemap: 'swisstopo-vector',
      basemapOpacity: 0.8,
      activeOverlays: [],
      layerOrder: [],
    };

    await setBasemap(map, state, 'swisstopo-vector');
    map.paintCalls.length = 0;

    applyLayerOpacity(map, 'swisstopo-vector', 0.25);

    expect(map.paintCalls).toEqual(
      expect.arrayContaining([
        { layerId: 'swiss-land', property: 'fill-opacity', value: 0.1875 },
        { layerId: 'swiss-labels', property: 'text-opacity', value: 0.1 },
        { layerId: 'swiss-labels', property: 'icon-opacity', value: 0.2 },
      ])
    );
    expect(map.paintCalls).not.toEqual(
      expect.arrayContaining([
        { layerId: 'swiss-background', property: 'background-opacity', value: expect.anything() },
      ])
    );
  });
});
