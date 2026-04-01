// Declarative layer catalog — single source of truth for all map layers.
// Each entry describes sources, map layers, UI metadata, and optional region bounds.

import { basemapOpacityExpr } from './constants.js';

/**
 * @typedef {Object} CatalogEntry
 * @property {string} id - unique identifier
 * @property {string} label - UI display name
 * @property {'basemap'|'overlay'} category
 * @property {[number,number,number,number]|null} region - [w,s,e,n] bounding box or null for global
 * @property {{center:[number,number], zoom:number}|null} defaultView - fly-to when selected
 * @property {Object} sources - MapLibre source definitions keyed by source id
 * @property {Object[]} layers - MapLibre layer definitions
 */

/** @type {CatalogEntry[]} */
export const LAYER_CATALOG = [
  // ── Basemaps ──────────────────────────────────────────────────────
  {
    id: 'none',
    label: 'None',
    category: 'basemap',
    region: null,
    defaultView: null,
    sources: {},
    layers: []
  },
  {
    id: 'osm',
    label: 'OSM',
    category: 'basemap',
    region: null,
    defaultView: null,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'basemap-osm',
        type: 'raster',
        source: 'osm',
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      }
    ]
  },
  {
    id: 'otm',
    label: 'OTM',
    category: 'basemap',
    region: null,
    defaultView: null,
    sources: {
      otm: {
        type: 'raster',
        tiles: [
          'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; OpenStreetMap contributors, OpenTopoMap'
      }
    },
    layers: [
      {
        id: 'basemap-otm',
        type: 'raster',
        source: 'otm',
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      }
    ]
  },
  {
    id: 'ign-plan',
    label: 'IGN plan (FR)',
    category: 'basemap',
    region: [-5.5, 41, 10, 51.5],
    defaultView: { center: [2.35, 46.8], zoom: 6 },
    sources: {
      ignplan: {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '&copy; IGN France'
      }
    },
    layers: [
      {
        id: 'basemap-ign',
        type: 'raster',
        source: 'ignplan',
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      }
    ]
  },
  {
    id: 'swisstopo-vector',
    label: 'SwissTopo vector',
    category: 'basemap',
    region: [5.9, 45.8, 10.5, 47.8],
    defaultView: { center: [8.23, 46.82], zoom: 8 },
    sources: {
      swisstopo: {
        type: 'vector',
        tiles: ['https://vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/{z}/{x}/{y}.pbf'],
        maxzoom: 14,
        attribution: '&copy; swisstopo'
      }
    },
    layers: [
      {
        id: 'basemap-swiss-landcover',
        type: 'fill',
        source: 'swisstopo',
        'source-layer': 'landcover',
        paint: { 'fill-color': '#dce7cf', 'fill-opacity': basemapOpacityExpr(0.85) }
      },
      {
        id: 'basemap-swiss-water',
        type: 'fill',
        source: 'swisstopo',
        'source-layer': 'water',
        paint: { 'fill-color': '#b7d7ff', 'fill-opacity': basemapOpacityExpr(0.95) }
      },
      {
        id: 'basemap-swiss-transport',
        type: 'line',
        source: 'swisstopo',
        'source-layer': 'transportation',
        paint: {
          'line-color': '#7a7a7a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 14, 1.8],
          'line-opacity': basemapOpacityExpr(0.9)
        }
      },
      {
        id: 'basemap-swiss-boundary',
        type: 'line',
        source: 'swisstopo',
        'source-layer': 'boundary',
        paint: {
          'line-color': '#7f4b63',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.25, 14, 1.25],
          'line-opacity': basemapOpacityExpr(0.75)
        }
      },
      {
        id: 'basemap-swiss-label',
        type: 'symbol',
        source: 'swisstopo',
        'source-layer': 'place',
        layout: {
          'text-field': ['coalesce', ['get', 'name'], ['get', 'name_de'], ['get', 'name_fr'], ['get', 'name_it'], ''],
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 14, 13]
        },
        paint: {
          'text-color': '#2e2e2e',
          'text-opacity': basemapOpacityExpr(0.9),
          'text-halo-color': '#ffffff',
          'text-halo-width': 1
        }
      }
    ]
  },
  {
    id: 'kartverket',
    label: 'Kartverket topo (NO)',
    category: 'basemap',
    region: [3, 57, 32, 72],
    defaultView: { center: [13.0, 67], zoom: 6 },
    sources: {
      kartverket: {
        type: 'raster',
        tiles: ['https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; Kartverket'
      }
    },
    layers: [
      {
        id: 'basemap-kartverket',
        type: 'raster',
        source: 'kartverket',
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      }
    ]
  },
  {
    id: 'swisstopo-raster',
    label: 'SwissTopo raster',
    category: 'basemap',
    region: [5.9, 45.8, 10.5, 47.8],
    defaultView: { center: [8.23, 46.82], zoom: 8 },
    sources: {
      'swisstopo-raster': {
        type: 'raster',
        tiles: ['https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '&copy; swisstopo'
      }
    },
    layers: [
      {
        id: 'basemap-swisstopo-raster',
        type: 'raster',
        source: 'swisstopo-raster',
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      }
    ]
  },
  {
    id: 'ign-topo',
    label: 'IGN topo (FR)',
    category: 'basemap',
    region: [-5.5, 41, 10, 51.5],
    defaultView: { center: [2.35, 46.8], zoom: 6 },
    sources: {
      igntopo: {
        type: 'raster',
        tiles: ['https://data.geopf.fr/private/wmts?apikey=ign_scan_ws&layer=GEOGRAPHICALGRIDSYSTEMS.MAPS&style=normal&tilematrixset=PM&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '&copy; IGN France'
      }
    },
    layers: [
      {
        id: 'basemap-ign-topo',
        type: 'raster',
        source: 'igntopo',
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      }
    ]
  },
  {
    id: 'ign-ortho',
    label: 'IGN ortho (FR)',
    category: 'basemap',
    region: [-5.5, 41, 10, 51.5],
    defaultView: { center: [2.35, 46.8], zoom: 6 },
    sources: {
      ignortho: {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; IGN France'
      }
    },
    layers: [
      {
        id: 'basemap-ign-ortho',
        type: 'raster',
        source: 'ignortho',
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      }
    ]
  },

  // ── Overlays ──────────────────────────────────────────────────────
  {
    id: 'openskimap',
    label: 'OpenSkiMap',
    category: 'overlay',
    region: null,
    defaultView: null,
    sources: {
      openskimap: {
        type: 'vector',
        tiles: ['https://tiles.openskimap.org/openskimap/{z}/{x}/{y}.pbf'],
        maxzoom: 14,
        attribution: '&copy; OpenSkiMap, OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'basemap-ski-areas',
        type: 'fill',
        source: 'openskimap',
        'source-layer': 'skiareas',
        paint: { 'fill-color': '#dff1ff', 'fill-opacity': basemapOpacityExpr(0.35) }
      },
      {
        id: 'basemap-ski-runs',
        type: 'line',
        source: 'openskimap',
        'source-layer': 'runs',
        paint: {
          'line-color': '#0d7cff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.9, 14, 2.6],
          'line-opacity': basemapOpacityExpr(0.95)
        }
      },
      {
        id: 'basemap-ski-lifts',
        type: 'line',
        source: 'openskimap',
        'source-layer': 'lifts',
        paint: {
          'line-color': '#121212',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 14, 2.0],
          'line-opacity': basemapOpacityExpr(0.9)
        }
      },
      {
        id: 'basemap-ski-spots',
        type: 'symbol',
        source: 'openskimap',
        'source-layer': 'spots',
        layout: {
          'text-field': ['coalesce', ['get', 'name'], ''],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 12]
        },
        paint: {
          'text-color': '#10243f',
          'text-opacity': basemapOpacityExpr(0.9),
          'text-halo-color': '#ffffff',
          'text-halo-width': 1
        }
      }
    ]
  },
  {
    id: 'swisstopo-ski',
    label: 'SwissTopo ski routes (CH)',
    category: 'overlay',
    region: [5.9, 45.8, 10.5, 47.8],
    defaultView: null,
    sources: {
      'swisstopo-ski': {
        type: 'raster',
        tiles: ['https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; swisstopo / SAC'
      }
    },
    layers: [
      {
        id: 'overlay-swisstopo-ski',
        type: 'raster',
        source: 'swisstopo-ski',
        paint: { 'raster-opacity': basemapOpacityExpr(0.9) }
      }
    ]
  },
  {
    id: 'swisstopo-slope',
    label: 'SwissTopo slope >30° (CH)',
    category: 'overlay',
    region: [5.9, 45.8, 10.5, 47.8],
    defaultView: null,
    sources: {
      'swisstopo-slope30': {
        type: 'raster',
        tiles: ['https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; swisstopo'
      }
    },
    layers: [
      {
        id: 'overlay-swisstopo-slope30',
        type: 'raster',
        source: 'swisstopo-slope30',
        paint: { 'raster-opacity': basemapOpacityExpr(0.7) }
      }
    ]
  },
  {
    id: 'ign-ski',
    label: 'IGN ski routes (FR)',
    category: 'overlay',
    region: [-5.5, 41, 10, 51.5],
    defaultView: null,
    sources: {
      'ign-ski': {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=TRACES.RANDO.HIVERNALE&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; IGN France'
      }
    },
    layers: [
      {
        id: 'overlay-ign-ski',
        type: 'raster',
        source: 'ign-ski',
        paint: { 'raster-opacity': basemapOpacityExpr(0.9) }
      }
    ]
  },
  {
    id: 'ign-slopes',
    label: 'IGN slope >30° (FR)',
    category: 'overlay',
    region: [-5.5, 41, 10, 51.5],
    defaultView: null,
    sources: {
      'ign-slopes': {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; IGN France'
      }
    },
    layers: [
      {
        id: 'overlay-ign-slopes',
        type: 'raster',
        source: 'ign-slopes',
        paint: { 'raster-opacity': basemapOpacityExpr(0.7) }
      }
    ]
  },
];

// ── Lookup helpers ──────────────────────────────────────────────────

const _byId = new Map(LAYER_CATALOG.map(e => [e.id, e]));

/** Get a catalog entry by id */
export function getCatalogEntry(id) {
  return _byId.get(id) || null;
}

/** All basemap entries */
export function getBasemaps() {
  return LAYER_CATALOG.filter(e => e.category === 'basemap');
}

/** All overlay entries */
export function getOverlays() {
  return LAYER_CATALOG.filter(e => e.category === 'overlay');
}

/** All MapLibre layer IDs owned by a catalog entry */
export function getLayerIds(catalogId) {
  const entry = _byId.get(catalogId);
  return entry ? entry.layers.map(l => l.id) : [];
}

/** All MapLibre layer IDs for all basemaps */
export function getAllBasemapLayerIds() {
  return getBasemaps().flatMap(e => e.layers.map(l => l.id));
}

/** All MapLibre layer IDs for all overlays */
export function getAllOverlayLayerIds() {
  return getOverlays().flatMap(e => e.layers.map(l => l.id));
}

/** Build aggregated sources object from the full catalog (for initial style) */
export function buildCatalogSources() {
  const sources = {};
  for (const entry of LAYER_CATALOG) {
    Object.assign(sources, entry.sources);
  }
  return sources;
}

/** Build aggregated layers array from the full catalog (all start hidden) */
export function buildCatalogLayers() {
  const layers = [];
  for (const entry of LAYER_CATALOG) {
    for (const layer of entry.layers) {
      layers.push({
        ...layer,
        layout: { ...(layer.layout || {}), visibility: 'none' }
      });
    }
  }
  return layers;
}

/**
 * Generate an auto-name for a bookmark from current basemap + overlays.
 * Format: "<Basemap> + <Overlay> [+ N others]"
 */
export function generateBookmarkName(basemapId, overlayIds) {
  const basemap = _byId.get(basemapId);
  const basemapLabel = basemap ? basemap.label : basemapId;

  if (!overlayIds || overlayIds.length === 0) {
    return basemapLabel;
  }

  const firstOverlay = _byId.get(overlayIds[0]);
  const firstLabel = firstOverlay ? firstOverlay.label : overlayIds[0];

  if (overlayIds.length === 1) {
    return `${basemapLabel} + ${firstLabel}`;
  }

  const othersCount = overlayIds.length - 1;
  return `${basemapLabel} + ${firstLabel} + ${othersCount} other${othersCount > 1 ? 's' : ''}`;
}
