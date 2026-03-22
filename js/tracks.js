// Track data model, CRUD, map rendering, stats, panel UI.
// Editing interaction is in track-edit.js, import/export in io.js.

import { haversineKm } from './utils.js';
import { DEM_MAX_Z, DEM_SOURCE_ID, CORE_DIM, TRACK_COLORS } from './constants.js';
import { queryLoadedElevationAtLngLat } from './dem.js';
import { initTrackEdit, getEditState, isTrackEditing, enterEditMode, exitEditMode, startNewTrack } from './track-edit.js';
import { initIO, importFileContent } from './io.js';
import { saveTracks, loadTracks } from './persist.js';

let map, state;
let updateProfileFn = () => {};  // wired by initTracks

const tracks = [];
let activeTrackId = null;
let trackColorIdx = 0;
let mapReady = false;
let profileClosed = false;

// Debounced save to localStorage
let _saveTimer = 0;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveTracks(tracks), 300);
}

// DOM refs (resolved at init)
let tracksBtn, trackPanelShell, trackToolRow;
let trackPanel, trackPanelHeader, trackListEl, profileToggleBtn;

// ---- Helpers ----

const PROFILE_HOVER_SOURCE_ID = 'profile-hover-point';
const PROFILE_HOVER_LAYER_ID = 'profile-hover-point-layer';
const HOVER_INSERT_SOURCE_ID = 'hover-insert-point';
const HOVER_INSERT_LAYER_ID = 'hover-insert-point-layer';

function nextColor() {
  const c = TRACK_COLORS[trackColorIdx % TRACK_COLORS.length];
  trackColorIdx++;
  return c;
}

function invalidateTrackStats(t) {
  if (t) t._statsCache = null;
}

function invalidateAllTrackStats() {
  for (const t of tracks) invalidateTrackStats(t);
}

function elevationAt(lngLat) {
  const r = queryLoadedElevationAtLngLat(map, lngLat);
  return r ? Math.round(r.elevation * 10) / 10 : null;
}

function representativeTrackSampleSpacingMeters(coords, totalDistMeters) {
  if (!coords.length) return 4;
  const meanLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
  const nominal = (40075016.7 / Math.pow(2, DEM_MAX_Z) / CORE_DIM) * Math.max(0.25, Math.cos(meanLat * Math.PI / 180));
  return Math.max(2, nominal, totalDistMeters / 2000);
}

function interpolateTrackLngLat(coords, cumulativeMeters, targetMeters) {
  if (targetMeters <= 0) return {lng: coords[0][0], lat: coords[0][1]};
  const totalMeters = cumulativeMeters[cumulativeMeters.length - 1];
  if (targetMeters >= totalMeters) {
    const last = coords[coords.length - 1];
    return {lng: last[0], lat: last[1]};
  }

  let segIndex = 1;
  while (segIndex < cumulativeMeters.length && cumulativeMeters[segIndex] < targetMeters) segIndex++;
  const startMeters = cumulativeMeters[segIndex - 1];
  const endMeters = cumulativeMeters[segIndex];
  const spanMeters = endMeters - startMeters;
  const t = spanMeters > 0 ? (targetMeters - startMeters) / spanMeters : 0;
  const a = coords[segIndex - 1];
  const b = coords[segIndex];
  return {
    lng: a[0] + (b[0] - a[0]) * t,
    lat: a[1] + (b[1] - a[1]) * t
  };
}

function computeTerrainSlopeAlongTrack(coords, cumulativeMeters, totalDistMeters) {
  if (coords.length < 2 || totalDistMeters <= 0) {
    return {average: null, maximum: null, sampleCount: 0, resolvedCount: 0};
  }

  const spacingMeters = representativeTrackSampleSpacingMeters(coords, totalDistMeters);
  const sampleCount = Math.max(2, Math.ceil(totalDistMeters / spacingMeters) + 1);
  let sum = 0;
  let maximum = -Infinity;
  let resolvedCount = 0;

  for (let i = 0; i < sampleCount; i++) {
    const distanceMeters = sampleCount === 1 ? 0 : (i / (sampleCount - 1)) * totalDistMeters;
    const lngLat = interpolateTrackLngLat(coords, cumulativeMeters, distanceMeters);
    const sample = queryLoadedElevationAtLngLat(map, lngLat);
    if (!sample || !Number.isFinite(sample.slopeDeg)) continue;
    sum += sample.slopeDeg;
    maximum = Math.max(maximum, sample.slopeDeg);
    resolvedCount++;
  }

  return {
    average: resolvedCount ? sum / resolvedCount : null,
    maximum: resolvedCount ? maximum : null,
    sampleCount,
    resolvedCount
  };
}

