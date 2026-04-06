// Entry point: creates map, imports modules, wires events.

import {
  DEM_HD_SOURCE_ID, DEM_MAX_Z, ANALYSIS_COLOR,
  DEM_TERRAIN_SOURCE_ID,
} from './constants.js';

import { createStore, STATE_DEFAULTS } from './state.js';

import {
  parseHashParams, syncViewToUrl, updateLegend,
  applyContourVisibility,
  applyTerrainState, applyModeState,
  basemapOpacityExpr, setGlobalStatePropertySafe, updateCursorInfoVisibility,
  setCursorInfo, showCursorTooltipAt, hideCursorTooltip,
  getVisibleTriplesForMap, initSearch,
} from './ui.js';

import { buildCatalogSources, buildCatalogLayers, getBasemaps, getOverlays, getCatalogEntry } from './layer-registry.js';
import {
  setBasemap, setOverlay, applyAllOverlays, applyLayerOrder, applyAllLayerSettings,
  syncLayerOrder, reorderLayer, applyLayerOpacity,
  createBookmark, applyBookmark, deleteBookmark, renameBookmark,
  migrateSettings,
} from './layer-engine.js';

import {
  queryLoadedElevationAtLngLat,
} from './dem.js';

import { initTracks, getTracksState, resetForTest } from './tracks.js';
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

function applyTestModeState(state) {
  state.basemap = 'none';
  state.mode = '';
  state.showContours = false;
  state.activeOverlays = [];
  state.layerOrder = [];
  state.terrain3d = false;
  state.hillshadeOpacity = 0;
}

function syncTestModeUi(state) {
  document.getElementById('basemap').value = state.basemap;
  document.getElementById('mode').value = state.mode;
  document.getElementById('terrain3d').checked = state.terrain3d;
  document.getElementById('terrainExaggeration').disabled = !state.terrain3d;
  document.getElementById('showContours').checked = state.showContours;
  // Overlay checkboxes are dynamic — sync them
  syncOverlayCheckboxes(state);
  document.getElementById('hillshadeOpacity').value = String(state.hillshadeOpacity);
  document.getElementById('hillshadeOpacityValue').textContent = state.hillshadeOpacity.toFixed(2);
}

function applyTestModeMapState(map, state) {
  if (map.getLayer('dem-loader')) {
    map.setLayoutProperty('dem-loader', 'visibility', 'none');
  }
  setGlobalStatePropertySafe(map, 'hillshadeOpacity', state.hillshadeOpacity);
  void setBasemap(map, state, state.basemap);
  applyAllOverlays(map, state);
  applyModeState(map, state);
  applyContourVisibility(map, state);
}

// ---- Initial view from URL hash + persisted settings ----

// Persisted settings as defaults, URL hash overrides
const persisted = loadSettings();
if (persisted) {
  // Migrate legacy per-overlay booleans → activeOverlays array
  migrateSettings(persisted);
  for (const k of Object.keys(persisted)) {
    if (persisted[k] !== undefined) state[k] = persisted[k];
  }
}

const initialView = parseHashParams();
const hasUrlState = window.location.hash.includes('=');
const isTestMode = Boolean(initialView.testMode);
const shouldAttemptInitialGeolocate = !isTestMode && !hasUrlState;
if (initialView.basemap) {
  state.basemap = initialView.basemap;
}
state.mode = initialView.mode;
state.slopeOpacity = initialView.slopeOpacity;
state.terrain3d = initialView.terrain3d;
state.terrainExaggeration = initialView.terrainExaggeration;
if (isTestMode) {
  applyTestModeState(state);
}
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
if (isTestMode) {
  syncTestModeUi(state);
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

function buildContourSourceDefinition() {
  return {
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
  };
}

function buildTerrainSourceDefinition() {
  return {
    type: 'raster-dem',
    tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
    tileSize: 512,
    maxzoom: DEM_MAX_Z,
    encoding: 'terrarium'
  };
}

function buildDemLoaderLayer() {
  return {
    id: 'dem-loader',
    type: 'hillshade',
    source: DEM_HD_SOURCE_ID,
    layout: { visibility: isTestMode ? 'none' : 'visible' },
    paint: {
      'hillshade-method': state.hillshadeMethod,
      'hillshade-exaggeration': ['coalesce', ['global-state', 'hillshadeOpacity'], 0.35],
      'hillshade-shadow-color': '#000000',
      'hillshade-highlight-color': '#ffffff',
      'hillshade-accent-color': '#000000',
    }
  };
}

function buildAnalysisLayer() {
  return {
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
  };
}

function buildAnalysisReliefLayer() {
  return {
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
  };
}

function buildAppStyle() {
  return {
    version: 8,
    glyphs: 'https://vectortiles.geo.admin.ch/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/sprite/sprite',
    sources: {
      contourSource: buildContourSourceDefinition(),
      // Separate raster-dem sources for terrain and
      // hillshade/analysis on purpose: in current MapLibre,
      // one source means one shared TileManager, and terrain changes shared DEM
      // tile selection/preparation toward coarser tiles for performance. A
      // larger shared tile cache does not isolate those different behaviors.
      [DEM_TERRAIN_SOURCE_ID]: buildTerrainSourceDefinition(),
      [DEM_HD_SOURCE_ID]: buildTerrainSourceDefinition(),
      ...buildCatalogSources(),
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#ffffff' }
      },
      buildDemLoaderLayer(),
      buildAnalysisLayer(),
      buildAnalysisReliefLayer(),
      ...buildCatalogLayers()
    ]
  };
}

