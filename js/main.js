// Entry point: creates map, imports modules, wires events.

import {
  DEM_HD_SOURCE_ID, DEM_MAX_Z, ANALYSIS_COLOR,
  DEM_TERRAIN_SOURCE_ID,
} from './constants.js';

import { createStore, STATE_DEFAULTS } from './state.js';

import {
  parseHashParams, syncViewToUrl, updateLegend,
  applyBasemapSelection, applyContourVisibility, applyOpenSkiMapOverlay,
  applySwisstopoSkiOverlay, applySwisstopoSlopeOverlay, applyIgnSkiOverlay, applyIgnSlopesOverlay,
  applyTerrainState, applyModeState,
  basemapOpacityExpr, setGlobalStatePropertySafe, updateCursorInfoVisibility,
  setCursorInfo, showCursorTooltipAt, hideCursorTooltip,
  getVisibleTriplesForMap, initSearch,
} from './ui.js';

import {
  queryLoadedElevationAtLngLat,
} from './dem.js';

import { initTracks, getTracksState } from './tracks.js';
import { initProfile, updateProfile, getProfileChart } from './profile.js';
import { importFileContent } from './io.js';
import { loadSettings, saveSettings, clearAll as clearPersistedData } from './persist.js';
import { initShortcuts, registerShortcut } from './shortcuts.js';
import { openInfoEditor, openCurrentContextMenu } from './gpx-tree.js';
import { initSelectionTools, toggleRectangleMode, isRectangleModeActive, setRectangleMode, setActionPreview, clearSelection, getCurrentSelection } from './selection-tools.js';
import { describeOperationConsequence } from './track-ops.js';
import { initWebImport } from './web-import.js';

import { lonLatToTile, normalizeTileX, tileToLngLatBounds } from './utils.js';

// ---- State (reactive via Proxy) ----
const state = createStore(STATE_DEFAULTS);

// ---- Debug grid ----

function buildDebugGridGeoJSON(map) {
  const visible = getVisibleTriplesForMap(map);
  const features = [];
  const dedupe = new Set();

  for (const t of visible) {
    const id = `${t.z}/${t.x}/${t.y}`;
    if (dedupe.has(id)) continue;
    dedupe.add(id);

    const b = tileToLngLatBounds(t.x, t.y, t.z);
    features.push({
      type: 'Feature',
      properties: {id, z: t.z, x: t.x, y: t.y},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [b.west, b.north],
          [b.east, b.north],
          [b.east, b.south],
          [b.west, b.south],
          [b.west, b.north]
        ]]
      }
    });
  }

  return { type: 'FeatureCollection', features };
}

function updateDebugGridSource(map) {
  const src = map.getSource('dem-debug-grid');
  if (!src) return;
  src.setData(buildDebugGridGeoJSON(map));
}

function ensureDebugGridLayer(map) {
  if (!map.getSource('dem-debug-grid')) {
    map.addSource('dem-debug-grid', {
      type: 'geojson',
      data: {type: 'FeatureCollection', features: []}
    });
  }

  if (!map.getLayer('dem-debug-grid-line')) {
    map.addLayer({
      id: 'dem-debug-grid-line',
      type: 'line',
      source: 'dem-debug-grid',
      layout: {
        visibility: state.showTileGrid ? 'visible' : 'none'
      },
      paint: {
        'line-color': '#111111',
        'line-width': 1,
        'line-opacity': 0.8
      }
    });
  }
}

// ---- Initial view from URL hash + persisted settings ----

// Persisted settings as defaults, URL hash overrides
const persisted = loadSettings();
if (persisted) {
  for (const k of Object.keys(persisted)) {
    if (persisted[k] !== undefined) state[k] = persisted[k];
  }
}

const initialView = parseHashParams();
if (initialView.basemap) {
  state.basemap = initialView.basemap;
}
state.mode = initialView.mode;
state.slopeOpacity = initialView.slopeOpacity;
state.terrain3d = initialView.terrain3d;
state.terrainExaggeration = initialView.terrainExaggeration;
document.getElementById('basemap').value = state.basemap;
document.getElementById('mode').value = state.mode;
document.getElementById('slopeOpacity').value = String(state.slopeOpacity);
document.getElementById('slopeOpacityValue').textContent = state.slopeOpacity.toFixed(2);
document.getElementById('terrain3d').checked = state.terrain3d;
document.getElementById('terrainExaggeration').value = String(state.terrainExaggeration);
document.getElementById('terrainExaggeration').disabled = !state.terrain3d;
document.getElementById('terrainExaggerationValue').textContent = state.terrainExaggeration.toFixed(2);
// Sync additional persisted settings to UI
if (persisted) {
  if (persisted.basemapOpacity != null) {
    document.getElementById('basemapOpacity').value = String(state.basemapOpacity);
    document.getElementById('basemapOpacityValue').textContent = state.basemapOpacity.toFixed(2);
  }
  if (persisted.hillshadeOpacity != null) {
    document.getElementById('hillshadeOpacity').value = String(state.hillshadeOpacity);
    document.getElementById('hillshadeOpacityValue').textContent = state.hillshadeOpacity.toFixed(2);
  }
  if (persisted.hillshadeMethod != null) {
    document.getElementById('hillshadeMethod').value = state.hillshadeMethod;
  }
  if (persisted.showContours != null) document.getElementById('showContours').checked = state.showContours;
  if (persisted.showOpenSkiMap != null) document.getElementById('showOpenSkiMap').checked = state.showOpenSkiMap;
  if (persisted.showSwisstopoSki != null) document.getElementById('showSwisstopoSki').checked = state.showSwisstopoSki;
  if (persisted.showSwisstopoSlope != null) document.getElementById('showSwisstopoSlope').checked = state.showSwisstopoSlope;
  if (persisted.showIgnSki != null) document.getElementById('showIgnSki').checked = state.showIgnSki;
  if (persisted.showIgnSlopes != null) document.getElementById('showIgnSlopes').checked = state.showIgnSlopes;
  if (persisted.multiplyBlend != null) document.getElementById('multiplyBlend').checked = state.multiplyBlend;
  if (persisted.cursorInfoMode != null) document.getElementById('cursorInfoMode').value = state.cursorInfoMode;
  if (persisted.pauseThreshold != null) {
    document.getElementById('pauseThreshold').value = String(state.pauseThreshold);
    document.getElementById('pauseThresholdValue').textContent = state.pauseThreshold;
  }
  if (persisted.profileSmoothing != null) {
    document.getElementById('profileSmoothing').value = String(state.profileSmoothing);
    document.getElementById('profileSmoothingValue').textContent = state.profileSmoothing;
  }
}