function enrichElevation(coords) {
  for (const c of coords) {
    if (c[2] != null) continue;
    const e = elevationAt({lng: c[0], lat: c[1]});
    if (e != null) c[2] = e;
  }
}

function enrichAllTracks() {
  let anyUpdated = false;
  for (const t of tracks) {
    for (const c of t.coords) {
      if (c[2] != null) continue;
      const e = elevationAt({lng: c[0], lat: c[1]});
      if (e != null) { c[2] = e; anyUpdated = true; }
    }
  }
  if (anyUpdated) {
    invalidateAllTrackStats();
    refreshAllTrackSources();
    renderTrackList();
    updateProfileFn();
  }
}

// ---- Map sources & layers ----

function trackSourceId(t) { return 'track-' + t.id; }
function trackLineLayerId(t) { return 'track-line-' + t.id; }
function trackPtsLayerId(t) { return 'track-pts-' + t.id; }

function trackGeoJSON(t) {
  const features = [];
  if (t.coords.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: t.coords.map(c => c.slice()) },
      properties: { id: t.id }
    });
  }
  const last = t.coords.length - 1;
  for (let i = 0; i < t.coords.length; i++) {
    const role = i === 0 ? 'start' : i === last ? 'end' : 'mid';
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: t.coords[i].slice() },
      properties: { id: t.id, idx: i, role }
    });
  }
  return { type: 'FeatureCollection', features };
}

function addTrackToMap(t) {
  const isActive = ['==', ['get', 'id'], ['global-state', 'activeTrackId']];
  const isEditing = ['==', ['get', 'id'], ['global-state', 'editingTrackId']];
  const isStartOrEnd = ['any', ['==', ['get', 'role'], 'start'], ['==', ['get', 'role'], 'end']];
  const isSelected = ['all', isEditing, ['==', ['get', 'idx'], ['global-state', 'selectedVertexIdx']]];
  map.addSource(trackSourceId(t), { type: 'geojson', data: trackGeoJSON(t) });
  map.addLayer({
    id: trackLineLayerId(t), type: 'line', source: trackSourceId(t),
    filter: ['==', '$type', 'LineString'],
    paint: {
      'line-color': t.color,
      'line-width': ['case', isActive, 4, 3],
      'line-opacity': 0.9
    }
  });
  map.addLayer({
    id: trackPtsLayerId(t), type: 'circle', source: trackSourceId(t),
    filter: ['==', '$type', 'Point'],
    paint: {
      'circle-radius': ['case',
        isSelected, 7,
        ['all', isEditing, ['==', ['get', 'role'], 'mid']], 4,
        isEditing, 4,
        ['all', isActive, isStartOrEnd], 4,
        isStartOrEnd, 3,
        0],
      'circle-color': ['case',
        isSelected, '#4a90d9',
        ['match', ['get', 'role'],
          'start', '#22c55e', 'end', '#ef4444', t.color]],
      'circle-stroke-color': ['case', isSelected, '#fff', '#fff'],
      'circle-stroke-width': ['case',
        isSelected, 2.5,
        isEditing, 1.5,
        ['all', isActive, isStartOrEnd], 1.5,
        isStartOrEnd, 1,
        0]
    }
  });
}

function ensureProfileHoverLayer() {
  if (!map.getSource(PROFILE_HOVER_SOURCE_ID)) {
    map.addSource(PROFILE_HOVER_SOURCE_ID, {
      type: 'geojson',
      data: {type: 'FeatureCollection', features: []}
    });
  }
  if (!map.getLayer(PROFILE_HOVER_LAYER_ID)) {
    map.addLayer({
      id: PROFILE_HOVER_LAYER_ID,
      type: 'circle',
      source: PROFILE_HOVER_SOURCE_ID,
      paint: {
        'circle-radius': 7,
        'circle-color': ['coalesce', ['get', 'color'], '#4a90d9'],
        'circle-opacity': 0.95,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5
      }
    });
  }
  if (!map.getSource(HOVER_INSERT_SOURCE_ID)) {
    map.addSource(HOVER_INSERT_SOURCE_ID, {
      type: 'geojson',
      data: {type: 'FeatureCollection', features: []}
    });
  }
  if (!map.getLayer(HOVER_INSERT_LAYER_ID)) {
    map.addLayer({
      id: HOVER_INSERT_LAYER_ID,
      type: 'circle',
      source: HOVER_INSERT_SOURCE_ID,
      paint: {
        'circle-radius': 5,
        'circle-color': 'rgba(128,128,128,0.5)',
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1
      }
    });
  }
  const INSERT_PREVIEW_SOURCE_ID = 'insert-preview-line';
  const INSERT_PREVIEW_LAYER_ID = 'insert-preview-line-layer';
  if (!map.getSource(INSERT_PREVIEW_SOURCE_ID)) {
    map.addSource(INSERT_PREVIEW_SOURCE_ID, {
      type: 'geojson',
      data: {type: 'FeatureCollection', features: []}
    });
  }
  if (!map.getLayer(INSERT_PREVIEW_LAYER_ID)) {
    map.addLayer({
      id: INSERT_PREVIEW_LAYER_ID,
      type: 'line',
      source: INSERT_PREVIEW_SOURCE_ID,
      paint: {
        'line-color': 'rgba(74,144,217,0.6)',
        'line-width': 2,
        'line-dasharray': [4, 4]
      }
    });
  }
}

