// Track editor: CRUD, vertex editing, import/export, drag/drop, mobile.

import { haversineKm, downloadFile } from './utils.js';
import { DEM_MAX_Z, DEM_SOURCE_ID, CORE_DIM, TRACK_COLORS } from './constants.js';
import { queryLoadedElevationAtLngLat } from './dem.js';
import { showCursorTooltipAt, hideCursorTooltip } from './ui.js';

let map, state;
let updateProfileFn = () => {};  // wired by initTracks

const tracks = [];
let activeTrackId = null;
let editingTrackId = null;
let editingIsNewTrack = false;
let dragVertexInfo = null;
let mobileSelectedVertex = null;
let suppressNextMapClick = false;
let hoverInsertInfo = null;
let selectedVertexIndex = null;
let insertAfterIdx = null;
let trackColorIdx = 0;
let mapReady = false;
let insertPopupMarker = null;
let insertPreviewLngLat = null;
let profileClosed = false;

const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
let mobileFriendlyMode = isMobile;

// DOM refs (resolved at init)
let drawBtn, tracksBtn, undoBtn, mobileModeBtn, trackPanelShell, trackToolRow;
let trackPanel, trackPanelHeader, trackListEl, profileToggleBtn;
let dropOverlay, mobileHint, toastEl, drawCrosshair, mobileCrosshair;

let toastTimer = 0;
function showToast(msg, durationMs) {
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), durationMs || 2500);
}

// ---- Helpers ----

const PROFILE_HOVER_SOURCE_ID = 'profile-hover-point';
const PROFILE_HOVER_LAYER_ID = 'profile-hover-point-layer';
const HOVER_INSERT_SOURCE_ID = 'hover-insert-point';
const HOVER_INSERT_LAYER_ID = 'hover-insert-point-layer';

function isTrackEditing(tId) {
  return tId != null && tId === editingTrackId;
}

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

function clearHoverInsertMarker() {
  hoverInsertInfo = null;
  const src = map.getSource(HOVER_INSERT_SOURCE_ID);
  if (src) src.setData({type: 'FeatureCollection', features: []});
}

function showHoverInsertMarker(lngLat) {
  const src = map.getSource(HOVER_INSERT_SOURCE_ID);
  if (src) {
    src.setData({type: 'FeatureCollection', features: [{
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [lngLat.lng, lngLat.lat]},
      properties: {}
    }]});
  }
}

function updateInsertPreview() {
  const src = map.getSource('insert-preview-line');
  if (!src) return;
  const t = editingTrackId ? tracks.find(tr => tr.id === editingTrackId) : null;
  if (!t || !t.coords.length) { src.setData({type: 'FeatureCollection', features: []}); return; }

  let target = insertPreviewLngLat;
  if (mobileFriendlyMode && editingTrackId) {
    const center = map.getCenter();
    target = { lng: center.lng, lat: center.lat };
  }
  if (!target) { src.setData({type: 'FeatureCollection', features: []}); return; }

  const features = [];
  const tCoord = [target.lng, target.lat];

  if (insertAfterIdx != null && insertAfterIdx < t.coords.length) {
    const prev = t.coords[insertAfterIdx];
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[prev[0], prev[1]], tCoord] },
      properties: {}
    });
    if (insertAfterIdx + 1 < t.coords.length) {
      const next = t.coords[insertAfterIdx + 1];
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [tCoord, [next[0], next[1]]] },
        properties: {}
      });
    }
  } else if (t.coords.length > 0) {
    const last = t.coords[t.coords.length - 1];
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[last[0], last[1]], tCoord] },
      properties: {}
    });
  }
  src.setData({ type: 'FeatureCollection', features });
}