// On mobile, default to corner cursor-info mode (center crosshair acts as pointer)
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isMobile && !(persisted && persisted.cursorInfoMode != null)) {
  state.cursorInfoMode = 'corner';
  document.getElementById('cursorInfoMode').value = 'corner';
}

// Debounced settings save
let _settingsSaveTimer = 0;
function scheduleSettingsSave() {
  clearTimeout(_settingsSaveTimer);
  _settingsSaveTimer = setTimeout(() => saveSettings(state), 300);
}

// ---- Contour line source ----

const demContourSource = new mlcontour.DemSource({
  url: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
  encoding: 'terrarium',
  maxzoom: 12,
  worker: true
});
demContourSource.setupMaplibre(maplibregl);

// ---- Map ----

const map = new maplibregl.Map({
  container: 'map',
  center: initialView.center,
  zoom: initialView.zoom,
  bearing: initialView.bearing,
  pitch: initialView.pitch,
  maxTileCacheZoomLevels: 20,
  attributionControl: false,
  style: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      contourSource: {
        type: 'vector',
        tiles: [
          demContourSource.contourProtocolUrl({
            multiplier: 1,
            overzoom: 1,
            thresholds: {
              10: [200, 1000],
              11: [100, 500],
              12: [100, 500],
              13: [50, 200],
              14: [20, 100],
              16: [10, 50]
            },
            elevationKey: 'ele',
            levelKey: 'level',
            contourLayer: 'contours'
          })
        ],
        maxzoom: 16
      },
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      },
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
      },
      ignplan: {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '&copy; IGN France'
      },
      swisstopo: {
        type: 'vector',
        tiles: ['https://vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/{z}/{x}/{y}.pbf'],
        maxzoom: 14,
        attribution: '&copy; swisstopo'
      },
      openskimap: {
        type: 'vector',
        tiles: ['https://tiles.openskimap.org/openskimap/{z}/{x}/{y}.pbf'],
        maxzoom: 14,
        attribution: '&copy; OpenSkiMap, OpenStreetMap contributors'
      },
      kartverket: {
        type: 'raster',
        tiles: ['https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; Kartverket'
      },
      'swisstopo-raster': {
        type: 'raster',
        tiles: ['https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '&copy; swisstopo'
      },
      igntopo: {
        type: 'raster',
        tiles: ['https://data.geopf.fr/private/wmts?apikey=ign_scan_ws&layer=GEOGRAPHICALGRIDSYSTEMS.MAPS&style=normal&tilematrixset=PM&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '&copy; IGN France'
      },
      ignortho: {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; IGN France'
      },
      'swisstopo-ski': {
        type: 'raster',
        tiles: ['https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; swisstopo / SAC'
      },
      'swisstopo-slope30': {
        type: 'raster',
        tiles: ['https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; swisstopo'
      },
      'ign-ski': {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=TRACES.RANDO.HIVERNALE&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; IGN France'
      },
      'ign-slopes': {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '&copy; IGN France'
      },
      // Separate raster-dem sources for terrain and
      // hillshade/analysis on purpose: in current MapLibre,
      // one source means one shared TileManager, and terrain changes shared DEM
      // tile selection/preparation toward coarser tiles for performance. A
      // larger shared tile cache does not isolate those different behaviors.
      [DEM_TERRAIN_SOURCE_ID]: {
        type: 'raster-dem',
        tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
        tileSize: 512,
        maxzoom: DEM_MAX_Z,
        encoding: 'terrarium'
      },
      [DEM_HD_SOURCE_ID]: {
        type: 'raster-dem',
        tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
        tileSize: 512,
        maxzoom: DEM_MAX_Z,
        encoding: 'terrarium'
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': '#ffffff'
        }
      },
      {
        id: 'basemap-osm',
        type: 'raster',
        source: 'osm',
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      },
      {
        id: 'basemap-otm',
        type: 'raster',
        source: 'otm',
        layout: {visibility: 'none'},
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      },
      {
        id: 'basemap-ign',
        type: 'raster',
        source: 'ignplan',
        layout: {visibility: 'none'},
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      },
      {
        id: 'basemap-kartverket',
        type: 'raster',
        source: 'kartverket',
        layout: {visibility: 'none'},
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      },
      {
        id: 'basemap-swisstopo-raster',
        type: 'raster',
        source: 'swisstopo-raster',
        layout: {visibility: 'none'},
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      },
      {
        id: 'basemap-ign-topo',
        type: 'raster',
        source: 'igntopo',
        layout: {visibility: 'none'},
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      },
      {
        id: 'basemap-ign-ortho',
        type: 'raster',
        source: 'ignortho',
        layout: {visibility: 'none'},
        paint: { 'raster-opacity': basemapOpacityExpr(1) }
      },
      {
        id: 'basemap-swiss-landcover',
        type: 'fill',
        source: 'swisstopo',
        'source-layer': 'landcover',
        layout: {visibility: 'none'},
        paint: { 'fill-color': '#dce7cf', 'fill-opacity': basemapOpacityExpr(0.85) }
      },
      {
        id: 'basemap-swiss-water',
        type: 'fill',
        source: 'swisstopo',
        'source-layer': 'water',
        layout: {visibility: 'none'},
        paint: { 'fill-color': '#b7d7ff', 'fill-opacity': basemapOpacityExpr(0.95) }
      },
      {
        id: 'basemap-swiss-transport',
        type: 'line',
        source: 'swisstopo',
        'source-layer': 'transportation',
        layout: {visibility: 'none'},
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
        layout: {visibility: 'none'},
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
          visibility: 'none',
          'text-field': ['coalesce', ['get', 'name'], ['get', 'name_de'], ['get', 'name_fr'], ['get', 'name_it'], ''],
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 14, 13]
        },
        paint: {
          'text-color': '#2e2e2e',
          'text-opacity': basemapOpacityExpr(0.9),
          'text-halo-color': '#ffffff',
          'text-halo-width': 1
        }
      },
      {
        id: 'basemap-ski-areas',
        type: 'fill',
        source: 'openskimap',
        'source-layer': 'skiareas',
        layout: {visibility: 'none'},
        paint: { 'fill-color': '#dff1ff', 'fill-opacity': basemapOpacityExpr(0.35) }
      },
      {
        id: 'basemap-ski-runs',
        type: 'line',
        source: 'openskimap',
        'source-layer': 'runs',
        layout: {visibility: 'none'},
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
        layout: {visibility: 'none'},
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
          visibility: 'none',
          'text-field': ['coalesce', ['get', 'name'], ''],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 12]
        },
        paint: {
          'text-color': '#10243f',
          'text-opacity': basemapOpacityExpr(0.9),
          'text-halo-color': '#ffffff',
          'text-halo-width': 1
        }
      },
      {
        id: 'overlay-swisstopo-ski',
        type: 'raster',
        source: 'swisstopo-ski',
        layout: {visibility: 'none'},
        paint: { 'raster-opacity': basemapOpacityExpr(0.9) }
      },
      {
        id: 'overlay-swisstopo-slope30',
        type: 'raster',
        source: 'swisstopo-slope30',
        layout: {visibility: 'none'},
        paint: { 'raster-opacity': basemapOpacityExpr(0.7) }
      },
      {
        id: 'overlay-ign-ski',
        type: 'raster',
        source: 'ign-ski',
        layout: {visibility: 'none'},
        paint: { 'raster-opacity': basemapOpacityExpr(0.9) }
      },
      {
        id: 'overlay-ign-slopes',
        type: 'raster',
        source: 'ign-slopes',
        layout: {visibility: 'none'},
        paint: { 'raster-opacity': basemapOpacityExpr(0.7) }
      },
      {
        id: 'dem-loader',
        type: 'hillshade',
        source: DEM_HD_SOURCE_ID,
        paint: {
          'hillshade-method': state.hillshadeMethod,
          'hillshade-exaggeration': ['coalesce', ['global-state', 'hillshadeOpacity'], 0.35],
          'hillshade-shadow-color': '#000000',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#000000',
        }
      },
      // Terrain analysis layers — must be right after dem-loader for 3D terrain compatibility.
      // Start hidden; applyModeState() sets visibility on load.
      {
        id: 'analysis',
        type: 'terrain-analysis',
        source: DEM_HD_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'attribute': 'slope',
          'opacity': state.slopeOpacity,
          'color': ANALYSIS_COLOR.slope,
          'blend-mode': state.multiplyBlend ? (state.slopeOpacity > 0.7 ? 'multiply' : 'soft-multiply') : 'normal'
        }
      },
      {
        id: 'analysis-relief',
        type: 'terrain-analysis',
        source: DEM_HD_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'attribute': 'elevation',
          'opacity': state.slopeOpacity,
          'color': ANALYSIS_COLOR['color-relief'],
          'blend-mode': state.multiplyBlend ? (state.slopeOpacity > 0.7 ? 'multiply' : 'soft-multiply') : 'normal'
        }
      }
    ]
  },
  canvasContextAttributes: {antialias: true}
});