function removeTrackFromMap(t) {
  if (map.getLayer(trackPtsLayerId(t))) map.removeLayer(trackPtsLayerId(t));
  if (map.getLayer(trackLineLayerId(t))) map.removeLayer(trackLineLayerId(t));
  if (map.getSource(trackSourceId(t))) map.removeSource(trackSourceId(t));
}

function refreshTrackSource(t) {
  const src = map.getSource(trackSourceId(t));
  if (src) src.setData(trackGeoJSON(t));
}

function refreshAllTrackSources() {
  for (const t of tracks) refreshTrackSource(t);
}

function updateVertexHighlight(editingId, selIdx) {
  map.setGlobalStateProperty('activeTrackId', activeTrackId);
  map.setGlobalStateProperty('editingTrackId', editingId != null ? editingId : null);
  map.setGlobalStateProperty('selectedVertexIdx', selIdx != null ? selIdx : -1);
}

// ---- Panel/UI sync ----

function syncProfileToggleButton() {
  const t = getActiveTrack();
  const profilePanel = document.getElementById('profile-panel');
  const canShow = Boolean(t && t.coords.length >= 2);
  profileToggleBtn.disabled = !canShow;
  const isVisible = canShow && profilePanel.classList.contains('visible') && !profileClosed;
  profileToggleBtn.classList.toggle('active', isVisible);
  profileToggleBtn.textContent = isVisible ? 'Profile' : 'Show Profile';
}

function syncTrackPanelShell() {
  const isVisible = trackPanel.classList.contains('visible');
  const hasTracks = tracks.length > 0;
  const toolRowParent = isVisible ? trackPanelHeader : trackPanelShell;
  const toolRowNextSibling = isVisible ? null : trackPanel;
  if (trackToolRow.parentElement !== toolRowParent) {
    toolRowParent.insertBefore(trackToolRow, toolRowNextSibling);
  }
  trackPanelShell.classList.toggle('visible', isVisible);
  trackPanelShell.classList.toggle('panel-surface', isVisible);
  tracksBtn.disabled = !hasTracks;
  tracksBtn.classList.toggle('active', isVisible && hasTracks);
  tracksBtn.textContent = isVisible && hasTracks ? '×' : '📍';
  tracksBtn.title = hasTracks ? (isVisible ? 'Close tracks' : 'Track list') : 'No tracks';
}

function setTrackPanelVisible(visible) {
  trackPanel.classList.toggle('visible', visible && tracks.length > 0);
  syncTrackPanelShell();
}

// ---- Track stats ----