function ensureSource(map, sourceId, sourceDefinition) {
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, sourceDefinition);
  }
}

function ensureLayer(map, layerDefinition, beforeId) {
  if (!map.getLayer(layerDefinition.id)) {
    map.addLayer(layerDefinition, beforeId);
  }
}

function ensureCatalogRuntimeLayers(map) {
  const sources = buildCatalogSources();
  for (const [sourceId, sourceDefinition] of Object.entries(sources)) {
    ensureSource(map, sourceId, sourceDefinition);
  }
  for (const layer of buildCatalogLayers()) {
    ensureLayer(map, layer, 'dem-loader');
  }
}

function ensureContourLayers(map) {
  ensureLayer(map, {
    id: 'contours',
    type: 'line',
    source: 'contourSource',
    'source-layer': 'contours',
    paint: {
      'line-opacity': 0.2,
      'line-width': ['match', ['get', 'level'], 1, 1, 0.5]
    }
  });
  ensureLayer(map, {
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
      'text-font': ['Frutiger Neue Regular']
    }
  });
}

function ensureAppRuntimeLayers(map) {
  ensureSource(map, 'contourSource', buildContourSourceDefinition());
  ensureSource(map, DEM_TERRAIN_SOURCE_ID, buildTerrainSourceDefinition());
  ensureSource(map, DEM_HD_SOURCE_ID, buildTerrainSourceDefinition());
  ensureLayer(map, buildDemLoaderLayer());
  ensureLayer(map, buildAnalysisLayer());
  ensureLayer(map, buildAnalysisReliefLayer());
  ensureCatalogRuntimeLayers(map);
  ensureContourLayers(map);
  ensureDebugGridLayer(map);
}

