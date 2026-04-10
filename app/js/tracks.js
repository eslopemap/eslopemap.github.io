// Track data model, CRUD, map rendering, stats, panel UI.
// Editing interaction is in track-edit.js, import/export in io.js.

import { haversineKm } from './utils.js';
// import { state } from './state.js';
import { DEM_MAX_Z, DEM_HD_SOURCE_ID, TRACK_COLORS } from './constants.js';
import { queryLoadedElevationAtLngLat } from './dem.js';
import { initTrackEdit, getEditState, isTrackEditing, enterEditMode, exitEditMode, startNewTrack, resetMobileFriendlyMode } from './track-edit.js';
import { initIO, importFileContent } from './io.js';
import { saveTracks, loadTracks, saveWaypoints, loadWaypoints } from './persist.js';
import { initGpxTree, renderGpxTree, rebuildTree, onTrackCreated, onTrackDeleted, onFileBatchImported, openInfoEditor, findNodeForTrackId, getPrimarySelectionNode } from './gpx-tree.js';
import { buildSelectionSpan, densifyTrackSpan, simplifyTrackSpan, splitTrackSpan, mergeTrackSpans, convertRouteToTrack, simplifyForDisplay } from './track-ops.js';

let map, state;
let updateProfileFn = () => {};  // wired by initTracks
let _editFns = null;

const tracks = [];
const waypoints = [];
let activeTrackId = null;
let trackColorIdx = 0;
let mapReady = false;
let profileClosed = true;
let activeSelectionSpan = null;
let promotedTrackId = null;  // track currently promoted to its own source for editing

// Debounced save to localStorage
let _saveTimer = 0;
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    saveTracks(tracks);
    saveWaypoints(waypoints);
  }, 300);
}

// DOM refs (resolved at init)
let tracksBtn, trackPanelShell, trackToolRow;
let trackPanel, trackListEl, profileToggleBtn;

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
  const nominal = (40075016.7 / Math.pow(2, DEM_MAX_Z) / 512) * Math.max(0.25, Math.cos(meanLat * Math.PI / 180));
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

// ---- Merged display source (all tracks in one GeoJSON) ----

const MERGED_SOURCE = 'tracks-merged';
const MERGED_LINE_LAYER = 'tracks-merged-line';

function mergedTrackGeoJSON() {
  const features = [];
  for (const t of tracks) {
    if (t.id === promotedTrackId) continue;  // active track has its own source
    if (t.coords.length < 2) continue;
    const displayCoords = simplifyForDisplay(t.coords, 5, 500);
    features.push({
      type: 'Feature',
      id: stableFeatureId(t.id),
      geometry: { type: 'LineString', coordinates: displayCoords },
      properties: { trackId: t.id, color: t.color }
    });
  }
  return { type: 'FeatureCollection', features };
}

// MapLibre GeoJSON source needs numeric feature ids for updateData()
const _featureIdMap = new Map();
let _nextFeatureId = 1;
function stableFeatureId(trackId) {
  if (!_featureIdMap.has(trackId)) _featureIdMap.set(trackId, _nextFeatureId++);
  return _featureIdMap.get(trackId);
}

function addMergedSource() {
  if (map.getSource(MERGED_SOURCE)) return;
  map.addSource(MERGED_SOURCE, { type: 'geojson', data: mergedTrackGeoJSON() });
  map.addLayer({
    id: MERGED_LINE_LAYER, type: 'line', source: MERGED_SOURCE,
    paint: {
      'line-color': ['coalesce', ['get', 'color'], '#888'],
      'line-width': ['case',
        ['==', ['get', 'trackId'], ['global-state', 'activeTrackId']], 5,
        2],
      'line-opacity': 0.9
    }
  });
}

function refreshMergedSource() {
  const src = map.getSource(MERGED_SOURCE);
  if (src) src.setData(mergedTrackGeoJSON());
}

// ---- Per-track source (only for the promoted/active track) ----

function trackSourceId(t) { return 'track-' + t.id; }
function trackLineLayerId(t) { return 'track-line-' + t.id; }
function trackPtsLayerId(t) { return 'track-pts-' + t.id; }

const SELECTION_HIGHLIGHT_SOURCE = 'selection-highlight';
const SELECTION_HIGHLIGHT_LAYER = 'selection-highlight-line';

