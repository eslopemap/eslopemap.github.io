// Entry point: creates map, imports modules, wires events.

import {
  DEM_SOURCE_ID, DEM_MAX_Z, ANALYSIS_COLOR, BASEMAP_LAYER_GROUPS,
} from './constants.js';

import { createStore, STATE_DEFAULTS } from './state.js';

import {
  parseHashParams, syncViewToUrl, updateStatus, updateLegend,
  applyBasemapSelection, applyContourVisibility, applyOpenSkiMapOverlay,
  applyTerrainState, applyModeState, computeEffectiveSlopeOpacity,
  basemapOpacityExpr, setGlobalStatePropertySafe, updateCursorInfoVisibility,
  setCursorInfo, showCursorTooltipAt, hideCursorTooltip,
  getVisibleTriplesForMap, initSearch,
} from './ui.js';

import {
  queryLoadedElevationAtLngLat, createHybridBorderLayer,
} from './dem.js';

import { initTracks, getTracksState } from './tracks.js';
import { initProfile, updateProfile, getProfileChart } from './profile.js';
import { importFileContent } from './io.js';
import { loadSettings, saveSettings, clearAll as clearPersistedData } from './persist.js';

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
  if (persisted.multiplyBlend != null) document.getElementById('multiplyBlend').checked = state.multiplyBlend;
  if (persisted.cursorInfoMode != null) document.getElementById('cursorInfoMode').value = state.cursorInfoMode;
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
        attribution: '&copy; OpenStreetMap contributors, OpenTopoMap'
      },
      ignplan: {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'],
        tileSize: 256,
        attribution: '&copy; IGN France'
      },
      swisstopo: {
        type: 'vector',
        tiles: ['https://vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/{z}/{x}/{y}.pbf'],
        attribution: '&copy; swisstopo'
      },
      openskimap: {
        type: 'vector',
        tiles: ['https://tiles.openskimap.org/openskimap/{z}/{x}/{y}.pbf'],
        attribution: '&copy; OpenSkiMap, OpenStreetMap contributors'
      },
      kartverket: {
        type: 'raster',
        tiles: ['https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png'],
        tileSize: 256,
        attribution: '&copy; Kartverket'
      },
      dem: {
        type: 'raster-dem',
        tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
        tileSize: 512,
        maxzoom: DEM_MAX_Z,
        encoding: 'terrarium'
      }
    },
    layers: [
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
        id: 'dem-loader',
        type: 'hillshade',
        source: DEM_SOURCE_ID,
        paint: {
          'hillshade-method': state.hillshadeMethod,
          'hillshade-exaggeration': ['coalesce', ['global-state', 'hillshadeOpacity'], 0.35],
          'hillshade-shadow-color': '#000000',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#000000',
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

// ---- Init tracks & profile ----
initTracks(map, state, updateProfile);
const tracksState = getTracksState();
initProfile(map, state, tracksState);

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
  map.triggerRepaint();
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
updateStatus(state);
updateCursorInfoVisibility(state);

// ---- Map load ----

map.on('load', () => {
  ensureDebugGridLayer(map);
  setGlobalStatePropertySafe(map, 'basemapOpacity', state.basemapOpacity);
  setGlobalStatePropertySafe(map, 'hillshadeOpacity', state.hillshadeOpacity);
  applyBasemapSelection(map, state);
  applyOpenSkiMapOverlay(map, state);
  applyTerrainState(map, state);
  updateDebugGridSource(map);
  syncViewToUrl(map, state);
  map.on('moveend', () => {
    syncViewToUrl(map, state);
    if (state.showTileGrid) updateDebugGridSource(map);
  });
  map.on('zoom', () => {
    if (state.mode === 'slope+relief') {
      computeEffectiveSlopeOpacity(state, map);
      map.triggerRepaint();
    }
  });
  map.on('zoomend', () => {
    syncViewToUrl(map, state);
    if (state.showTileGrid) updateDebugGridSource(map);
    if (state.mode === 'slope+relief') updateLegend(state, map);
  });
  map.on('rotateend', () => {
    syncViewToUrl(map, state);
  });
  map.on('pitchend', () => {
    syncViewToUrl(map, state);
  });
  const hybridLayer = createHybridBorderLayer(state, getVisibleTriplesForMap, () => updateStatus(state));
  map.addLayer(hybridLayer);
  map.addLayer({
    id: 'dem-color-relief',
    type: 'color-relief',
    source: DEM_SOURCE_ID,
    layout: {
      visibility: (state.mode === 'color-relief' || state.mode === 'slope+relief') ? 'visible' : 'none'
    },
    paint: {
      'color-relief-opacity': state.slopeOpacity,
      'color-relief-color': ANALYSIS_COLOR['color-relief']
    }
  });
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
  let cursorRaf = 0;
  let lastPointerLngLat = null;
  let lastPointerScreenXY = null;
  const updateCursorElevation = () => {
    cursorRaf = 0;
    if (!lastPointerLngLat) {
      setCursorInfo(state, 'n/a');
      hideCursorTooltip();
      return;
    }

    const result = queryLoadedElevationAtLngLat(map, lastPointerLngLat);
    if (!result) {
      setCursorInfo(state, 'no loaded tile');
      if (lastPointerScreenXY) showCursorTooltipAt(state, lastPointerScreenXY.x, lastPointerScreenXY.y, 'no tile', 'n/a');
      return;
    }

    const eleText = `${result.elevation.toFixed(0)} m`;
    const slopeStr = result.slopeDeg != null ? `${result.slopeDeg.toFixed(0)}°` : 'n/a';
    setCursorInfo(state, eleText, slopeStr);
    if (lastPointerScreenXY) showCursorTooltipAt(state, lastPointerScreenXY.x, lastPointerScreenXY.y, eleText, slopeStr);
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

  // Tile border fix: invalidate cached internal textures when new DEM tiles load
  let borderFixTimer = 0;
  const flushInternalTextures = () => {
    borderFixTimer = 0;
    const gl = map.painter && map.painter.context && map.painter.context.gl;
    if (gl) {
      for (const entry of hybridLayer.internalTextures.values()) {
        if (entry.texture) gl.deleteTexture(entry.texture);
      }
    }
    hybridLayer.internalTextures.clear();
    map.triggerRepaint();
  };

  map.on('data', (e) => {
    if (e.sourceId === DEM_SOURCE_ID && e.dataType === 'source') {
      if (!borderFixTimer) {
        borderFixTimer = setTimeout(flushInternalTextures, 100);
      }
    }
  });
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
  activeTrackId:       { get() { return tracksState.activeTrackId; } },
  editingTrackId:      { get() { return tracksState.editingTrackId; } },
  selectedVertexIndex: { get() { return tracksState.selectedVertexIndex; } },
  insertAfterIdx:      { get() { return tracksState.insertAfterIdx; } },
  mobileFriendlyMode:  { get() { return tracksState.mobileFriendlyMode; } },
  importFileContent:   { get() { return importFileContent; } },
  profileChart:        { get() { return getProfileChart(); } },
  profileClosed:       { get() { return tracksState.profileClosed; } },
});