// ---- Controls ----

const navigationControl = new maplibregl.NavigationControl({
  visualizePitch: true,
  visualizeRoll: true,
  showZoom: true,
  showCompass: true
});
const geolocateControl = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: false,
  showUserLocation: true,
  showAccuracyCircle: false
});
const scaleControl = new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 });
map.addControl(scaleControl, 'bottom-right');
map.addControl(new maplibregl.AttributionControl(), 'bottom-right');
map.addControl(navigationControl, 'bottom-right');
map.addControl(geolocateControl, 'bottom-right');

// ---- Settings panel ----

const controlsPanel = document.getElementById('controls');
const controlsToggleBtn = document.getElementById('controls-toggle');

function syncControlsToggleLabel() {
  controlsToggleBtn.textContent = controlsPanel.classList.contains('collapsed') ? '🌍 Settings ▸' : '🌍 Settings ▾';
}

function setControlsCollapsed(collapsed) {
  controlsPanel.classList.toggle('collapsed', collapsed);
  syncControlsToggleLabel();
}

controlsToggleBtn.addEventListener('click', () => {
  setControlsCollapsed(!controlsPanel.classList.contains('collapsed'));
});
syncControlsToggleLabel();

const advancedToggle = document.getElementById('advanced-toggle');
const advancedSection = document.getElementById('advanced-section');
advancedToggle.addEventListener('click', () => {
  const open = advancedSection.classList.toggle('open');
  advancedToggle.querySelector('.arrow').classList.toggle('open', open);
});