function trackStats(t) {
  if (!t || t.coords.length < 2) return null;
  if (t._statsCache) return t._statsCache;

  const coords = t.coords;
  let dist = 0, gain = 0, loss = 0;
  let weightedSlopeSum = 0;
  let weightedSlopeDist = 0;
  const cumulativeMeters = [0];
  for (let i = 1; i < coords.length; i++) {
    const segKm = haversineKm(coords[i - 1], coords[i]);
    const segMeters = segKm * 1000;
    dist += segKm;
    cumulativeMeters.push(cumulativeMeters[i - 1] + segMeters);
    if (coords[i][2] != null && coords[i-1][2] != null) {
      const dh = coords[i][2] - coords[i-1][2];
      if (dh > 0) gain += dh; else loss -= dh;
      if (segMeters > 0) {
        weightedSlopeSum += Math.atan2(Math.abs(dh), segMeters) * 180 / Math.PI * segMeters;
        weightedSlopeDist += segMeters;
      }
    }
  }
  const terrainSlopeAlongTrack = computeTerrainSlopeAlongTrack(coords, cumulativeMeters, dist * 1000);
  const segmentMaxSlope = weightedSlopeDist > 0
    ? coords.reduce((maxSlope, _coord, index) => {
      if (index === 0) return maxSlope;
      const segMeters = cumulativeMeters[index] - cumulativeMeters[index - 1];
      if (segMeters <= 0 || coords[index][2] == null || coords[index - 1][2] == null) return maxSlope;
      const dh = coords[index][2] - coords[index - 1][2];
      const slopeDeg = Math.atan2(Math.abs(dh), segMeters) * 180 / Math.PI;
      return Math.max(maxSlope, slopeDeg);
    }, -Infinity)
    : null;
  const maxTerrainSlope = terrainSlopeAlongTrack.maximum != null
    ? terrainSlopeAlongTrack.maximum
    : (segmentMaxSlope != null && Number.isFinite(segmentMaxSlope) ? segmentMaxSlope : null);
  t._statsCache = {
    dist,
    gain,
    loss,
    avgSlope: weightedSlopeDist > 0 ? weightedSlopeSum / weightedSlopeDist : null,
    terrainSlopeAlongTrack: terrainSlopeAlongTrack.average,
    maxTerrainSlope,
    terrainSlopeResolvedCount: terrainSlopeAlongTrack.resolvedCount,
    terrainSlopeSampleCount: terrainSlopeAlongTrack.sampleCount
  };
  return t._statsCache;
}

// ---- Track list rendering ----

function renderTrackList() {
  trackListEl.innerHTML = '';
  for (const t of tracks) {
    const div = document.createElement('div');
    div.className = 'track-item' + (t.id === activeTrackId ? ' active' : '');
    const s = t.coords.length >= 2 ? trackStats(t) : null;
    const statsStr = s ? `${s.dist.toFixed(1)} km · ↑${Math.round(s.gain)} m · ↓${Math.round(s.loss)} m · ${t.coords.length} pts` : `${t.coords.length} pts`;
    const detailStatsStr = (s && t.id === activeTrackId)
      ? `Avg slope: ${s.avgSlope != null ? `${s.avgSlope.toFixed(1)}°` : 'n/a'} · Max slope: ${s.maxTerrainSlope != null ? `${s.maxTerrainSlope.toFixed(1)}°` : 'n/a'}`
      : '';
    const editActive = isTrackEditing(t.id);
    div.innerHTML = `<span class="track-color" style="background:${t.color}"></span>` +
      `<span class="track-name">${t.name}` +
      (statsStr ? `<br><span class="track-stats">${statsStr}</span>` : '') +
      (detailStatsStr ? `<br><span class="track-stats">${detailStatsStr}</span>` : '') +
      `</span>` +
      `<button class="track-edit${editActive ? ' active' : ''}" data-id="${t.id}" title="Edit track">&#9998;</button>` +
      `<button class="track-del" data-id="${t.id}">&times;</button>`;
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('track-del') || e.target.classList.contains('track-edit')) return;
      setActiveTrack(t.id);
    });
    div.querySelector('.track-edit').addEventListener('click', () => {
      if (isTrackEditing(t.id)) exitEditMode();
      else { setActiveTrack(t.id); enterEditMode(t.id); }
    });
    div.querySelector('.track-del').addEventListener('click', () => deleteTrack(t.id));
    trackListEl.appendChild(div);
  }
  if (!tracks.length) setTrackPanelVisible(false);
  else syncTrackPanelShell();
  syncProfileToggleButton();
  const es = getEditState();
  es.syncUndoBtn();
}

// ---- Active track ----

function setActiveTrack(id) {
  if (id !== activeTrackId) profileClosed = false;
  const es = getEditState();
  if (es.editingTrackId && es.editingTrackId !== id) exitEditMode();
  activeTrackId = id;
  renderTrackList();
  updateVertexHighlight(es.editingTrackId, es.selectedVertexIndex);
  updateProfileFn();
}

function deleteTrack(id) {
  const t = tracks.find(tr => tr.id === id);
  if (!t) return;
  if (!confirm(`Delete track "${t.name}"?`)) return;
  const idx = tracks.indexOf(t);
  const es = getEditState();
  if (es.editingTrackId === id) exitEditMode();
  removeTrackFromMap(t);
  tracks.splice(idx, 1);
  if (activeTrackId === id) activeTrackId = tracks.length ? tracks[tracks.length - 1].id : null;
  renderTrackList();
  updateVertexHighlight(es.editingTrackId, es.selectedVertexIndex);
  scheduleSave();
}