function refreshSelectionHighlight() {
  const emptyData = { type: 'FeatureCollection', features: [] };
  if (!map.getSource(SELECTION_HIGHLIGHT_SOURCE)) {
    map.addSource(SELECTION_HIGHLIGHT_SOURCE, { type: 'geojson', data: emptyData });
    map.addLayer({
      id: SELECTION_HIGHLIGHT_LAYER,
      type: 'line',
      source: SELECTION_HIGHLIGHT_SOURCE,
      paint: {
        'line-color': '#3b82f6',
        'line-width': 6,
        'line-opacity': 0.55,
      },
    });
  }
  if (!activeSelectionSpan?.ok) {
    map.getSource(SELECTION_HIGHLIGHT_SOURCE).setData(emptyData);
    return;
  }
  const track = getTrackById(activeSelectionSpan.trackId);
  if (!track) {
    map.getSource(SELECTION_HIGHLIGHT_SOURCE).setData(emptyData);
    return;
  }
  const coords = track.coords.slice(activeSelectionSpan.startIdx, activeSelectionSpan.endIdx + 1);
  if (coords.length < 2) {
    map.getSource(SELECTION_HIGHLIGHT_SOURCE).setData(emptyData);
    return;
  }
  map.getSource(SELECTION_HIGHLIGHT_SOURCE).setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords.map(c => [c[0], c[1]]) },
  });
}

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
      'line-width': ['case', isActive, 5, 2],
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

// ---- Waypoint map layer ----

const WAYPOINT_SOURCE_ID = 'waypoints';
const WAYPOINT_CIRCLE_LAYER_ID = 'waypoint-circles';
const WAYPOINT_LABEL_LAYER_ID = 'waypoint-labels';

function waypointGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: waypoints.map(wp => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: wp.coords.slice(0, 2) },
      properties: { name: wp.name || '', sym: wp.sym || '' },
    })),
  };
}