map.on('dragstart', () => {
  setControlsCollapsed(true);
});

// ---- Init search ----
initSearch(map);

// ---- Init web import ----
initWebImport();

// ---- Init tracks & profile ----
initTracks(map, state, updateProfile);
const tracksState = getTracksState();
initProfile(map, state, tracksState);
initSelectionTools(map, {
  getActiveTrack: () => tracksState.getActiveTrack(),
  onSelectionChanged: (selectionSpan) => {
    tracksState.setSelectionSpan(selectionSpan);
    syncOperationState();
  },
  onModeChanged: () => syncOperationState(),
  isSelectionBlocked: () => !tracksState.getActiveTrack(),
  keepSelectionCursor: () => Boolean(tracksState.editingTrackId),
  onAction: (action) => {
    if (action === 'simplify') simplifyBtn.click();
    else if (action === 'densify') densifyBtn.click();
    else if (action === 'split') splitBtn.click();
    else if (action === 'delete') {
      const sel = getCurrentSelection();
      if (sel?.trackId && sel.sourceIndices?.length) {
        const result = tracksState.deleteSelectionPoints(sel.trackId, sel.sourceIndices);
        if (result?.ok) {
          clearSelection();
          syncOperationState();
        }
      }
    }
  },
});

// Wire rectangle selection check into track-edit so vertex-adding is suppressed during rect selection
tracksState.wireRectangleSelectionCheck(isRectangleModeActive);

const selectionModeBtn = document.getElementById('selection-mode-btn');
const densifyBtn = document.getElementById('densify-btn');
const simplifyBtn = document.getElementById('simplify-btn');
const splitBtn = document.getElementById('split-btn');
const mergeBtn = document.getElementById('merge-btn');
const convertRouteBtn = document.getElementById('convert-route-btn');
const activeActionsBtn = document.getElementById('active-actions-btn');
const trackToolRow = document.getElementById('track-tool-row');

function getActiveGroupTrackIds() {
  const activeTrack = tracksState.getActiveTrack();
  if (!activeTrack?.groupId) return [];
  return tracksState.tracks.filter(track => track.groupId === activeTrack.groupId).map(track => track.id);
}

function showOperationError(result) {
  if (result?.ok !== false || !result.error) return;
  window.alert(result.error);
}

function syncOperationState() {
  const activeTrack = tracksState.getActiveTrack();
  const selectionSpan = tracksState.selectionSpan;
  const selectionContext = Boolean(selectionSpan?.ok && activeTrack && selectionSpan.trackId === activeTrack.id);
  const activeGroupTrackIds = getActiveGroupTrackIds();
  const canMergeGrouped = activeGroupTrackIds.length > 1;
  const isRoute = (activeTrack?.sourceKind || 'track') === 'route';
  const selectionBlocked = !activeTrack;

  if (selectionBlocked && isRectangleModeActive()) {
    setRectangleMode(false);
  }
  if (!selectionSpan?.ok) {
    setActionPreview('');
  }

  trackToolRow.classList.toggle('selection-context', selectionContext);

  if (activeActionsBtn) {
    activeActionsBtn.disabled = false;
    activeActionsBtn.title = activeTrack ? 'Actions for the selected item' : 'Workspace actions';
  }

  selectionModeBtn.disabled = selectionBlocked;
  selectionModeBtn.classList.toggle('active', isRectangleModeActive());

  densifyBtn.disabled = !activeTrack || isRoute;
  simplifyBtn.disabled = !activeTrack || isRoute;
  splitBtn.disabled = !activeTrack || isRoute;
  mergeBtn.disabled = !canMergeGrouped;
  convertRouteBtn.disabled = !isRoute;

  for (const button of [densifyBtn, simplifyBtn, splitBtn, mergeBtn, convertRouteBtn]) {
    button.classList.remove('selection-eligible', 'selection-dimmed');
  }

  if (selectionContext) {
    for (const button of [densifyBtn, simplifyBtn, splitBtn]) {
      if (!button.disabled) button.classList.add('selection-eligible');
    }
    for (const button of [mergeBtn, convertRouteBtn]) {
      if (!button.disabled) button.classList.add('selection-dimmed');
    }
  }
}

activeActionsBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  const rect = activeActionsBtn.getBoundingClientRect();
  openCurrentContextMenu(rect.left, rect.bottom + 2);
});

function promptSimplifyOptions() {
  const raw = window.prompt('Simplify tolerance in meters. Append ",dp" to use Douglas-Peucker.', '12');
  if (raw == null) return null;
  const [toleranceText, modeText] = raw.split(',').map(part => part.trim()).filter(Boolean);
  const horizontalTolerance = Number(toleranceText || raw);
  if (!Number.isFinite(horizontalTolerance) || horizontalTolerance <= 0) {
    window.alert('Enter a positive tolerance in meters.');
    return null;
  }
  return {
    horizontalTolerance,
    method: modeText?.toLowerCase() === 'dp' ? 'douglas-peucker' : 'visvalingam',
  };
}