function findClosestPointOnTrack(t, mousePoint) {
  if (!t || t.coords.length < 2) return null;
  let bestDist = Infinity;
  let bestLngLat = null;
  let bestSegment = -1;
  for (let i = 0; i < t.coords.length - 1; i++) {
    const a = map.project([t.coords[i][0], t.coords[i][1]]);
    const b = map.project([t.coords[i+1][0], t.coords[i+1][1]]);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let tp = 0;
    if (len2 > 0) {
      tp = ((mousePoint.x - a.x) * dx + (mousePoint.y - a.y) * dy) / len2;
      tp = Math.max(0, Math.min(1, tp));
    }
    if (tp < 0.1 || tp > 0.9) continue;
    const px = a.x + tp * dx, py = a.y + tp * dy;
    const dist = Math.sqrt((mousePoint.x - px) ** 2 + (mousePoint.y - py) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestLngLat = map.unproject([px, py]);
      bestSegment = i;
    }
  }
  if (bestDist < 20 && bestSegment >= 0) {
    return { lngLat: bestLngLat, insertAfter: bestSegment, distance: bestDist };
  }
  return null;
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

function updateVertexHighlight() {
  map.setGlobalStateProperty('activeTrackId', activeTrackId);
  map.setGlobalStateProperty('editingTrackId', editingTrackId);
  map.setGlobalStateProperty('selectedVertexIdx', selectedVertexIndex != null ? selectedVertexIndex : -1);
}

// ---- Insert popup ----

function updateInsertPopup() {
  const t = editingTrackId ? tracks.find(tr => tr.id === editingTrackId) : null;
  if (!t || selectedVertexIndex == null || selectedVertexIndex >= t.coords.length) {
    removeInsertPopup();
    return;
  }
  const coord = t.coords[selectedVertexIndex];
  const lngLat = [coord[0], coord[1]];
  if (!insertPopupMarker) {
    const el = document.createElement('div');
    el.className = 'vertex-insert-popup';
    el.innerHTML = '<button class="insert-popup-btn" title="Insert points after this vertex">+</button>';
    el.querySelector('.insert-popup-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (insertAfterIdx != null) {
        insertAfterIdx = null;
      } else if (selectedVertexIndex != null) {
        insertAfterIdx = selectedVertexIndex;
      }
      syncUndoBtn();
    });
    insertPopupMarker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [8, 0] })
      .setLngLat(lngLat)
      .addTo(map);
  } else {
    insertPopupMarker.setLngLat(lngLat);
  }
  const btn = insertPopupMarker.getElement().querySelector('.insert-popup-btn');
  if (btn) btn.classList.toggle('active', insertAfterIdx != null);
}

function removeInsertPopup() {
  if (insertPopupMarker) {
    insertPopupMarker.remove();
    insertPopupMarker = null;
  }
}

// ---- Panel/UI sync ----

function syncUndoBtn() {
  const t = getActiveTrack ? getActiveTrack() : null;
  const show = t && t.coords.length > 0 && isTrackEditing(t.id);
  undoBtn.style.display = show ? '' : 'none';
  mobileModeBtn.style.display = ((isMobile || isLocalhost) && show) ? '' : 'none';
  mobileModeBtn.classList.toggle('active', mobileFriendlyMode);
  updateVertexHighlight();
  updateInsertPopup();
  updateInsertPreview();
}

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
  syncUndoBtn();
}

// ---- Active track / edit mode ----

function setActiveTrack(id) {
  if (id !== activeTrackId) profileClosed = false;
  if (editingTrackId && editingTrackId !== id) exitEditMode();
  activeTrackId = id;
  renderTrackList();
  updateVertexHighlight();
  updateProfileFn();
}

function enterEditMode(tId) {
  if (editingTrackId && editingTrackId !== tId) exitEditMode();
  editingTrackId = tId;
  selectedVertexIndex = null;
  insertAfterIdx = null;
  map.getCanvas().style.cursor = 'crosshair';
  drawBtn.classList.add('active');
  updateVertexHighlight();
  renderTrackList();
  syncUndoBtn();
  if (mobileFriendlyMode) {
    drawCrosshair.classList.add('visible');
    showToast('Tap anywhere to add a point at center', 3000);
  }
}

function exitEditMode() {
  const wasNewTrack = editingIsNewTrack;
  editingIsNewTrack = false;
  selectedVertexIndex = null;
  insertAfterIdx = null;
  removeInsertPopup();
  drawBtn.classList.remove('active');
  setDefaultMapCursor();
  drawCrosshair.classList.remove('visible');
  if (mobileSelectedVertex) cancelMobileMove();
  const t = editingTrackId ? tracks.find(tr => tr.id === editingTrackId) : null;
  if (wasNewTrack && t && t.coords.length < 2) {
    const idx = tracks.indexOf(t);
    if (idx >= 0) {
      removeTrackFromMap(t);
      tracks.splice(idx, 1);
      if (activeTrackId === t.id) activeTrackId = tracks.length ? tracks[tracks.length - 1].id : null;
    }
  } else if (t) {
    updateProfileFn();
  }
  editingTrackId = null;
  clearHoverInsertMarker();
  updateVertexHighlight();
  renderTrackList();
  syncUndoBtn();
}