function ensureWaypointLayer() {
  if (!map.getSource(WAYPOINT_SOURCE_ID)) {
    map.addSource(WAYPOINT_SOURCE_ID, {
      type: 'geojson',
      data: waypointGeoJSON(),
    });
  }
  if (!map.getLayer(WAYPOINT_CIRCLE_LAYER_ID)) {
    map.addLayer({
      id: WAYPOINT_CIRCLE_LAYER_ID,
      type: 'circle',
      source: WAYPOINT_SOURCE_ID,
      paint: {
        'circle-radius': 6,
        'circle-color': '#f59e0b',
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    });
  }
  if (!map.getLayer(WAYPOINT_LABEL_LAYER_ID)) {
    map.addLayer({
      id: WAYPOINT_LABEL_LAYER_ID,
      type: 'symbol',
      source: WAYPOINT_SOURCE_ID,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-font': ['Frutiger Neue Regular'],
      },
      paint: {
        'text-color': '#1e293b',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    });
  }
}

function refreshWaypointSource() {
  const src = map.getSource(WAYPOINT_SOURCE_ID);
  if (src) src.setData(waypointGeoJSON());
}

function addWaypoints(newWaypoints) {
  for (const wp of newWaypoints) {
    waypoints.push({
      id: wp.id || ('wpt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
      name: wp.name,
      coords: wp.coords,
      sym: wp.sym,
      desc: wp.desc,
      comment: wp.comment,
      wptType: wp.wptType || '',
    });
  }
  if (waypoints.length) refreshWaypointSource();
  scheduleSave();
}

function createWaypoint(waypoint) {
  if (!Array.isArray(waypoint?.coords) || waypoint.coords.length < 2) return null;
  const created = {
    id: waypoint.id || ('wpt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
    name: waypoint.name || 'Waypoint',
    coords: waypoint.coords.slice(),
    sym: waypoint.sym || '',
    desc: waypoint.desc || '',
    comment: waypoint.comment || '',
    wptType: waypoint.wptType || '',
  };
  waypoints.push(created);
  refreshWaypointSource();
  scheduleSave();
  return created;
}

function updateWaypointById(id, updates) {
  const waypoint = waypoints.find(wp => wp.id === id);
  if (!waypoint) return;
  if (typeof updates.name === 'string') waypoint.name = updates.name;
  if (typeof updates.desc === 'string') waypoint.desc = updates.desc;
  if (typeof updates.comment === 'string') waypoint.comment = updates.comment;
  if (typeof updates.sym === 'string') waypoint.sym = updates.sym;
  if (typeof updates.wptType === 'string') waypoint.wptType = updates.wptType;
  if (Array.isArray(updates.coords) && updates.coords.length >= 2) waypoint.coords = updates.coords.slice();
  refreshWaypointSource();
  scheduleSave();
}

function findWaypointById(id) {
  return waypoints.find(wp => wp.id === id) || null;
}

function deleteWaypointById(id) {
  const index = waypoints.findIndex(wp => wp.id === id);
  if (index < 0) return;
  waypoints.splice(index, 1);
  refreshWaypointSource();
  scheduleSave();
}

function removeTrackFromMap(t) {
  if (map.getLayer(trackPtsLayerId(t))) map.removeLayer(trackPtsLayerId(t));
  if (map.getLayer(trackLineLayerId(t))) map.removeLayer(trackLineLayerId(t));
  if (map.getSource(trackSourceId(t))) map.removeSource(trackSourceId(t));
  if (promotedTrackId === t.id) promotedTrackId = null;
}

function promoteTrack(t) {
  if (!t || promotedTrackId === t.id) return;
  if (promotedTrackId) {
    const prev = tracks.find(tr => tr.id === promotedTrackId);
    if (prev) demoteTrack(prev);
  }
  promotedTrackId = t.id;
  if (!map.getSource(trackSourceId(t))) addTrackToMap(t);
  else refreshTrackSource(t);
  refreshMergedSource();
}

function demoteTrack(t) {
  if (!t || promotedTrackId !== t.id) return;
  removeTrackFromMap(t);
  promotedTrackId = null;
  refreshMergedSource();
}

function refreshTrackSource(t) {
  if (t.id === promotedTrackId) {
    const src = map.getSource(trackSourceId(t));
    if (src) src.setData(trackGeoJSON(t));
    // Skip merged refresh — promoted track is excluded from merged source
  } else {
    refreshMergedSource();
  }
}

function refreshAllTrackSources() {
  if (promotedTrackId) {
    const pt = tracks.find(tr => tr.id === promotedTrackId);
    if (pt) {
      const src = map.getSource(trackSourceId(pt));
      if (src) src.setData(trackGeoJSON(pt));
    }
  }
  refreshMergedSource();
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
  profileToggleBtn.title = isVisible ? 'Hide profile' : 'Elevation profile';
}

function syncTrackPanelShell() {
  const isVisible = trackPanel.classList.contains('visible');
  const hasTracks = tracks.length > 0;
  trackPanelShell.classList.toggle('visible', isVisible);
  trackPanelShell.classList.toggle('panel-surface', isVisible);
  tracksBtn.disabled = !hasTracks;
  tracksBtn.classList.toggle('active', isVisible && hasTracks);
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

function renderTrackList() {
  if (!tracks.length) setTrackPanelVisible(false);
  else syncTrackPanelShell();
  syncProfileToggleButton();
  const es = getEditState();
  es.syncUndoBtn();
  renderGpxTree();
}

// ---- Active track ----

function setActiveTrack(id) {
  const changed = id !== activeTrackId;
  if (id !== activeTrackId) profileClosed = false;
  const es = getEditState();
  if (es.editingTrackId && es.editingTrackId !== id) exitEditMode();
  activeTrackId = id;
  if (changed) clearSelectionSpan();
  // Promote/demote per-track sources
  if (mapReady && changed) {
    const t = id ? tracks.find(tr => tr.id === id) : null;
    if (t) promoteTrack(t);
    else if (promotedTrackId) {
      const prev = tracks.find(tr => tr.id === promotedTrackId);
      if (prev) demoteTrack(prev);
    }
  }
  renderTrackList();
  updateVertexHighlight(es.editingTrackId, es.selectedVertexIndex);
  updateProfileFn();
}

function removeTrackById(id) {
  const t = tracks.find(tr => tr.id === id);
  if (!t) return null;
  const idx = tracks.indexOf(t);
  const es = getEditState();
  if (es.editingTrackId === id) exitEditMode();
  if (promotedTrackId === id) removeTrackFromMap(t);
  _featureIdMap.delete(id);
  tracks.splice(idx, 1);
  if (activeTrackId === id) activeTrackId = tracks.length ? tracks[tracks.length - 1].id : null;
  if (activeSelectionSpan?.trackId === id) clearSelectionSpan(false);
  refreshMergedSource();
  return t;
}

function deleteTrack(id) {
  const t = tracks.find(tr => tr.id === id);
  if (!t) return;
  if (!confirm(`Delete track "${t.name}"?`)) return;
  const es = getEditState();
  removeTrackById(id);
  onTrackDeleted(id);
  renderTrackList();
  updateVertexHighlight(es.editingTrackId, es.selectedVertexIndex);
  scheduleSave();
}

function createTrack(name, coords, opts) {
  const t = {
    id: opts?.id || ('trk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
    name, color: opts?.color || nextColor(), coords, _statsCache: null,
    desc: opts?.desc || '',
    cmt: opts?.cmt || '',
    trkType: opts?.trkType || '',
    rteType: opts?.rteType || '',
    sourceKind: opts?.sourceKind || 'track',
    groupId: opts?.groupId || null,
    groupName: opts?.groupName || null,
    segmentLabel: opts?.segmentLabel || null,
  };
  if (!opts?.batchImport) enrichElevation(t.coords);
  tracks.push(t);
  if (mapReady && !opts?.batchImport) {
    addMergedSource();  // no-op if already exists
    refreshMergedSource();
  }
  if (!opts?.batchImport) setTrackPanelVisible(true);
  if (!opts?.skipSelect && !opts?.batchImport) setActiveTrack(t.id);
  if (!opts?.skipTreeHook) onTrackCreated(t);
  if (!opts?.batchImport) scheduleSave();
  return t;
}

function finishBatchImport() {
  if (mapReady) {
    addMergedSource();
    refreshMergedSource();
  }
  setTrackPanelVisible(true);
  // Select last track
  if (tracks.length && !activeTrackId) {
    setActiveTrack(tracks[tracks.length - 1].id);
  }
  scheduleSave();
}

function ensureTrackGrouping(trackIds, groupName) {
  const existingTracks = trackIds
    .map(id => tracks.find(tr => tr.id === id))
    .filter(Boolean);
  if (!existingTracks.length) return null;

  const existingGroupId = existingTracks.find(t => t.groupId)?.groupId;
  const finalGroupId = existingGroupId || ('grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  const finalGroupName = groupName || existingTracks[0].groupName || existingTracks[0].name || 'Track';

  for (let i = 0; i < existingTracks.length; i++) {
    const track = existingTracks[i];
    track.groupId = finalGroupId;
    track.groupName = finalGroupName;
    if (!track.segmentLabel) track.segmentLabel = `Segment ${i + 1}`;
  }

  renderTrackList();
  scheduleSave();
  return {
    groupId: finalGroupId,
    groupName: finalGroupName,
    segmentCount: existingTracks.length,
  };
}

function suggestTrackNameForFile(fileNode) {
  const base = (fileNode?.name || 'Track').replace(/\.gpx$/i, '').trim() || 'Track';
  const existingCount = Array.isArray(fileNode?.children)
    ? fileNode.children.filter(child => child.type === 'track').length
    : 0;
  return existingCount > 0 ? `${base} #${existingCount + 1}` : base;
}

function getActiveTrack() {
  return tracks.find(t => t.id === activeTrackId) || null;
}

function getTrackById(id) {
  return tracks.find(t => t.id === id) || null;
}

function deleteSelectionPoints(trackId, sourceIndices) {
  const track = getTrackById(trackId);
  if (!track || !sourceIndices?.length) return { ok: false, error: 'Nothing to delete' };
  const sorted = [...sourceIndices].sort((a, b) => b - a);
  for (const idx of sorted) {
    track.coords.splice(idx, 1);
  }
  if (track.coords.length === 0) {
    removeTrackById(trackId);
  } else {
    onTrackCoordsChanged(track);
  }
  clearSelectionSpan();
  scheduleSave();
  return { ok: true, deletedCount: sourceIndices.length };
}

function clearSelectionSpan(notifyProfile = true) {
  activeSelectionSpan = null;
  refreshSelectionHighlight();
  if (notifyProfile) updateProfileFn();
}

function setSelectionSpan(selectionSpan) {
  activeSelectionSpan = selectionSpan?.ok ? selectionSpan : null;
  refreshSelectionHighlight();
  updateProfileFn();
}

function getSelectionSpanForTrack(trackId) {
  if (!activeSelectionSpan?.ok) return null;
  return activeSelectionSpan.trackId === trackId ? activeSelectionSpan : null;
}

function buildWorkingSpan(trackId, fallbackToFullTrack = true) {
  const track = getTrackById(trackId);
  if (!track) return { ok: false, error: 'Track not found' };
  const existing = getSelectionSpanForTrack(trackId);
  if (existing) return existing;
  if (!fallbackToFullTrack) return { ok: false, error: 'No active selection span' };
  return buildSelectionSpan(track, 0, track.coords.length - 1);
}

function applyTrackCoords(trackId, updatedCoords) {
  const track = getTrackById(trackId);
  if (!track) return null;
  track.coords = updatedCoords.map(coord => coord.slice());
  onTrackCoordsChanged(track);
  const refreshedSelection = activeSelectionSpan?.trackId === trackId && track.coords.length
    ? buildSelectionSpan(track, 0, track.coords.length - 1)
    : null;
  if (activeSelectionSpan?.trackId === trackId) {
    activeSelectionSpan = refreshedSelection?.ok ? refreshedSelection : null;
  }
  return track;
}

function replaceTrackProperties(trackId, patch) {
  const track = getTrackById(trackId);
  if (!track) return null;
  Object.assign(track, patch || {});
  invalidateTrackStats(track);
  refreshTrackSource(track);
  renderTrackList();
  updateProfileFn();
  scheduleSave();
  return track;
}

function finishStructuralMutation(nextActiveTrackId = null) {
  rebuildTree();
  renderTrackList();
  if (nextActiveTrackId) setActiveTrack(nextActiveTrackId);
  updateProfileFn();
  scheduleSave();
}

function densifyActiveTrackSpan(options = {}) {
  const track = getActiveTrack();
  if (!track) return { ok: false, error: 'No active track' };
  const span = buildWorkingSpan(track.id, true);
  const result = densifyTrackSpan(track, span, span.startIdx, span.endIdx, options);
  if (!result.ok) return result;
  applyTrackCoords(track.id, result.updatedCoords);
  setSelectionSpan(buildSelectionSpan(getTrackById(track.id), result.startIdx, result.startIdx + result.replacementCoords.length - 1));
  return result;
}

function simplifyActiveTrackSpan(options = {}) {
  const track = getActiveTrack();
  if (!track) return { ok: false, error: 'No active track' };
  const span = buildWorkingSpan(track.id, true);
  const result = simplifyTrackSpan(track, span, span.startIdx, span.endIdx, options);
  if (!result.ok) return result;
  applyTrackCoords(track.id, result.updatedCoords);
  setSelectionSpan(buildSelectionSpan(getTrackById(track.id), result.startIdx, result.startIdx + result.replacementCoords.length - 1));
  return result;
}

function convertActiveRouteToTrack(options = {}) {
  const track = getActiveTrack();
  if (!track) return { ok: false, error: 'No active route' };
  const span = buildSelectionSpan(track, 0, track.coords.length - 1);
  const result = convertRouteToTrack(track, span, 0, track.coords.length - 1, options);
  if (!result.ok) return result;
  if (result.replace) {
    replaceTrackProperties(track.id, {
      sourceKind: 'track',
      trkType: result.createdTrack.trkType || track.trkType || '',
      rteType: '',
    });
    finishStructuralMutation(track.id);
  } else {
    const created = createTrack(result.createdTrack.name, result.createdTrack.coords, {
      color: track.color,
      desc: result.createdTrack.desc,
      cmt: result.createdTrack.cmt,
      trkType: result.createdTrack.trkType,
      sourceKind: 'track',
      skipTreeHook: true,
      skipSelect: true,
    });
    finishStructuralMutation(created?.id || track.id);
  }
  return result;
}

function splitActiveTrackSpan(options = {}) {
  const track = getActiveTrack();
  if (!track) return { ok: false, error: 'No active track' };
  const span = buildWorkingSpan(track.id, true);
  const result = splitTrackSpan(track, span, span.startIdx, span.endIdx, options);
  if (!result.ok) return result;

  const baseName = track.groupName || track.name;
  const targetMode = options.mode === 'extract-segment' ? 'extract-segment' : result.mode;
  const newTracks = [];
  const groupId = targetMode === 'extract-segment'
    ? ('grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6))
    : null;

  for (let i = 0; i < result.fragments.length; i++) {
    const fragment = result.fragments[i];
    if (!fragment.coords || fragment.coords.length < 2) continue;
    const created = createTrack(baseName, fragment.coords, {
      color: i === 0 ? track.color : nextColor(),
      desc: track.desc,
      cmt: track.cmt,
      trkType: track.trkType,
      sourceKind: track.sourceKind,
      groupId,
      groupName: groupId ? baseName : null,
      segmentLabel: groupId ? `${fragment.role === 'selected' ? 'Selected' : fragment.role.charAt(0).toUpperCase() + fragment.role.slice(1)} segment` : null,
      skipTreeHook: true,
      skipSelect: true,
    });
    if (created) newTracks.push(created);
  }

  removeTrackById(track.id);
  finishStructuralMutation(newTracks[0]?.id || null);
  return result;
}

function mergeSelectedTracks(trackIds, options = {}) {
  const selectedTracks = (trackIds || []).map(id => getTrackById(id)).filter(Boolean);
  if (options.mode === 'segments') {
    const grouping = ensureTrackGrouping(selectedTracks.map(track => track.id), options.groupName || selectedTracks[0]?.groupName || selectedTracks[0]?.name || 'Track');
    if (!grouping) return { ok: false, error: 'Unable to merge tracks as segments' };
    finishStructuralMutation(selectedTracks[0]?.id || null);
    return { ok: true, kind: 'merge', mode: 'segments', preview: { inputTrackCount: selectedTracks.length } };
  }

  const result = mergeTrackSpans(selectedTracks, options);
  if (!result.ok) return result;
  const first = selectedTracks[0];
  const created = createTrack(options.name || first.name, result.mergedCoords, {
    color: first.color,
    desc: first.desc,
    cmt: first.cmt,
    trkType: first.trkType,
    sourceKind: 'track',
    skipTreeHook: true,
    skipSelect: true,
  });
  for (const track of selectedTracks) removeTrackById(track.id);
  finishStructuralMutation(created?.id || null);
  return result;
}

function fitToTrack(t) {
  if (t.coords.length < 1) return;
  const bounds = t.coords.reduce(
    (b, c) => b.extend([c[0], c[1]]),
    new maplibregl.LngLatBounds()
  );
  const opts = { padding: 60, maxZoom: 15, duration: 1000 };
  if (!state.terrain3d) {
    opts.bearing = map.getBearing();
    opts.pitch = map.getPitch();
  }
  map.fitBounds(bounds, opts);
}

function fitToTrackIds(ids) {
  const bounds = new maplibregl.LngLatBounds();
  let any = false;
  for (const id of ids) {
    const t = tracks.find(tr => tr.id === id);
    if (t) for (const c of t.coords) { bounds.extend([c[0], c[1]]); any = true; }
  }
  if (!any) return;
  const opts = { padding: 60, maxZoom: 15, duration: 1000 };
  if (!state.terrain3d) {
    opts.bearing = map.getBearing();
    opts.pitch = map.getPitch();
  }
  map.fitBounds(bounds, opts);
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

function renameTrack(id, newName) {
  const t = tracks.find(tr => tr.id === id);
  if (!t || !newName) return;
  if (t.segmentLabel) t.segmentLabel = newName;
  else t.name = newName;
  renderTrackList();
  scheduleSave();
}

function renameGroup(groupId, newName) {
  if (!newName) return;
  for (const t of tracks) {
    if (t.groupId === groupId) t.groupName = newName;
  }
  renderTrackList();
  scheduleSave();
}

function startTrackRename(trackId, nameEl) {
  const t = tracks.find(tr => tr.id === trackId);
  if (!t) return;
  const currentName = t.segmentLabel || t.name;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'track-name-input';
  input.value = currentName;
  // Replace span content with just the input (remove stats lines)
  nameEl.textContent = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim();
    if (val && val !== currentName) renameTrack(trackId, val);
    else renderTrackList();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    e.stopPropagation();
  });
  input.addEventListener('click', (e) => e.stopPropagation());
}

function startGroupRename(groupId, nameEl) {
  const first = tracks.find(t => t.groupId === groupId);
  if (!first) return;
  const currentName = first.groupName || 'Group';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'track-name-input';
  input.value = currentName;
  nameEl.textContent = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim();
    if (val && val !== currentName) renameGroup(groupId, val);
    else renderTrackList();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    e.stopPropagation();
  });
  input.addEventListener('click', (e) => e.stopPropagation());
}

function createNewTrack(name) {
  return createTrack(name || ('Track ' + (tracks.length + 1)), []);
}

// ---- Test-only reset (no page reload needed) ----

export function resetForTest() {
  const es = getEditState();
  if (es.editingTrackId) exitEditMode();
  // Remove promoted track's per-track source
  if (promotedTrackId) {
    const pt = tracks.find(tr => tr.id === promotedTrackId);
    if (pt) removeTrackFromMap(pt);
  }
  promotedTrackId = null;
  tracks.length = 0;
  _featureIdMap.clear();
  waypoints.length = 0;
  activeTrackId = null;
  trackColorIdx = 0;
  profileClosed = false;
  activeSelectionSpan = null;
  resetMobileFriendlyMode();
  refreshMergedSource();
  refreshWaypointSource();
  rebuildTree();
}

// ---- Public API ----

function rehydrateTrackLayers() {
  mapReady = true;
  ensureProfileHoverLayer();
  ensureWaypointLayer();
  addMergedSource();
  // Promote the active track to its own source for editing
  const activeT = activeTrackId ? tracks.find(t => t.id === activeTrackId) : null;
  if (activeT) promoteTrack(activeT);
  refreshSelectionHighlight();
  const es = getEditState();
  updateVertexHighlight(es.editingTrackId, es.selectedVertexIndex);
}

export function getTracksState() {
  const es = getEditState();
  return {
    tracks,
    waypoints,
    get activeTrackId() { return activeTrackId; },
    get promotedTrackId() { return promotedTrackId; },
    get editingTrackId() { return es.editingTrackId; },
    get selectedVertexIndex() { return es.selectedVertexIndex; },
    get insertAfterIdx() { return es.insertAfterIdx; },
    get mobileFriendlyMode() { return es.mobileFriendlyMode; },
    get mapReady() { return mapReady; },
    get profileClosed() { return profileClosed; },
    set profileClosed(v) { profileClosed = v; },
    get selectionSpan() { return activeSelectionSpan; },
    getActiveTrack,
    getTrackById,
    setActiveTrack,
    enterEditForTrack: (id) => { setActiveTrack(id); enterEditMode(id); },
    exitEditMode,
    setSelectionSpan,
    clearSelectionSpan,
    buildSelectionSpanForTrack: (trackId, startIdx, endIdx) => {
      const track = getTrackById(trackId);
      return track ? buildSelectionSpan(track, startIdx, endIdx) : { ok: false, error: 'Track not found' };
    },
    densifyActiveTrackSpan,
    simplifyActiveTrackSpan,
    splitActiveTrackSpan,
    mergeSelectedTracks,
    convertActiveRouteToTrack,
    deleteSelectionPoints,
    ensureProfileHoverLayer,
    PROFILE_HOVER_SOURCE_ID,
    syncProfileToggleButton,
    syncBottomRightOffset() {
      document.body.classList.toggle('profile-open', document.getElementById('profile-panel').classList.contains('visible'));
    },
    wireRectangleSelectionCheck(fn) {
      if (_editFns) _editFns.isRectangleSelectionActive = fn;
    },
    rehydrateTrackLayers,
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
  trackListEl = document.getElementById('track-list');
  profileToggleBtn = document.getElementById('profile-toggle-btn');

  syncTrackPanelShell();

  // Restore saved tracks
  const saved = loadTracks();
  for (const st of saved) {
    if (!st.coords || !st.coords.length) continue;
    const t = {
      id: st.id || ('trk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
      name: st.name || 'Track',
      color: st.color || nextColor(),
      coords: st.coords,
      _statsCache: null,
      desc: st.desc || '',
      cmt: st.cmt || '',
      trkType: st.trkType || '',
      rteType: st.rteType || '',
      sourceKind: st.sourceKind || 'track',
      groupId: st.groupId || null,
      groupName: st.groupName || null,
      segmentLabel: st.segmentLabel || null,
    };
    tracks.push(t);
  }
  const savedWaypoints = loadWaypoints();
  addWaypoints(savedWaypoints);
  if (tracks.length) {
    activeTrackId = tracks[tracks.length - 1].id;
    setTrackPanelVisible(true);
    renderTrackList();
  }

  // Init the editing module
  _editFns = {
    findTrack: (id) => tracks.find(tr => tr.id === id),
    getActiveTrack,
    getTrackCount: () => tracks.length,
    createNewTrack,
    renameTrack,
    startTrackRename,
    deleteTrack,
    removeIncompleteNewTrack,
    onTrackCoordsChanged,
    invalidateAndRefresh,
    refreshTrackSource,
    renderTrackList,
    updateVertexHighlight,
    trackPtsLayerId,
    elevationAt,
    isRectangleSelectionActive: null, // wired later by main.js
    openInfoForTrack: (id, options) => {
      const node = findNodeForTrackId(id, options);
      if (node) openInfoEditor(node.id);
    },
  };
  initTrackEdit(mapRef, stateRef, updateProfile, _editFns);

  // Re-enrich when new DEM tiles load
  map.on('data', (e) => {
    if (e.sourceId === DEM_HD_SOURCE_ID && e.dataType === 'source' && tracks.length) {
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
    getWaypoints: () => waypoints,
    findWaypointById,
    addWaypoints,
    fitToTrack,
    fitToTrackIds,
    getPrimaryExportNode: () => getPrimarySelectionNode(),
    finishBatchImport,
    onFileBatchImported: (fileName, createdTracks, waypoints) => onFileBatchImported(fileName, createdTracks, waypoints),
  });

  // Init the workspace tree
  initGpxTree({
    getTracks: () => tracks,
    getWaypoints: () => waypoints,
    findTrack: (id) => tracks.find(tr => tr.id === id),
    trackStats,
    getActiveTrackId: () => activeTrackId,
    setActiveTrack,
    renderTrackList,
    scheduleSave,
    enterEditForTrack: (id) => { setActiveTrack(id); enterEditMode(id); },
    createTrackWithoutTree: (name, coords, opts) => createTrack(name, coords, { ...opts, skipTreeHook: true }),
    ensureTrackGrouping,
    simplifyTrackById: (id, options) => {
      const previousActiveTrackId = activeTrackId;
      setActiveTrack(id);
      const result = simplifyActiveTrackSpan(options);
      if (previousActiveTrackId && previousActiveTrackId !== id) setActiveTrack(id);
      return result;
    },
    densifyTrackById: (id, options) => {
      const previousActiveTrackId = activeTrackId;
      setActiveTrack(id);
      const result = densifyActiveTrackSpan(options);
      if (previousActiveTrackId && previousActiveTrackId !== id) setActiveTrack(id);
      return result;
    },
    splitTrackById: (id, options) => {
      setActiveTrack(id);
      return splitActiveTrackSpan(options);
    },
    convertRouteById: (id, options) => {
      setActiveTrack(id);
      return convertActiveRouteToTrack(options);
    },
    mergeTrackNodeByIds: (ids, options) => mergeSelectedTracks(ids, options),
    suggestTrackNameForFile,
    createWaypoint,
    findWaypointById,
    updateWaypointById,
    deleteWaypointById,
    showProfileForTrack: (id) => { setActiveTrack(id); updateProfileFn(); },
    fitToTrackById: (id) => { const t = tracks.find(tr => tr.id === id); if (t) fitToTrack(t); },
    fitToTrackIds,
    deleteTrackById: (id) => {
      const t = tracks.find(tr => tr.id === id);
      if (!t) return;
      removeTrackById(id);
      scheduleSave();
    },
    renameTrackById: (id, name) => renameTrack(id, name),
    renameGroupByTrackId: (id, name) => {
      const t = tracks.find(tr => tr.id === id);
      if (t?.groupId) renameGroup(t.groupId, name);
    },
  });

  // Add map layers for tracks once map is loaded
  map.on('load', () => {
    rehydrateTrackLayers();
  });
}