function promptSplitOptions() {
  const selectionSpan = tracksState.selectionSpan;
  const defaultMode = selectionSpan?.ok && selectionSpan.pointCount === 1 ? 'point' : 'track';
  const raw = window.prompt('Split mode: point, track, or segment', defaultMode);
  if (raw == null) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'point') return { mode: 'at-point' };
  if (normalized === 'segment') return { mode: 'extract-segment' };
  if (normalized === 'track') return { mode: 'extract-track' };
  window.alert('Use one of: point, track, segment.');
  return null;
}

selectionModeBtn?.addEventListener('click', () => {
  if (!tracksState.getActiveTrack() || tracksState.editingTrackId) return;
  toggleRectangleMode();
  syncOperationState();
});

densifyBtn?.addEventListener('click', () => {
  const result = tracksState.densifyActiveTrackSpan({ maxGapMeters: 5 });
  showOperationError(result);
  syncOperationState();
});

simplifyBtn?.addEventListener('click', () => {
  const options = promptSimplifyOptions();
  if (!options) return;
  const result = tracksState.simplifyActiveTrackSpan(options);
  showOperationError(result);
  syncOperationState();
});

splitBtn?.addEventListener('click', () => {
  const options = promptSplitOptions();
  if (!options) return;
  const result = tracksState.splitActiveTrackSpan(options);
  showOperationError(result);
  clearSelection();
  syncOperationState();
});

mergeBtn?.addEventListener('click', () => {
  const activeGroupTrackIds = getActiveGroupTrackIds();
  if (activeGroupTrackIds.length < 2) {
    window.alert('Activate a grouped track with at least two sibling segments to merge.');
    return;
  }
  const result = tracksState.mergeSelectedTracks(activeGroupTrackIds, {
    mode: 'single-segment',
    name: tracksState.getActiveTrack()?.groupName || tracksState.getActiveTrack()?.name || 'Track',
  });
  showOperationError(result);
  clearSelection();
  syncOperationState();
});

convertRouteBtn?.addEventListener('click', () => {
  const replace = window.confirm('Replace the route instead of creating a sibling track?');
  const result = tracksState.convertActiveRouteToTrack({ replace });
  showOperationError(result);
  syncOperationState();
});

const previewBindings = [
  [selectionModeBtn, () => describeOperationConsequence('rectangle-selection', { selectionSpan: tracksState.selectionSpan })],
  [densifyBtn, () => describeOperationConsequence('densify', { selectionSpan: tracksState.selectionSpan })],
  [simplifyBtn, () => describeOperationConsequence('simplify', { selectionSpan: tracksState.selectionSpan })],
  [splitBtn, () => describeOperationConsequence('split', { selectionSpan: tracksState.selectionSpan })],
  [mergeBtn, () => describeOperationConsequence('merge', { trackCount: getActiveGroupTrackIds().length, mode: 'single-segment' })],
  [convertRouteBtn, () => describeOperationConsequence('route-to-track', { replace: false })],
];

for (const [button, describe] of previewBindings) {
  button?.addEventListener('mouseenter', () => setActionPreview(describe()));
  button?.addEventListener('mouseleave', () => setActionPreview(''));
  button?.addEventListener('focus', () => setActionPreview(describe()));
  button?.addEventListener('blur', () => setActionPreview(''));
}
syncOperationState();

// ---- Init shortcuts ----
initShortcuts();

// Ctrl/Cmd+P — toggle profile
registerShortcut({ key: 'p', ctrl: true, handler: () => {
  const profilePanel = document.getElementById('profile-panel');
  const t = tracksState.getActiveTrack();
  if (!t || t.coords.length < 2) return;
  const isVisible = profilePanel.classList.contains('visible');
  if (isVisible) {
    profilePanel.classList.remove('visible');
    tracksState.profileClosed = true;
  } else {
    profilePanel.classList.add('visible');
    tracksState.profileClosed = false;
  }
  tracksState.syncProfileToggleButton();
  tracksState.syncBottomRightOffset();
}});

// Ctrl/Cmd+L — toggle track list
registerShortcut({ key: 'l', ctrl: true, handler: () => {
  const trackPanel = document.getElementById('track-panel');
  const isVisible = trackPanel.classList.contains('visible');
  trackPanel.classList.toggle('visible', !isVisible);
  // sync shell state
  const shell = document.getElementById('track-panel-shell');
  shell.classList.toggle('visible', !isVisible);
  shell.classList.toggle('panel-surface', !isVisible);
}});

// N — new track
registerShortcut({ key: 'n', handler: () => {
  document.getElementById('draw-btn')?.click();
}});

// E — edit active track
registerShortcut({ key: 'e', handler: () => {
  document.getElementById('rail-edit-btn')?.click();
}});

// R — toggle rectangle selection
registerShortcut({ key: 'r', handler: () => {
  document.getElementById('selection-mode-btn')?.click();
}});

// Ctrl/Cmd+I — Info editor for active track
registerShortcut({ key: 'i', ctrl: true, handler: async () => {
  const activeId = tracksState.activeTrackId;
  if (!activeId) return;
  const { getWorkspace } = await import('./gpx-tree.js');
  const { walkNodes } = await import('./gpx-model.js');
  const ws = getWorkspace();
  let targetNodeId = null;
  walkNodes(ws.children, n => {
    if (targetNodeId) return;
    if (n._trackId === activeId || n._trackIds?.includes(activeId)) {
      targetNodeId = n.id;
    }
  });
  if (targetNodeId) openInfoEditor(targetNodeId);
}});