function deleteTrack(id) {
  const t = tracks.find(tr => tr.id === id);
  if (!t) return;
  if (!confirm(`Delete track "${t.name}"?`)) return;
  const idx = tracks.indexOf(t);
  if (editingTrackId === id) exitEditMode();
  removeTrackFromMap(t);
  tracks.splice(idx, 1);
  if (activeTrackId === id) activeTrackId = tracks.length ? tracks[tracks.length - 1].id : null;
  renderTrackList();
  updateVertexHighlight();
}

function createTrack(name, coords) {
  const t = { id: 'trk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), name, color: nextColor(), coords, _statsCache: null };
  enrichElevation(t.coords);
  tracks.push(t);
  if (mapReady) addTrackToMap(t);
  setTrackPanelVisible(true);
  setActiveTrack(t.id);
  return t;
}

function getActiveTrack() {
  return tracks.find(t => t.id === activeTrackId) || null;
}

function setDefaultMapCursor() {
  if (!editingTrackId) map.getCanvas().style.cursor = 'cell';
}

function startNewTrack() {
  if (editingTrackId) exitEditMode();
  editingIsNewTrack = true;
  const t = createTrack('Track ' + (tracks.length + 1), []);
  enterEditMode(t.id);
}

function hitTestVertex(point) {
  const tId = editingTrackId;
  if (!tId) return null;
  const t = tracks.find(tr => tr.id === tId);
  if (!t) return null;
  const layerId = trackPtsLayerId(t);
  if (!map.getLayer(layerId)) return null;
  const r = 12;
  const features = map.queryRenderedFeatures(
    [[point.x - r, point.y - r], [point.x + r, point.y + r]],
    { layers: [layerId] }
  );
  if (!features.length) return null;
  const real = features.find(f => f.properties.idx != null);
  if (real) return { trackId: t.id, index: real.properties.idx };
  return null;
}

function cancelMobileMove() {
  mobileSelectedVertex = null;
  mobileHint.classList.remove('visible');
  map.dragPan.enable();
  const t = getActiveTrack();
  if (t) { renderTrackList(); updateProfileFn(); syncUndoBtn(); }
}

function fitToTrack(t) {
  if (t.coords.length < 1) return;
  const bounds = t.coords.reduce(
    (b, c) => b.extend([c[0], c[1]]),
    new maplibregl.LngLatBounds()
  );
  map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 1000 });
}

// ---- Import/export ----

function importFileContent(filename, text) {
  const baseName = filename.replace(/\.[^.]+$/, '');

  if (filename.endsWith('.gpx')) {
    const parsed = parseGPX(text, baseName);
    if (!parsed.length) { console.warn('No tracks found in', filename); return; }
    for (const {name, coords} of parsed) {
      const t = createTrack(name, coords);
      fitToTrack(t);
    }
  } else {
    const coordsList = parseGeoJSON(text);
    if (!coordsList.length) { console.warn('No tracks found in', filename); return; }
    for (let i = 0; i < coordsList.length; i++) {
      const name = coordsList.length > 1 ? `${baseName} (${i + 1})` : baseName;
      const t = createTrack(name, coordsList[i]);
      fitToTrack(t);
    }
  }
}

function gpxParsePoints(ptEls) {
  const coords = [];
  for (const pt of ptEls) {
    const lat = +pt.getAttribute('lat');
    const lon = +pt.getAttribute('lon');
    const eleEl = pt.querySelector('ele');
    coords.push([lon, lat, eleEl ? +eleEl.textContent : null]);
  }
  return coords;
}

function parseGPX(text, baseName) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const results = [];
  for (const trk of doc.querySelectorAll('trk')) {
    const nameEl = trk.querySelector(':scope > name');
    const trkName = nameEl ? nameEl.textContent.trim() : baseName;
    const segs = trk.querySelectorAll('trkseg');
    if (segs.length === 0) continue;
    if (segs.length === 1) {
      const coords = gpxParsePoints(segs[0].querySelectorAll('trkpt'));
      if (coords.length) results.push({name: trkName, coords});
    } else {
      for (let i = 0; i < segs.length; i++) {
        const coords = gpxParsePoints(segs[i].querySelectorAll('trkpt'));
        if (coords.length) results.push({name: `${trkName} seg${i + 1}`, coords});
      }
    }
  }
  for (const rte of doc.querySelectorAll('rte')) {
    const nameEl = rte.querySelector(':scope > name');
    const rteName = nameEl ? nameEl.textContent.trim() : baseName;
    const coords = gpxParsePoints(rte.querySelectorAll('rtept'));
    if (coords.length) results.push({name: rteName, coords});
  }
  return results;
}