function createTrack(name, coords) {
  const t = { id: 'trk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), name, color: nextColor(), coords, _statsCache: null };
  enrichElevation(t.coords);
  tracks.push(t);
  if (mapReady) addTrackToMap(t);
  setTrackPanelVisible(true);
  setActiveTrack(t.id);
  scheduleSave();
  return t;
}

function getActiveTrack() {
  return tracks.find(t => t.id === activeTrackId) || null;
}

function fitToTrack(t) {
  if (t.coords.length < 1) return;
  const bounds = t.coords.reduce(
    (b, c) => b.extend([c[0], c[1]]),
    new maplibregl.LngLatBounds()
  );
  map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 1000 });
}

// ---- Callbacks from track-edit.js ----

function onTrackCoordsChanged(t) {
  invalidateTrackStats(t);
  refreshTrackSource(t);
  renderTrackList();
  updateProfileFn();
  scheduleSave();
}

function invalidateAndRefresh(t) {
  invalidateTrackStats(t);
  refreshTrackSource(t);
}

function removeIncompleteNewTrack(t) {
  const idx = tracks.indexOf(t);
  if (idx >= 0) {
    removeTrackFromMap(t);
    tracks.splice(idx, 1);
    if (activeTrackId === t.id) activeTrackId = tracks.length ? tracks[tracks.length - 1].id : null;
    scheduleSave();
  }
}

function createNewTrack() {
  return createTrack('Track ' + (tracks.length + 1), []);
}

// ---- Public API ----

export function getTracksState() {
  const es = getEditState();
  return {
    tracks,
    get activeTrackId() { return activeTrackId; },
    get editingTrackId() { return es.editingTrackId; },
    get selectedVertexIndex() { return es.selectedVertexIndex; },
    get insertAfterIdx() { return es.insertAfterIdx; },
    get mobileFriendlyMode() { return es.mobileFriendlyMode; },
    get mapReady() { return mapReady; },
    get profileClosed() { return profileClosed; },
    set profileClosed(v) { profileClosed = v; },
    getActiveTrack,
    ensureProfileHoverLayer,
    PROFILE_HOVER_SOURCE_ID,
    syncProfileToggleButton,
    syncBottomRightOffset() {
      document.body.classList.toggle('profile-open', document.getElementById('profile-panel').classList.contains('visible'));
    },
  };
}

// ---- Init: wire up all event listeners ----

export function initTracks(mapRef, stateRef, updateProfile) {
  map = mapRef;
  state = stateRef;
  updateProfileFn = updateProfile;

  tracksBtn = document.getElementById('tracks-btn');
  trackPanelShell = document.getElementById('track-panel-shell');
  trackToolRow = document.getElementById('track-tool-row');
  trackPanel = document.getElementById('track-panel');
  trackPanelHeader = trackPanel.querySelector('.track-panel-header');
  trackListEl = document.getElementById('track-list');
  profileToggleBtn = document.getElementById('profile-toggle-btn');

  syncTrackPanelShell();

  // Restore saved tracks
  const saved = loadTracks();
  for (const st of saved) {
    if (!st.coords || !st.coords.length) continue;
    const t = {
      id: 'trk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: st.name || 'Track',
      color: st.color || nextColor(),
      coords: st.coords,
      _statsCache: null,
    };
    tracks.push(t);
  }
  if (tracks.length) {
    activeTrackId = tracks[tracks.length - 1].id;
    setTrackPanelVisible(true);
    renderTrackList();
  }

  // Init the editing module
  initTrackEdit(mapRef, stateRef, updateProfile, {
    findTrack: (id) => tracks.find(tr => tr.id === id),
    getActiveTrack,
    createNewTrack,
    deleteTrack,
    removeIncompleteNewTrack,
    onTrackCoordsChanged,
    invalidateAndRefresh,
    refreshTrackSource,
    renderTrackList,
    updateVertexHighlight,
    trackPtsLayerId,
    elevationAt,
  });

  // Re-enrich when new DEM tiles load
  map.on('data', (e) => {
    if (e.sourceId === DEM_SOURCE_ID && e.dataType === 'source' && tracks.length) {
      invalidateAllTrackStats();
      setTimeout(() => {
        enrichAllTracks();
        renderTrackList();
      }, 200);
    }
  });

  tracksBtn.addEventListener('click', () => {
    setTrackPanelVisible(!trackPanel.classList.contains('visible'));
  });

  // Init the IO module (drag-drop, export buttons)
  initIO({
    createTrack,
    getActiveTrack,
    getTracks: () => tracks,
    fitToTrack,
  });

  // Add map layers for tracks once map is loaded
  map.on('load', () => {
    mapReady = true;
    ensureProfileHoverLayer();
    for (const t of tracks) {
      if (!map.getSource(trackSourceId(t))) addTrackToMap(t);
    }
  });
}