// Esc — exit edit mode / close panels
registerShortcut({ key: 'Escape', allowInInputs: false, handler: () => {
  if (tracksState.editingTrackId) {
    document.getElementById('rail-edit-btn')?.click();
  }
}});

// ---- Left edit rail wiring ----
{
  const railEditBtn = document.getElementById('rail-edit-btn');
  const railRectBtn = document.getElementById('rail-rect-btn');

  // Edit active track button
  railEditBtn?.addEventListener('click', () => {
    const t = tracksState.getActiveTrack();
    if (!t) return;
    if (tracksState.editingTrackId === t.id) {
      tracksState.exitEditMode();
    } else {
      tracksState.enterEditForTrack(t.id);
    }
    syncRailState();
  });

  // Rect select — delegates to selection-mode
  railRectBtn?.addEventListener('click', () => {
    document.getElementById('selection-mode-btn')?.click();
  });

  // Sync rail state periodically with track editing state
  function syncRailState() {
    const t = tracksState.getActiveTrack();
    railEditBtn.disabled = !t;
    railEditBtn.classList.toggle('active', Boolean(tracksState.editingTrackId));
    railRectBtn.disabled = !t;
    railRectBtn.classList.toggle('active', isRectangleModeActive());
    syncOperationState();
  }

  // Sync rail state on interval (lightweight)
  setInterval(syncRailState, 500);
}

// ---- Settings event handlers ----

document.getElementById('mode').addEventListener('change', (e) => {
  state.mode = e.target.value;
  updateLegend(state, map);
  applyModeState(map, state);
  syncViewToUrl(map, state);
  map.triggerRepaint();
  scheduleSettingsSave();
});

document.getElementById('basemap').addEventListener('change', (e) => {
  state.basemap = e.target.value;
  applyBasemapSelection(map, state, true);
  syncViewToUrl(map, state);
  map.triggerRepaint();
  scheduleSettingsSave();
});

document.getElementById('basemapOpacity').addEventListener('input', (e) => {
  state.basemapOpacity = Number(e.target.value);
  document.getElementById('basemapOpacityValue').textContent = state.basemapOpacity.toFixed(2);
  setGlobalStatePropertySafe(map, 'basemapOpacity', state.basemapOpacity);
  map.triggerRepaint();
  scheduleSettingsSave();
});

document.getElementById('hillshadeOpacity').addEventListener('input', (e) => {
  state.hillshadeOpacity = Number(e.target.value);
  document.getElementById('hillshadeOpacityValue').textContent = state.hillshadeOpacity.toFixed(2);
  setGlobalStatePropertySafe(map, 'hillshadeOpacity', state.hillshadeOpacity);
  map.triggerRepaint();
  scheduleSettingsSave();
});

document.getElementById('hillshadeMethod').addEventListener('change', (e) => {
  state.hillshadeMethod = e.target.value;
  if (map.getLayer('dem-loader')) {
    map.setPaintProperty('dem-loader', 'hillshade-method', state.hillshadeMethod);
  }
  map.triggerRepaint();
  scheduleSettingsSave();
});

document.getElementById('slopeOpacity').addEventListener('input', (e) => {
  state.slopeOpacity = Number(e.target.value);
  document.getElementById('slopeOpacityValue').textContent = state.slopeOpacity.toFixed(2);
  applyModeState(map, state);
  syncViewToUrl(map, state);
  map.triggerRepaint();
  scheduleSettingsSave();
});

document.getElementById('showContours').addEventListener('change', (e) => {
  state.showContours = Boolean(e.target.checked);
  applyContourVisibility(map, state);
  scheduleSettingsSave();
});

document.getElementById('showOpenSkiMap').addEventListener('change', (e) => {
  state.showOpenSkiMap = Boolean(e.target.checked);
  applyOpenSkiMapOverlay(map, state);
  scheduleSettingsSave();
});

document.getElementById('showSwisstopoSki').addEventListener('change', (e) => {
  state.showSwisstopoSki = Boolean(e.target.checked);
  applySwisstopoSkiOverlay(map, state);
  scheduleSettingsSave();
});

document.getElementById('showSwisstopoSlope').addEventListener('change', (e) => {
  state.showSwisstopoSlope = Boolean(e.target.checked);
  applySwisstopoSlopeOverlay(map, state);
  scheduleSettingsSave();
});

document.getElementById('showIgnSki').addEventListener('change', (e) => {
  state.showIgnSki = Boolean(e.target.checked);
  applyIgnSkiOverlay(map, state);
  scheduleSettingsSave();
});

document.getElementById('showIgnSlopes').addEventListener('change', (e) => {
  state.showIgnSlopes = Boolean(e.target.checked);
  applyIgnSlopesOverlay(map, state);
  scheduleSettingsSave();
});

document.getElementById('showTileGrid').addEventListener('change', (e) => {
  state.showTileGrid = Boolean(e.target.checked);
  if (map.getLayer('dem-debug-grid-line')) {
    map.setLayoutProperty('dem-debug-grid-line', 'visibility', state.showTileGrid ? 'visible' : 'none');
  }
  if (state.showTileGrid) {
    updateDebugGridSource(map);
  }
  map.triggerRepaint();
});

document.getElementById('multiplyBlend').addEventListener('change', (e) => {
  state.multiplyBlend = Boolean(e.target.checked);
  applyModeState(map, state);
  scheduleSettingsSave();
});

document.getElementById('cursorInfoMode').addEventListener('change', (e) => {
  state.cursorInfoMode = e.target.value;
  updateCursorInfoVisibility(state);
  scheduleSettingsSave();
});