function parseGeoJSON(text) {
  const gj = JSON.parse(text);
  const results = [];

  function extractCoords(geom) {
    if (geom.type === 'LineString') {
      results.push(geom.coordinates.map(c => [c[0], c[1], c[2] != null ? c[2] : null]));
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) {
        results.push(line.map(c => [c[0], c[1], c[2] != null ? c[2] : null]));
      }
    }
  }

  if (gj.type === 'FeatureCollection') {
    for (const f of gj.features) extractCoords(f.geometry);
  } else if (gj.type === 'Feature') {
    extractCoords(gj.geometry);
  } else {
    extractCoords(gj);
  }
  return results;
}

function exportActiveGPX() {
  const t = getActiveTrack();
  if (!t || !t.coords.length) return;
  const pts = t.coords.map(c => {
    const ele = c[2] != null ? `<ele>${c[2]}</ele>` : '';
    return `      <trkpt lat="${c[1]}" lon="${c[0]}">${ele}</trkpt>`;
  }).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="slope-editor">
  <trk>
<name>${t.name}</name>
<trkseg>
${pts}
</trkseg>
  </trk>
</gpx>`;
  downloadFile(t.name + '.gpx', gpx, 'application/gpx+xml');
}

function exportActiveGeoJSON() {
  const t = getActiveTrack();
  if (!t || !t.coords.length) return;
  const gj = {
    type: 'Feature',
    properties: { name: t.name },
    geometry: {
      type: 'LineString',
      coordinates: t.coords.map(c => c[2] != null ? [c[0], c[1], c[2]] : [c[0], c[1]])
    }
  };
  downloadFile(t.name + '.geojson', JSON.stringify(gj, null, 2), 'application/geo+json');
}

function exportAllGPX() {
  if (!tracks.length) return;
  const segs = tracks.map(t => {
    const pts = t.coords.map(c => {
      const ele = c[2] != null ? `<ele>${c[2]}</ele>` : '';
      return `      <trkpt lat="${c[1]}" lon="${c[0]}">${ele}</trkpt>`;
    }).join('\n');
    return `    <trkseg>\n${pts}\n    </trkseg>`;
  }).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="slope-editor">
  <trk>
<name>All tracks</name>
${segs}
  </trk>
</gpx>`;
  downloadFile('all-tracks.gpx', gpx, 'application/gpx+xml');
}

// ---- Public API ----