const map = new maplibregl.Map({
  container: 'map',
  center: initialView.center,
  zoom: initialView.zoom,
  bearing: initialView.bearing,
  pitch: initialView.pitch,
  maxTileCacheZoomLevels: 20,
  attributionControl: false,
  style: buildAppStyle(),
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
const controlsToggleBtn = document.getElementById('settings-controls-toggle');

function syncControlsToggleLabel() {
  controlsToggleBtn.classList.toggle('active', !controlsPanel.classList.contains('collapsed'));
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
const APP_STYLE_MODE = '__app_style__';
map.__activeStyleMode = APP_STYLE_MODE;
map.__nativeBasemapLayerIds = new Map();

map.__ensureBasemapStyle = async (catalogId) => {
  const entry = getCatalogEntry(catalogId);
  const targetMode = entry?.styleUrl ? entry.id : APP_STYLE_MODE;
  if (map.__activeStyleMode === targetMode) return;
  const styleReady = new Promise(resolve => map.once('style.load', resolve));
  map.__activeStyleMode = targetMode;
  map.setStyle(entry?.styleUrl ? entry.styleUrl : buildAppStyle());
  await styleReady;
};

map.on('style.load', () => {
  const entry = getCatalogEntry(state.basemap);
  if (entry?.styleUrl) {
    map.__nativeBasemapLayerIds.set(entry.id, (map.getStyle()?.layers || []).map(layer => layer.id));
  }
  ensureAppRuntimeLayers(map);
  tracksState.rehydrateTrackLayers();
  setGlobalStatePropertySafe(map, 'basemapOpacity', state.basemapOpacity);
  setGlobalStatePropertySafe(map, 'hillshadeOpacity', state.hillshadeOpacity);
  if (state.showTileGrid) updateDebugGridSource(map);
});

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
  if (!tracksState.getActiveTrack()) return;
  if (tracksState.editingTrackId) {
    tracksState.exitEditMode();
  }
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

document.getElementById('basemap').addEventListener('change', async (e) => {
  await setBasemap(map, state, e.target.value, true);
  // Auto-toggle contours for OSM
  const shouldShowContours = (state.basemap === 'osm');
  if (state.basemap !== 'none') state.showContours = shouldShowContours;
  const contourCb = document.getElementById('showContours');
  if (contourCb) contourCb.checked = state.showContours;
  applyContourVisibility(map, state);
  syncViewToUrl(map, state);
  map.triggerRepaint();
  scheduleSettingsSave();
});

document.getElementById('basemapOpacity').addEventListener('input', (e) => {
  state.basemapOpacity = Number(e.target.value);
  document.getElementById('basemapOpacityValue').textContent = state.basemapOpacity.toFixed(2);
  setGlobalStatePropertySafe(map, 'basemapOpacity', state.basemapOpacity);
  // Native-style basemaps need explicit opacity scaling; catalog layers use global-state
  if (map.__nativeBasemapLayerIds?.has(state.basemap)) {
    applyLayerOpacity(map, state.basemap, state.basemapOpacity);
  }
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

// Overlay toggle events are wired dynamically in renderOverlayList()

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

// ---- Dynamic layer UI ----

/** Populate basemap <select> from catalog */
function renderBasemapSelect() {
  const sel = document.getElementById('basemap');
  sel.innerHTML = '';
  for (const entry of getBasemaps()) {
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = entry.label;
    sel.appendChild(opt);
  }
  sel.value = state.basemap;
}

/** Populate overlay dropdown checkboxes from catalog */
function renderOverlayList() {
  const container = document.getElementById('overlay-list');
  if (!container) return;
  container.innerHTML = '';
  const active = new Set(state.activeOverlays);
  for (const entry of getOverlays()) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.overlayId = entry.id;
    cb.checked = active.has(entry.id);
    cb.addEventListener('change', () => {
      setOverlay(map, state, entry.id, cb.checked);
      renderLayerOrderPanel();
      renderBookmarkList();
      map.triggerRepaint();
      scheduleSettingsSave();
    });
    label.append(cb, ` ${entry.label}`);
    container.appendChild(label);
  }
}

/** Sync overlay checkbox state without re-rendering */
function syncOverlayCheckboxes(st) {
  const container = document.getElementById('overlay-list');
  if (!container) return;
  const active = new Set(st.activeOverlays);
  for (const cb of container.querySelectorAll('input[data-overlay-id]')) {
    cb.checked = active.has(cb.dataset.overlayId);
  }
}

/** Render the layer-order panel rows */
function renderLayerOrderPanel() {
  const container = document.getElementById('layer-order-list');
  if (!container) return;
  container.innerHTML = '';
  const order = state.layerOrder || [];
  const settings = state.layerSettings || {};

  for (let i = order.length - 1; i >= 0; i--) {
    const catalogId = order[i];
    const entry = getCatalogEntry(catalogId);
    if (!entry) continue;
    const s = settings[catalogId] || {};

    const row = document.createElement('div');
    row.className = 'layer-order-row';
    row.draggable = true;
    row.dataset.index = String(i);

    const handle = document.createElement('span');
    handle.className = 'layer-order-handle';
    handle.textContent = '☰';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'layer-order-name';
    nameSpan.textContent = entry.label;

    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '0';
    opacityInput.max = '1';
    opacityInput.step = '0.05';
    opacityInput.value = String(s.opacity != null ? s.opacity : 1);
    opacityInput.className = 'layer-order-opacity';
    opacityInput.title = 'Layer opacity';
    opacityInput.addEventListener('input', () => {
      const val = Number(opacityInput.value);
      if (!settings[catalogId]) state.layerSettings = { ...state.layerSettings, [catalogId]: {} };
      state.layerSettings[catalogId] = { ...state.layerSettings[catalogId], opacity: val };
      applyLayerOpacity(map, catalogId, val);
      map.triggerRepaint();
      scheduleSettingsSave();
    });

    row.append(handle, nameSpan, opacityInput);
    container.appendChild(row);

    // Drag-and-drop
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(i));
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const fromIdx = Number(e.dataTransfer.getData('text/plain'));
      // Visual order is reversed (top = last), convert back
      const toIdx = i;
      if (fromIdx !== toIdx) {
        reorderLayer(map, state, fromIdx, toIdx);
        renderLayerOrderPanel();
        map.triggerRepaint();
        scheduleSettingsSave();
      }
    });
  }

  if (order.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'layer-order-empty';
    empty.textContent = 'No active overlays';
    container.appendChild(empty);
  }
}

/** Render bookmark list */
function renderBookmarkList() {
  const container = document.getElementById('bookmark-list');
  if (!container) return;
  container.innerHTML = '';
  const bookmarks = state.bookmarks || [];

  for (const bm of bookmarks) {
    const row = document.createElement('div');
    row.className = 'bookmark-row';

    const nameBtn = document.createElement('button');
    nameBtn.className = 'bookmark-name';
    nameBtn.textContent = bm.name;
    nameBtn.title = 'Apply this bookmark';
    nameBtn.addEventListener('click', async () => {
      await applyBookmark(map, state, bm);
      document.getElementById('basemap').value = state.basemap;
      syncOverlayCheckboxes(state);
      renderLayerOrderPanel();
      renderBookmarkList();
      map.triggerRepaint();
      scheduleSettingsSave();
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'bookmark-edit';
    editBtn.textContent = '✎';
    editBtn.title = 'Rename';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = window.prompt('Bookmark name:', bm.name);
      if (newName != null && newName.trim()) {
        renameBookmark(state, bm.id, newName.trim());
        renderBookmarkList();
        scheduleSettingsSave();
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'bookmark-del';
    delBtn.textContent = '×';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteBookmark(state, bm.id);
      renderBookmarkList();
      scheduleSettingsSave();
    });

    row.append(nameBtn, editBtn, delBtn);
    container.appendChild(row);
  }
}

// Wire bookmark save button
document.getElementById('bookmark-save-btn')?.addEventListener('click', () => {
  createBookmark(state);
  renderBookmarkList();
  scheduleSettingsSave();
});

// Wire layer-order panel toggle
const layerOrderToggleBtn = document.getElementById('layer-order-toggle');
const layerOrderPanel = document.getElementById('layer-order-panel');
layerOrderToggleBtn?.addEventListener('click', () => {
  const isVisible = layerOrderPanel.classList.toggle('visible');
  layerOrderToggleBtn.classList.toggle('active', isVisible);
  if (isVisible) renderLayerOrderPanel();
});

// Wire overlay dropdown
const overlayToggleBtn = document.getElementById('overlay-toggle');
const overlayDropdown = document.getElementById('overlay-dropdown');
overlayToggleBtn?.addEventListener('click', () => {
  overlayDropdown.classList.toggle('visible');
});
document.addEventListener('click', (e) => {
  if (overlayDropdown && !overlayDropdown.contains(e.target) && e.target !== overlayToggleBtn) {
    overlayDropdown.classList.remove('visible');
  }
});

// Initial render of dynamic UI
renderBasemapSelect();
renderOverlayList();
renderBookmarkList();

// ---- Map load ----

map.on('load', async () => {
  setGlobalStatePropertySafe(map, 'basemapOpacity', state.basemapOpacity);
  setGlobalStatePropertySafe(map, 'hillshadeOpacity', state.hillshadeOpacity);
  ensureAppRuntimeLayers(map);
  tracksState.rehydrateTrackLayers();
  await setBasemap(map, state, state.basemap);
  syncLayerOrder(state);
  applyAllOverlays(map, state);
  applyAllLayerSettings(map, state);
  applyModeState(map, state);
  applyTerrainState(map, state);
  applyContourVisibility(map, state);
  if (state.showTileGrid) updateDebugGridSource(map);
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
  if (isTestMode) {
    applyTestModeMapState(map, state);
  }
  if (shouldAttemptInitialGeolocate) {
    window.setTimeout(() => {
      if (typeof geolocateControl.trigger === 'function') {
        geolocateControl.trigger();
      }
    }, 0);
  }

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
window.addEventListener('hashchange', async () => {
  if (hashNavInProgress) return;
  const p = parseHashParams();
  hashNavInProgress = true;
  map.jumpTo({center: p.center, zoom: p.zoom});
  state.basemap = p.basemap || 'osm';
  state.mode = p.mode;
  state.slopeOpacity = p.slopeOpacity;
  state.terrain3d = p.terrain3d;
  state.terrainExaggeration = p.terrainExaggeration;
  if (p.testMode) {
    applyTestModeState(state);
  }

  document.getElementById('basemap').value = state.basemap;
  document.getElementById('mode').value = state.mode;
  document.getElementById('slopeOpacity').value = String(state.slopeOpacity);
  document.getElementById('slopeOpacityValue').textContent = state.slopeOpacity.toFixed(2);
  document.getElementById('terrain3d').checked = state.terrain3d;
  document.getElementById('terrainExaggeration').value = String(state.terrainExaggeration);
  document.getElementById('terrainExaggeration').disabled = !state.terrain3d;
  document.getElementById('terrainExaggerationValue').textContent = state.terrainExaggeration.toFixed(2);
  if (p.testMode) {
    syncTestModeUi(state);
  }

  updateLegend(state, map);
  map.setBearing(p.bearing);
  map.setPitch(p.pitch);
  await setBasemap(map, state, state.basemap, true);
  applyAllOverlays(map, state);
  applyModeState(map, state);
  applyTerrainState(map, state);
  if (p.testMode) {
    applyTestModeMapState(map, state);
  }
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
  resetForTest:        { get() { return resetForTest; } },
});