document.getElementById('terrain3d').addEventListener('change', (e) => {
  state.terrain3d = Boolean(e.target.checked);
  document.getElementById('terrainExaggeration').disabled = !state.terrain3d;
  applyTerrainState(map, state);
  syncViewToUrl(map, state);
  map.triggerRepaint();
  scheduleSettingsSave();
});

document.getElementById('terrainExaggeration').addEventListener('input', (e) => {
  state.terrainExaggeration = Number(e.target.value);
  document.getElementById('terrainExaggerationValue').textContent = state.terrainExaggeration.toFixed(2);
  if (state.terrain3d) {
    applyTerrainState(map, state);
  }
  syncViewToUrl(map, state);
  map.triggerRepaint();
  scheduleSettingsSave();
});

document.getElementById('pauseThreshold').addEventListener('input', (e) => {
  state.pauseThreshold = Number(e.target.value);
  document.getElementById('pauseThresholdValue').textContent = state.pauseThreshold;
  updateProfile();
  scheduleSettingsSave();
});

document.getElementById('profileSmoothing').addEventListener('input', (e) => {
  state.profileSmoothing = Number(e.target.value);
  document.getElementById('profileSmoothingValue').textContent = state.profileSmoothing;
  updateProfile();
  scheduleSettingsSave();
});

document.getElementById('clear-data-btn').addEventListener('click', () => {
  if (confirm('Clear all saved tracks and settings?')) {
    clearPersistedData();
    location.reload();
  }
});

// Allow Cmd+drag (Mac) to act like Ctrl+drag for rotate/pitch
map.getCanvas().addEventListener('mousedown', (e) => {
  if (e.metaKey && !e.ctrlKey && e.button === 0) {
    const synth = new MouseEvent('mousedown', {
      bubbles: true, cancelable: true,
      clientX: e.clientX, clientY: e.clientY,
      button: e.button, buttons: e.buttons,
      ctrlKey: true, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: false
    });
    e.target.dispatchEvent(synth);
    e.preventDefault();
    e.stopPropagation();
  }
}, {capture: true});

updateLegend(state, map);
updateCursorInfoVisibility(state);

// ---- Map load ----

map.on('load', () => {
  ensureDebugGridLayer(map);
  setGlobalStatePropertySafe(map, 'basemapOpacity', state.basemapOpacity);
  setGlobalStatePropertySafe(map, 'hillshadeOpacity', state.hillshadeOpacity);
  applyBasemapSelection(map, state);
  applyOpenSkiMapOverlay(map, state);
  applySwisstopoSkiOverlay(map, state);
  applySwisstopoSlopeOverlay(map, state);
  applyIgnSkiOverlay(map, state);
  applyIgnSlopesOverlay(map, state);
  applyTerrainState(map, state);
  updateDebugGridSource(map);
  syncViewToUrl(map, state);
  map.on('moveend', () => {
    syncViewToUrl(map, state);
    if (state.showTileGrid) updateDebugGridSource(map);
  });
  map.on('zoomend', () => {
    syncViewToUrl(map, state);
    if (state.showTileGrid) updateDebugGridSource(map);
    if (state.mode === 'slope+relief') {
      applyModeState(map, state);
      updateLegend(state, map);
    }
  });
  map.on('rotateend', () => {
    syncViewToUrl(map, state);
  });
  map.on('pitchend', () => {
    syncViewToUrl(map, state);
  });
  // Terrain analysis layers are in the initial style (right after dem-loader)
  // — just apply the mode state to set correct visibility/opacity
  applyModeState(map, state);

  // Contour lines
  map.addLayer({
    id: 'contours',
    type: 'line',
    source: 'contourSource',
    'source-layer': 'contours',
    paint: {
      'line-opacity': 0.2,
      'line-width': ['match', ['get', 'level'], 1, 1, 0.5]
    }
  });
  map.addLayer({
    id: 'contour-text',
    type: 'symbol',
    source: 'contourSource',
    'source-layer': 'contours',
    filter: ['>', ['get', 'level'], 0],
    paint: {
      'text-halo-color': 'white',
      'text-halo-width': 1
    },
    layout: {
      'symbol-placement': 'line',
      'text-size': 10,
      'text-field': ['concat', ['number-format', ['get', 'ele'], {}], 'm'],
      'text-font': ['Noto Sans Bold']
    }
  });
  applyContourVisibility(map, state);

  // Elevation sampling on mousemove
  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const mobileCrosshair = document.getElementById('mobile-crosshair');
  const drawCrosshair = document.getElementById('draw-crosshair');
  let cursorRaf = 0;
  let lastPointerLngLat = null;
  let lastPointerScreenXY = null;

  // On mobile, always show center crosshair and update elevation from map center
  if (isMobile) {
    drawCrosshair.classList.add('visible');
    updateCursorInfoVisibility(state);
    map.on('move', () => {
      lastPointerLngLat = map.getCenter();
      const canvas = map.getCanvas();
      lastPointerScreenXY = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
      if (!cursorRaf) cursorRaf = requestAnimationFrame(updateCursorElevation);
    });
  }
  const updateCursorElevation = () => {
    cursorRaf = 0;
    if (!lastPointerLngLat) {
      setCursorInfo(state, null, 'n/a');
      hideCursorTooltip();
      return;
    }

    const result = queryLoadedElevationAtLngLat(map, lastPointerLngLat);
    if (!result) {
      setCursorInfo(state, lastPointerLngLat, 'no loaded tile');
      if (lastPointerScreenXY) showCursorTooltipAt(state, lastPointerScreenXY.x, lastPointerScreenXY.y, lastPointerLngLat, 'no tile', 'n/a');
      return;
    }

    const eleText = `${result.elevation.toFixed(0)} m`;
    const slopeStr = result.slopeDeg != null ? `${result.slopeDeg.toFixed(0)}°` : 'n/a';
    setCursorInfo(state, lastPointerLngLat, eleText, slopeStr);
    if (lastPointerScreenXY) showCursorTooltipAt(state, lastPointerScreenXY.x, lastPointerScreenXY.y, lastPointerLngLat, eleText, slopeStr);
  };

  map.on('mousemove', (e) => {
    lastPointerLngLat = e.lngLat;
    lastPointerScreenXY = {x: e.originalEvent.clientX, y: e.originalEvent.clientY};
    if (!cursorRaf) cursorRaf = requestAnimationFrame(updateCursorElevation);
  });

  map.on('mouseout', () => {
    lastPointerLngLat = null;
    lastPointerScreenXY = null;
    if (!cursorRaf) cursorRaf = requestAnimationFrame(updateCursorElevation);
  });

  // Map click for track selection
  map.on('click', (e) => {
    if (tracksState.editingTrackId) return;
    const layers = tracksState.tracks.map(t => 'track-line-' + t.id).filter(l => map.getLayer(l));
    if (layers.length === 0) return;
    const bbox = [[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]];
    const features = map.queryRenderedFeatures(bbox, { layers });
    if (features.length > 0) {
      const trackId = features[0].layer.id.replace('track-line-', '');
      tracksState.setActiveTrack(trackId);
      // Select in tree
      const pId = trackId; // In case trackId is passed
      setTimeout(() => {
        const treeRow = document.querySelector(`.tree-row[data-node-id]`);
        // The tree handles this in its own render cycle or via syncTreeSelection
        // Actually gpx-tree.js watches _deps.getActiveTrackId() => renders bold text, but doesn't select.
        // There is no exported selectNodeId method from gpxTreeState directly in main.js, 
        // but gpxTreeState exports something like openInfoEditor ? 
      }, 0);
    }
  });

  // Mobile: show crosshair on tap with elevation info
  if (isMobile) {
    map.on('click', (e) => {
      if (tracksState.editingTrackId) return;
      const result = queryLoadedElevationAtLngLat(map, e.lngLat);
      if (state.cursorInfoMode !== 'no') {
        mobileCrosshair.style.left = e.originalEvent.clientX + 'px';
        mobileCrosshair.style.top = e.originalEvent.clientY + 'px';
        mobileCrosshair.classList.add('visible');
        if (state.cursorInfoMode === 'cursor' && result) {
          const eleText = `${result.elevation.toFixed(0)} m`;
          const slopeStr = result.slopeDeg != null ? `${result.slopeDeg.toFixed(0)}°` : 'n/a';
          showCursorTooltipAt(state, e.originalEvent.clientX, e.originalEvent.clientY, eleText, slopeStr);
        }
      }
    });
    map.on('dragstart', () => {
      mobileCrosshair.classList.remove('visible');
      hideCursorTooltip();
    });
  }
});

