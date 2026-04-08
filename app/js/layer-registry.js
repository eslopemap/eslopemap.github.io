// Declarative layer catalog — single source of truth for all map layers.
// Each entry describes sources, map layers, UI metadata, and optional region bounds.

import { basemapOpacityExpr } from './constants.js';
import { saveUserSources } from './persist.js';

/**
 * @typedef {Object} CatalogEntry
 * @property {string} id - unique identifier
 * @property {string} label - UI display name
 * @property {'basemap'|'overlay'} category
 * @property {[number,number,number,number]|null} region - [w,s,e,n] bounding box or null for global
 * @property {{center:[number,number], zoom:number}|null} defaultView - fly-to when selected
 * @property {Object} sources - MapLibre source definitions keyed by source id
 * @property {Object[]} layers - MapLibre layer definitions
 * @property {string|null} [styleUrl] - optional external MapLibre style URL for style-backed basemaps
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
    label: 'OpenStreetMap',
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
    label: 'OpenTopoMap',
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
  {
    id: 'swisstopo-vector',
    label: 'SwissTopo vector',
    category: 'basemap',
    region: [5.9, 45.8, 10.5, 47.8],
    defaultView: { center: [8.23, 46.82], zoom: 8 },
    styleUrl: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json',
    sources: {},
    layers: []
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

// ── Dynamic user source registry ─────────────────────────────────────

/** @type {CatalogEntry[]} */
const _userSources = [];

/**
 * Register a user-defined tile source as a catalog entry.
 * If an entry with the same id already exists it is replaced.
 * @param {CatalogEntry} entry — must have `userDefined: true`
 */
export function registerUserSource(entry) {
  if (!entry || !entry.id) throw new Error('entry.id is required');
  unregisterUserSource(entry.id);
  _userSources.push({ ...entry, userDefined: true });
  _rebuildIndex();
  saveUserSources(_userSources);
}

/** Remove a user source by id. Returns true if found. */
export function unregisterUserSource(id) {
  const idx = _userSources.findIndex(e => e.id === id);
  if (idx >= 0) { _userSources.splice(idx, 1); _rebuildIndex(); saveUserSources(_userSources); return true; }
  return false;
}

/** Remove all user sources. */
export function clearUserSources() {
  _userSources.length = 0;
  _rebuildIndex();
  saveUserSources(_userSources);
}

/** Read-only snapshot of current user sources. */
export function getUserSources() {
  return [..._userSources];
}

// ── Lookup helpers ──────────────────────────────────────────────────

let _byId = new Map(LAYER_CATALOG.map(e => [e.id, e]));

/** Rebuild the lookup index after user sources change. */
function _rebuildIndex() {
  _byId = new Map([...LAYER_CATALOG, ..._userSources].map(e => [e.id, e]));
}

/** All catalog entries (built-in + user). */
export function getAllEntries() {
  return [...LAYER_CATALOG, ..._userSources];
}

/** Get a catalog entry by id */
export function getCatalogEntry(id) {
  return _byId.get(id) || null;
}

/** All basemap entries */
export function getBasemaps() {
  return getAllEntries().filter(e => e.category === 'basemap');
}

/** All overlay entries */
export function getOverlays() {
  return getAllEntries().filter(e => e.category === 'overlay');
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
