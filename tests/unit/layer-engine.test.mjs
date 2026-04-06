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
    map.__nativeStyleBasemapLayerIds = new Map();
    map.__ensureBasemapStyle = vi.fn(async (catalogId) => {
      if (catalogId !== 'swisstopo-vector') return;
      map.layers.set('swiss-background', { id: 'swiss-background', type: 'background', layout: { visibility: 'none' }, paint: {} });
      map.layers.set('swiss-land', { id: 'swiss-land', type: 'fill', layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.75 } });
      map.layers.set('swiss-labels', { id: 'swiss-labels', type: 'symbol', layout: { visibility: 'none' }, paint: { 'text-opacity': 0.4, 'icon-opacity': 0.8 } });
      map.__nativeStyleBasemapLayerIds.set('swisstopo-vector', ['swiss-background', 'swiss-land', 'swiss-labels']);
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

  it('updates opacity for already-loaded style-backed basemap layers', async () => {
    ({ applyLayerOpacity, setBasemap } = await import('../../app/js/layer-engine.js'));
    const map = createMapMock();
    map.__nativeStyleBasemapLayerIds = new Map();
    map.__ensureBasemapStyle = vi.fn(async (catalogId) => {
      if (catalogId !== 'swisstopo-vector') return;
      map.layers.set('swiss-background', { id: 'swiss-background', type: 'background', layout: { visibility: 'none' }, paint: {} });
      map.layers.set('swiss-land', { id: 'swiss-land', type: 'fill', layout: { visibility: 'none' }, paint: { 'fill-opacity': 0.75 } });
      map.layers.set('swiss-labels', { id: 'swiss-labels', type: 'symbol', layout: { visibility: 'none' }, paint: { 'text-opacity': 0.4, 'icon-opacity': 0.8 } });
      map.__nativeStyleBasemapLayerIds.set('swisstopo-vector', ['swiss-background', 'swiss-land', 'swiss-labels']);
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