// ---- Hashchange navigation ----

let hashNavInProgress = false;
window.addEventListener('hashchange', () => {
  if (hashNavInProgress) return;
  const p = parseHashParams();
  hashNavInProgress = true;
  map.jumpTo({center: p.center, zoom: p.zoom});
  state.basemap = p.basemap || 'osm';
  state.mode = p.mode;
  state.slopeOpacity = p.slopeOpacity;
  state.terrain3d = p.terrain3d;
  state.terrainExaggeration = p.terrainExaggeration;

  document.getElementById('basemap').value = state.basemap;
  document.getElementById('mode').value = state.mode;
  document.getElementById('slopeOpacity').value = String(state.slopeOpacity);
  document.getElementById('slopeOpacityValue').textContent = state.slopeOpacity.toFixed(2);
  document.getElementById('terrain3d').checked = state.terrain3d;
  document.getElementById('terrainExaggeration').value = String(state.terrainExaggeration);
  document.getElementById('terrainExaggeration').disabled = !state.terrain3d;
  document.getElementById('terrainExaggerationValue').textContent = state.terrainExaggeration.toFixed(2);

  updateLegend(state, map);
  map.setBearing(p.bearing);
  map.setPitch(p.pitch);
  applyBasemapSelection(map, state, true);
  applyModeState(map, state);
  applyTerrainState(map, state);
  hashNavInProgress = false;
  syncViewToUrl(map, state);
  map.triggerRepaint();
});

map.on('error', (e) => {
  console.error('Map error:', e && e.error ? e.error.message : e);
});

// ---- Expose key variables for E2E tests ----

Object.defineProperties(window, {
  mapReady:            { get() { return tracksState.mapReady; } },
  map:                 { get() { return map; } },
  tracks:              { get() { return tracksState.tracks; } },
  waypoints:           { get() { return tracksState.waypoints; } },
  activeTrackId:       { get() { return tracksState.activeTrackId; } },
  editingTrackId:      { get() { return tracksState.editingTrackId; } },
  selectedVertexIndex: { get() { return tracksState.selectedVertexIndex; } },
  insertAfterIdx:      { get() { return tracksState.insertAfterIdx; } },
  mobileFriendlyMode:  { get() { return tracksState.mobileFriendlyMode; } },
  importFileContent:   { get() { return importFileContent; } },
  profileChart:        { get() { return getProfileChart(); } },
  profileClosed:       { get() { return tracksState.profileClosed; } },
});