export function getTracksState() {
  return {
    tracks,
    get activeTrackId() { return activeTrackId; },
    get editingTrackId() { return editingTrackId; },
    get selectedVertexIndex() { return selectedVertexIndex; },
    get insertAfterIdx() { return insertAfterIdx; },
    get mobileFriendlyMode() { return mobileFriendlyMode; },
    get mapReady() { return mapReady; },
    get profileClosed() { return profileClosed; },
    set profileClosed(v) { profileClosed = v; },
    importFileContent,
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

  drawBtn = document.getElementById('draw-btn');
  tracksBtn = document.getElementById('tracks-btn');
  undoBtn = document.getElementById('undo-btn');
  mobileModeBtn = document.getElementById('mobile-mode-btn');
  trackPanelShell = document.getElementById('track-panel-shell');
  trackToolRow = document.getElementById('track-tool-row');
  trackPanel = document.getElementById('track-panel');
  trackPanelHeader = trackPanel.querySelector('.track-panel-header');
  trackListEl = document.getElementById('track-list');
  profileToggleBtn = document.getElementById('profile-toggle-btn');
  dropOverlay = document.getElementById('drop-overlay');
  mobileHint = document.getElementById('mobile-move-hint');
  toastEl = document.getElementById('toast');
  drawCrosshair = document.getElementById('draw-crosshair');
  mobileCrosshair = document.getElementById('mobile-crosshair');

  syncTrackPanelShell();

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

  // Button handlers
  drawBtn.addEventListener('click', () => {
    if (editingTrackId) exitEditMode();
    else startNewTrack();
  });

  undoBtn.addEventListener('click', () => {
    const t = getActiveTrack();
    if (!t || !t.coords.length) return;
    t.coords.pop();
    if (selectedVertexIndex != null && selectedVertexIndex >= t.coords.length) {
      selectedVertexIndex = t.coords.length > 0 ? t.coords.length - 1 : null;
    }
    if (insertAfterIdx != null && insertAfterIdx >= t.coords.length) {
      insertAfterIdx = t.coords.length > 0 ? t.coords.length - 1 : null;
    }
    invalidateTrackStats(t);
    refreshTrackSource(t);
    renderTrackList();
    updateProfileFn();
    syncUndoBtn();
  });

  mobileModeBtn.addEventListener('click', () => {
    mobileFriendlyMode = !mobileFriendlyMode;
    mobileModeBtn.classList.toggle('active', mobileFriendlyMode);
    if (mobileFriendlyMode && editingTrackId) {
      drawCrosshair.classList.add('visible');
      showToast('Tap anywhere to add a point at center', 3000);
    } else {
      drawCrosshair.classList.remove('visible');
      if (mobileSelectedVertex) cancelMobileMove();
    }
    syncUndoBtn();
  });

  tracksBtn.addEventListener('click', () => {
    setTrackPanelVisible(!trackPanel.classList.contains('visible'));
  });

  // Map click: add vertex or select vertex
  map.on('click', (e) => {
    if (suppressNextMapClick) {
      suppressNextMapClick = false;
      return;
    }

    if (editingTrackId) {
      const t = tracks.find(tr => tr.id === editingTrackId);
      if (!t) return;

      if (e.originalEvent.shiftKey || e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
        const hit = hitTestVertex(e.point);
        if (hit && hit.index != null) {
          t.coords.splice(hit.index, 1);
          if (selectedVertexIndex != null) {
            if (hit.index < selectedVertexIndex) selectedVertexIndex--;
            else if (hit.index === selectedVertexIndex) selectedVertexIndex = null;
          }
          if (insertAfterIdx != null) {
            if (hit.index <= insertAfterIdx) insertAfterIdx = Math.max(0, insertAfterIdx - 1);
          }
          invalidateTrackStats(t);
          refreshTrackSource(t);
          renderTrackList();
          updateProfileFn();
          if (t.coords.length === 0) deleteTrack(t.id);
        }
        return;
      }

      const hitPt = hitTestVertex(e.point);
      if (hitPt && hitPt.index != null) {
        if (mobileFriendlyMode) {
          selectedVertexIndex = hitPt.index;
          mobileSelectedVertex = hitPt;
          mobileHint.textContent = 'Drag screen to move point \u00b7 tap elsewhere to deselect';
          mobileHint.classList.add('visible');
          map.dragPan.disable();
          showToast('Drag screen to move', 2000);
          syncUndoBtn();
          return;
        }
        if (selectedVertexIndex === hitPt.index) {
          selectedVertexIndex = null;
          insertAfterIdx = null;
        } else {
          selectedVertexIndex = hitPt.index;
          if (insertAfterIdx != null) insertAfterIdx = hitPt.index;
        }
        syncUndoBtn();
        return;
      }

      if (mobileFriendlyMode && mobileSelectedVertex) {
        cancelMobileMove();
      }

      let insertLngLat = e.lngLat;
      if (mobileFriendlyMode) {
        insertLngLat = map.getCenter();
      }

      const ele = elevationAt(insertLngLat);
      if (insertAfterIdx != null) {
        t.coords.splice(insertAfterIdx + 1, 0, [insertLngLat.lng, insertLngLat.lat, ele]);
        insertAfterIdx++;
        selectedVertexIndex = insertAfterIdx;
      } else {
        t.coords.push([insertLngLat.lng, insertLngLat.lat, ele]);
      }
      invalidateTrackStats(t);
      refreshTrackSource(t);
      renderTrackList();
      updateProfileFn();
      syncUndoBtn();
      return;
    }
  });
  setDefaultMapCursor();

  map.on('dblclick', (e) => {
    if (editingTrackId) {
      e.preventDefault();
      exitEditMode();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editingTrackId) exitEditMode();
    if (e.key === 'Escape' && mobileSelectedVertex) cancelMobileMove();
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && isTrackEditing(activeTrackId)) {
      const t = getActiveTrack();
      if (t && t.coords.length > 0) {
        e.preventDefault();
        t.coords.pop();
        if (selectedVertexIndex != null && selectedVertexIndex >= t.coords.length) {
          selectedVertexIndex = t.coords.length > 0 ? t.coords.length - 1 : null;
        }
        if (insertAfterIdx != null && insertAfterIdx >= t.coords.length) {
          insertAfterIdx = t.coords.length > 0 ? t.coords.length - 1 : null;
        }
        invalidateTrackStats(t);
        refreshTrackSource(t);
        renderTrackList();
        updateProfileFn();
        syncUndoBtn();
      }
    }
  });

  // Desktop: drag vertices + smart hover insert marker
  if (!isMobile) {
    let hoveredVertex = false;
    let dragMoved = false;
    let hoverInsertDrag = false;

    function finishVertexDrag() {
      if (!dragVertexInfo) return;
      const t = tracks.find(tr => tr.id === dragVertexInfo.trackId);
      if (!dragMoved && t) {
        selectedVertexIndex = dragVertexInfo.index;
        if (insertAfterIdx != null) insertAfterIdx = dragVertexInfo.index;
      }
      dragVertexInfo = null;
      hoverInsertDrag = false;
      map.dragPan.enable();
      hoveredVertex = false;
      if (dragMoved) suppressNextMapClick = true;
      dragMoved = false;
      setDefaultMapCursor();
      if (t) {
        invalidateTrackStats(t);
        renderTrackList();
        updateProfileFn();
        syncUndoBtn();
      }
    }

    map.on('mousedown', (e) => {
      if (!editingTrackId) return;

      const hit = hitTestVertex(e.point);
      if (hit && hit.index != null) {
        e.preventDefault();
        e.originalEvent.stopPropagation();
        dragVertexInfo = hit;
        dragMoved = false;
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'grabbing';
        return;
      }

      if (hoverInsertInfo) {
        const hiPt = map.project([hoverInsertInfo.lngLat.lng, hoverInsertInfo.lngLat.lat]);
        const dist = Math.sqrt((e.point.x - hiPt.x) ** 2 + (e.point.y - hiPt.y) ** 2);
        if (dist < 20) {
          const t = tracks.find(tr => tr.id === editingTrackId);
          if (t) {
            const ele = elevationAt(hoverInsertInfo.lngLat);
            t.coords.splice(hoverInsertInfo.insertAfter + 1, 0,
              [hoverInsertInfo.lngLat.lng, hoverInsertInfo.lngLat.lat, ele]);
            invalidateTrackStats(t);
            refreshTrackSource(t);
            e.preventDefault();
            e.originalEvent.stopPropagation();
            dragVertexInfo = { trackId: t.id, index: hoverInsertInfo.insertAfter + 1 };
            hoverInsertDrag = true;
            dragMoved = false;
            clearHoverInsertMarker();
            map.dragPan.disable();
            map.getCanvas().style.cursor = 'grabbing';
            return;
          }
        }
      }
    });

    map.on('mousemove', (e) => {
      if (dragVertexInfo) {
        const t = tracks.find(tr => tr.id === dragVertexInfo.trackId);
        if (!t) return;
        const c = t.coords[dragVertexInfo.index];
        c[0] = e.lngLat.lng;
        c[1] = e.lngLat.lat;
        c[2] = elevationAt(e.lngLat);
        dragMoved = true;
        refreshTrackSource(t);
        return;
      }

      if (editingTrackId) {
        if (!mobileFriendlyMode) {
          insertPreviewLngLat = e.lngLat;
          updateInsertPreview();
        }
        const hit = hitTestVertex(e.point);
        const isRealVertex = Boolean(hit && hit.index != null);
        if (isRealVertex && !hoveredVertex) {
          hoveredVertex = true;
          clearHoverInsertMarker();
          map.getCanvas().style.cursor = 'grab';
        } else if (!isRealVertex && hoveredVertex) {
          hoveredVertex = false;
          map.getCanvas().style.cursor = 'crosshair';
        }

        if (!isRealVertex && !hoveredVertex) {
          const t = tracks.find(tr => tr.id === editingTrackId);
          const closest = findClosestPointOnTrack(t, e.point);
          if (closest) {
            hoverInsertInfo = closest;
            showHoverInsertMarker(closest.lngLat);
            map.getCanvas().style.cursor = 'copy';
          } else {
            if (hoverInsertInfo) {
              clearHoverInsertMarker();
              map.getCanvas().style.cursor = 'crosshair';
            }
          }
        } else if (hoverInsertInfo) {
          clearHoverInsertMarker();
        }
      }
    });

    map.on('mouseup', () => {
      finishVertexDrag();
    });

    window.addEventListener('mouseup', finishVertexDrag);
  }

  // Mobile: vertex interaction
  if (isMobile) {
    let touchLongPressTimer = null;
    let touchStartPt = null;
    let mobileDragVertex = null;

    map.getCanvas().addEventListener('touchstart', (e) => {
      if (!editingTrackId || mobileFriendlyMode) return;
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = map.getCanvas().getBoundingClientRect();
      const pt = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      touchStartPt = pt;
      const hit = hitTestVertex(pt);
      if (hit && hit.index != null) {
        touchLongPressTimer = setTimeout(() => {
          mobileDragVertex = { ...hit, screenX: touch.clientX, screenY: touch.clientY };
          map.dragPan.disable();
          showToast('Drag to move point', 1500);
        }, 400);
      }
    }, { passive: true });

    map.getCanvas().addEventListener('touchmove', (e) => {
      if (touchLongPressTimer && touchStartPt) {
        const touch = e.touches[0];
        const rect = map.getCanvas().getBoundingClientRect();
        const dx = touch.clientX - rect.left - touchStartPt.x;
        const dy = touch.clientY - rect.top - touchStartPt.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          clearTimeout(touchLongPressTimer);
          touchLongPressTimer = null;
        }
      }
      if (mobileDragVertex && e.touches.length === 1) {
        const touch = e.touches[0];
        const rect = map.getCanvas().getBoundingClientRect();
        const pt = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
        const lngLat = map.unproject([pt.x, pt.y]);
        const t = tracks.find(tr => tr.id === mobileDragVertex.trackId);
        if (t) {
          const c = t.coords[mobileDragVertex.index];
          c[0] = lngLat.lng;
          c[1] = lngLat.lat;
          c[2] = elevationAt(lngLat);
          invalidateTrackStats(t);
          refreshTrackSource(t);
        }
        e.preventDefault();
      }
    }, { passive: false });

    map.getCanvas().addEventListener('touchend', () => {
      if (touchLongPressTimer) {
        clearTimeout(touchLongPressTimer);
        touchLongPressTimer = null;
      }
      if (mobileDragVertex) {
        const t = tracks.find(tr => tr.id === mobileDragVertex.trackId);
        mobileDragVertex = null;
        map.dragPan.enable();
        if (t) {
          invalidateTrackStats(t);
          renderTrackList();
          updateProfileFn();
          syncUndoBtn();
        }
      }
      touchStartPt = null;
    }, { passive: true });

    map.on('move', () => {
      if (!mobileSelectedVertex) return;
      const t = tracks.find(tr => tr.id === mobileSelectedVertex.trackId);
      if (!t) return;
      const center = map.getCenter();
      const c = t.coords[mobileSelectedVertex.index];
      c[0] = center.lng;
      c[1] = center.lat;
      c[2] = elevationAt(center);
      invalidateTrackStats(t);
      refreshTrackSource(t);
    });

    map.on('touchend', () => {
      if (!mobileSelectedVertex) return;
      cancelMobileMove();
    });
  }

  // Update insert preview on map move (for mobile-friendly crosshair mode)
  map.on('move', () => {
    if (mobileFriendlyMode && editingTrackId) {
      updateInsertPreview();
    }
  });

  // Drag & drop import
  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('visible');
  });
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('visible'); }
  });
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('visible');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importFileContent(file.name, reader.result);
    reader.readAsText(file);
  });

  // Export buttons
  document.getElementById('export-gpx-btn').addEventListener('click', exportActiveGPX);
  document.getElementById('export-geojson-btn').addEventListener('click', exportActiveGeoJSON);
  document.getElementById('export-all-gpx-btn').addEventListener('click', exportAllGPX);

  // Add map layers for tracks once map is loaded
  map.on('load', () => {
    mapReady = true;
    ensureProfileHoverLayer();
    for (const t of tracks) {
      if (!map.getSource(trackSourceId(t))) addTrackToMap(t);
    }
  });
}
