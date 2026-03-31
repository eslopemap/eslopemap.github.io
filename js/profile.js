// Elevation profile (Chart.js).
// Features: elevation, track slope, terrain slope, horizontal speed, vertical speed,
// pause detection, multiple x-axis modes, display settings menu.

import { haversineKm, smoothArray } from './utils.js';

function clampTo90th(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v) && isFinite(v));
  if (valid.length === 0) return arr;
  valid.sort((a,b) => a - b);
  const p90 = valid[Math.floor(valid.length * 0.9)];
  return arr.map(v => (v != null && v > p90) ? p90 : v);
}

function clampVSpeed(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v) && isFinite(v) && v > 0);
  if (valid.length === 0) return arr.map(v => (v != null && v < 0) ? 0 : v);
  valid.sort((a,b) => a - b);
  const p90 = valid[Math.floor(valid.length * 0.9)];
  return arr.map(v => {
    if (v == null) return null;
    if (v < 0) return 0;
    if (v > p90) return p90;
    return v;
  });
}

import { queryLoadedElevationAtLngLat } from './dem.js';
import { showCursorTooltipAt, hideCursorTooltip } from './ui.js';
import { saveProfileSettings, loadProfileSettings } from './persist.js';

let map, state, tracksState;

const profilePanel = document.getElementById('profile-panel');
const profileCanvas = document.getElementById('profile-canvas');
let profileChart = null;
let hoveredProfileTrackId = null;
let hoveredProfileVertexIndex = null;
let currentProfileSourceIndices = [];
let currentProfileFilterLabel = '';

// ---- Display settings (persisted) ----
const displayDefaults = {
  showElevation: true,
  showTrackSlope: true,
  showTerrainSlope: true,
  showSpeed: false,
  showVSpeed: false,
  showPauses: true,
  xAxis: 'distance',
};
let display = { ...displayDefaults };

function loadDisplay() {
  const saved = loadProfileSettings();
  if (saved) Object.assign(display, saved);
}

function saveDisplay() {
  saveProfileSettings(display);
}

function syncDisplayCheckboxes() {
  document.getElementById('prof-show-elevation').checked = display.showElevation;
  document.getElementById('prof-show-trackslope').checked = display.showTrackSlope;
  document.getElementById('prof-show-terrainslope').checked = display.showTerrainSlope;
  document.getElementById('prof-show-speed').checked = display.showSpeed;
  document.getElementById('prof-show-vspeed').checked = display.showVSpeed;
  document.getElementById('prof-show-pauses').checked = display.showPauses;
  document.getElementById('prof-x-axis').value = display.xAxis;
}

// ---- Hover vertex ----

function clearProfileHoverVertex() {
  hoveredProfileTrackId = null;
  hoveredProfileVertexIndex = null;
  const src = map.getSource(tracksState.PROFILE_HOVER_SOURCE_ID);
  if (src) src.setData({type: 'FeatureCollection', features: []});
}

function ensureVertexInView(lngLat) {
  const canvas = map.getCanvas();
  const trackPanel = document.getElementById('track-panel');
  const padding = {
    top: 50,
    right: trackPanel.classList.contains('visible') ? 220 : 60,
    bottom: profilePanel.classList.contains('visible') ? 170 : 60,
    left: 60
  };
  const point = map.project([lngLat.lng, lngLat.lat]);
  const withinX = point.x >= padding.left && point.x <= canvas.clientWidth - padding.right;
  const withinY = point.y >= padding.top && point.y <= canvas.clientHeight - padding.bottom;
  if (withinX && withinY) return;
  map.easeTo({
    center: [lngLat.lng, lngLat.lat],
    duration: 1000,
    essential: true,
    padding
  });
}

function setProfileHoverVertex(index) {
  const t = tracksState.getActiveTrack();
  const sourceIndex = index != null ? currentProfileSourceIndices[index] : null;
  if (!t || sourceIndex == null || sourceIndex < 0 || sourceIndex >= t.coords.length) {
    clearProfileHoverVertex();
    hideCursorTooltip();
    return;
  }
  if (hoveredProfileTrackId === t.id && hoveredProfileVertexIndex === sourceIndex) return;
  hoveredProfileTrackId = t.id;
  hoveredProfileVertexIndex = sourceIndex;
  const coord = t.coords[sourceIndex];
  const src = map.getSource(tracksState.PROFILE_HOVER_SOURCE_ID);
  if (src) {
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [coord[0], coord[1]]},
        properties: {color: t.color}
      }]
    });
  }
  ensureVertexInView({lng: coord[0], lat: coord[1]});
  if (state.cursorInfoMode === 'cursor') {
    const result = queryLoadedElevationAtLngLat(map, {lng: coord[0], lat: coord[1]});
    if (result) {
      const pt = map.project([coord[0], coord[1]]);
      const rect = map.getCanvas().getBoundingClientRect();
      const lngLat = {lng: coord[0], lat: coord[1]};
      showCursorTooltipAt(state, rect.left + pt.x, rect.top + pt.y, lngLat, `${result.elevation.toFixed(0)} m`, result.slopeDeg != null ? `${result.slopeDeg.toFixed(0)}°` : 'n/a');
    }
  }
}

function destroyProfileChart() {
  clearProfileHoverVertex();
  if (profileChart) { profileChart.destroy(); profileChart = null; }
}

function syncBottomRightOffset() {
  document.body.classList.toggle('profile-open', profilePanel.classList.contains('visible'));
}

export function closeProfile(markClosed) {
  profilePanel.classList.remove('visible');
  if (markClosed) tracksState.profileClosed = true;
  destroyProfileChart();
  syncBottomRightOffset();
  tracksState.syncProfileToggleButton();
}

// ---- Profile data computation ----

function computeProfile(coords, pauseThresholdMin, smoothingRadius = 0) {
  const n = coords.length;
  const distances = [0];    // cumulative km
  const elevations = [];
  const slopes = [];        // track slope deg (signed)
  const terrainSlopes = [];
  const speeds = [];        // horizontal km/h
  const vSpeeds = [];       // vertical m/h
  const timestamps = [];    // epoch ms or null
  const pauses = [];        // {index, durationMin}
  const cumulativeTime = [0]; // seconds from start
  const cumulativeTimeNoPauses = [0]; // seconds excluding pauses

  const pauseThresholdMs = pauseThresholdMin * 60 * 1000;
  const hasTime = coords.some(c => c[3] != null);

  for (let i = 0; i < n; i++) {
    const c = coords[i];
    timestamps.push(c[3] != null ? c[3] : null);
    elevations.push(c[2] != null ? c[2] : null);

    const terrainSample = queryLoadedElevationAtLngLat(map, {lng: c[0], lat: c[1]});
    terrainSlopes.push(terrainSample && Number.isFinite(terrainSample.slopeDeg) ? terrainSample.slopeDeg : null);

    if (i > 0) {
      const segKm = haversineKm(coords[i - 1], coords[i]);
      distances.push(distances[i - 1] + segKm);

      // Track slope
      const dh = (c[2] != null && coords[i-1][2] != null) ? c[2] - coords[i-1][2] : null;
      const dd = segKm * 1000;
      slopes.push(dh != null && dd > 0 ? Math.sign(dh) * Math.atan2(Math.abs(dh), dd) * 180 / Math.PI : null);

      // Time-based: speed, vertical speed, pauses
      const t0 = coords[i-1][3], t1 = c[3];
      if (t0 != null && t1 != null && t1 > t0) {
        const dtSec = (t1 - t0) / 1000;
        const dtHr = dtSec / 3600;

        // Pause detection
        if ((t1 - t0) >= pauseThresholdMs) {
          pauses.push({ index: i, durationMin: (t1 - t0) / 60000 });
          cumulativeTime.push(cumulativeTime[i-1] + dtSec);
          cumulativeTimeNoPauses.push(cumulativeTimeNoPauses[i-1]); // don't advance
        } else {
          cumulativeTime.push(cumulativeTime[i-1] + dtSec);
          cumulativeTimeNoPauses.push(cumulativeTimeNoPauses[i-1] + dtSec);
        }

        speeds.push(dtHr > 0 ? segKm / dtHr : null);
        vSpeeds.push(dh != null && dtHr > 0 ? dh / dtHr : null);
      } else {
        cumulativeTime.push(cumulativeTime[i-1]);
        cumulativeTimeNoPauses.push(cumulativeTimeNoPauses[i-1]);
        speeds.push(null);
        vSpeeds.push(null);
      }
    } else {
      slopes.push(null);
      speeds.push(null);
      vSpeeds.push(null);
    }
  }

  return {
    distances, elevations,
    slopes: smoothArray(slopes, smoothingRadius),
    terrainSlopes: smoothArray(terrainSlopes, smoothingRadius),
    speeds: smoothArray(speeds, smoothingRadius),
    vSpeeds: smoothArray(vSpeeds, smoothingRadius),
    timestamps, pauses, cumulativeTime, cumulativeTimeNoPauses, hasTime,
  };
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}m`;
}

function formatTime(epochMs) {
  const d = new Date(epochMs);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function buildXLabels(profile, xAxis) {
  const n = profile.distances.length;
  switch (xAxis) {
    case 'time':
      return Array.from({ length: n }, (_, i) => formatDuration(profile.cumulativeTime[i]));
    case 'time-no-pauses':
      return Array.from({ length: n }, (_, i) => formatDuration(profile.cumulativeTimeNoPauses[i]));
    case 'datetime':
      return Array.from({ length: n }, (_, i) =>
        profile.timestamps[i] != null ? formatTime(profile.timestamps[i]) : '');
    default: // distance
      return profile.distances.map(d => d.toFixed(2));
  }
}

function xAxisUnit(xAxis) {
  switch (xAxis) {
    case 'time': return 'time';
    case 'time-no-pauses': return 'moving time';
    case 'datetime': return '';
    default: return 'km';
  }
}

function getProfileTarget() {
  const track = tracksState.getActiveTrack();
  if (!track) return null;
  const selectionSpan = tracksState.selectionSpan;
  if (selectionSpan?.ok && selectionSpan.trackId === track.id && selectionSpan.pointCount >= 2) {
    return {
      track,
      coords: selectionSpan.coords,
      sourceIndices: selectionSpan.sourceIndices,
      filterLabel: `${selectionSpan.trackName} · ${selectionSpan.rangeLabel}`,
    };
  }
  return {
    track,
    coords: track.coords,
    sourceIndices: Array.from({ length: track.coords.length }, (_unused, index) => index),
    filterLabel: '',
  };
}

function syncProfileFilterUi(filterLabel) {
  const badge = document.getElementById('profile-filter-badge');
  const resetBtn = document.getElementById('profile-filter-reset');
  currentProfileFilterLabel = filterLabel || '';
  badge.textContent = filterLabel || '';
  badge.classList.toggle('visible', Boolean(filterLabel));
  resetBtn.style.display = filterLabel ? '' : 'none';
}

// ---- Chart building ----

export function updateProfile() {
  const target = getProfileTarget();
  const t = target?.track || null;
  const coords = target?.coords || [];
  if (!t || coords.length < 2 || tracksState.profileClosed) {
    syncProfileFilterUi('');
    currentProfileSourceIndices = [];
    if (!t || coords.length < 2) {
      closeProfile(false);
    }
    tracksState.syncProfileToggleButton();
    return;
  }

  const pauseThreshold = state.pauseThreshold || 5;
  const smoothingRadius = state.profileSmoothing || 0;
  currentProfileSourceIndices = target.sourceIndices;
  syncProfileFilterUi(target.filterLabel);
  const profile = computeProfile(coords, pauseThreshold, smoothingRadius);
  const xAxis = profile.hasTime ? display.xAxis : 'distance';
  const labels = buildXLabels(profile, xAxis);
  const unit = xAxisUnit(xAxis);

  destroyProfileChart();
  profilePanel.classList.add('visible');
  syncBottomRightOffset();
  tracksState.syncProfileToggleButton();

  // Disable time x-axis options if no timestamps
  const xAxisSelect = document.getElementById('prof-x-axis');
  for (const opt of xAxisSelect.options) {
    if (opt.value !== 'distance') opt.disabled = !profile.hasTime;
  }

  // Build datasets
  const datasets = [];
  if (display.showElevation) {
    datasets.push({
      label: 'Elevation (m)',
      data: profile.elevations,
      borderColor: '#4a90d9',
      backgroundColor: 'rgba(74,144,217,0.12)',
      fill: true,
      pointRadius: 0,
      borderWidth: 1.5,
      tension: 0.3,
      yAxisID: 'yEle',
      spanGaps: true
    });
  }
  if (display.showTrackSlope) {
    datasets.push({
      label: 'Track slope (°)',
      data: profile.slopes,
      borderColor: '#e53935',
      pointRadius: 0,
      borderWidth: 1,
      tension: 0.3,
      yAxisID: 'ySlope',
      spanGaps: true
    });
  }
  if (display.showTerrainSlope) {
    datasets.push({
      label: 'Terrain slope (°)',
      data: profile.terrainSlopes,
      borderColor: '#7c3aed',
      pointRadius: 0,
      borderWidth: 1,
      borderDash: [5, 3],
      tension: 0.3,
      yAxisID: 'ySlope',
      spanGaps: true
    });
  }
  if (display.showSpeed && profile.hasTime) {
    datasets.push({
      label: 'Speed (km/h)',
      data: profile.speeds,
      borderColor: '#16a34a',
      pointRadius: 0,
      borderWidth: 1,
      tension: 0.3,
      yAxisID: 'ySpeed',
      spanGaps: true
    });
  }
  if (display.showVSpeed && profile.hasTime) {
    datasets.push({
      label: 'V. speed (m/h)',
      data: profile.vSpeeds,
      borderColor: '#ca8a04',
      pointRadius: 0,
      borderWidth: 1,
      borderDash: [3, 2],
      tension: 0.3,
      yAxisID: 'yVSpeed',
      spanGaps: true
    });
  }

  // Build pause annotations
  const annotations = {};
  const hasSlope = display.showTrackSlope || display.showTerrainSlope;
  if (hasSlope) {
    annotations.zeroLine = {
      type: 'line',
      yMin: 0, yMax: 0,
      yScaleID: 'ySlope',
      borderColor: 'rgba(0,0,0,0.25)',
      borderWidth: 1,
      borderDash: [4, 3]
    };
  }

  if (display.showPauses && profile.pauses.length) {
    for (let pi = 0; pi < profile.pauses.length; pi++) {
      const p = profile.pauses[pi];
      annotations['pause' + pi] = {
        type: 'point',
        xValue: p.index,
        yValue: profile.elevations[p.index] != null ? profile.elevations[p.index] : 0,
        yScaleID: display.showElevation ? 'yEle' : (hasSlope ? 'ySlope' : 'yEle'),
        backgroundColor: 'rgba(239,68,68,0.7)',
        borderColor: '#fff',
        borderWidth: 1,
        radius: 4,
        label: {
          display: true,
          content: `${Math.round(p.durationMin)}m`,
          position: 'top',
          font: { size: 9 },
          color: '#dc2626',
          backgroundColor: 'rgba(255,255,255,0.8)',
          padding: 2
        }
      };
    }
  }

  // Build scales
  const scales = {
    x: {
      display: true,
      title: { display: unit !== '', text: unit, font: { size: 10 }, padding: { top: 0 } },
      ticks: { font: { size: 9 }, maxTicksLimit: 10 }
    }
  };

  if (display.showElevation) {
    scales.yEle = {
      type: 'linear', position: 'left',
      title: { display: true, text: 'm', font: { size: 10 } },
      ticks: { font: { size: 9 } },
      grid: { drawOnChartArea: true }
    };
  }
  if (hasSlope) {
    scales.ySlope = {
      type: 'linear', position: display.showElevation ? 'right' : 'left',
      title: { display: true, text: '°', font: { size: 10 } },
      ticks: { font: { size: 9 } },
      grid: { drawOnChartArea: !display.showElevation }
    };
  }
  if (display.showSpeed && profile.hasTime) {
    const valid = profile.speeds.filter(v => v != null && isFinite(v));
    valid.sort((a,b) => a-b);
    const p90 = valid.length > 0 ? valid[Math.floor(valid.length * 0.9)] : undefined;
    scales.ySpeed = {
      max: p90 ? Math.ceil(p90) : undefined,
      type: 'linear', position: 'right',
      title: { display: true, text: 'km/h', font: { size: 10 } },
      ticks: { font: { size: 9 } },
      grid: { drawOnChartArea: false }
    };
  }
  if (display.showVSpeed && profile.hasTime) {
    const valid = profile.vSpeeds.filter(v => v != null && isFinite(v) && v > 0);
    valid.sort((a,b) => a-b);
    const p90 = valid.length > 0 ? valid[Math.floor(valid.length * 0.9)] : undefined;
    scales.yVSpeed = {
      min: 0,
      max: p90 ? Math.ceil(p90) : undefined,
      type: 'linear', position: 'right',
      title: { display: true, text: 'm/h', font: { size: 10 } },
      ticks: { font: { size: 9 } },
      grid: { drawOnChartArea: false }
    };
  }

  profileChart = new Chart(profileCanvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      onHover: (_event, activeElements) => {
        if (activeElements && activeElements.length) setProfileHoverVertex(activeElements[0].index);
        else clearProfileHoverVertex();
      },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        annotation: { annotations },
        tooltip: {
          callbacks: {
            title: (items) => {
              if (!items[0]) return '';
              const idx = items[0].dataIndex;
              const parts = [];
              if (xAxis === 'distance') parts.push(`${profile.distances[idx].toFixed(2)} km`);
              else parts.push(items[0].label);
              if (profile.hasTime && xAxis === 'distance' && profile.timestamps[idx] != null) {
                parts.push(formatTime(profile.timestamps[idx]));
              }
              return parts.join(' · ');
            }
          }
        }
      },
      scales
    }
  });
}

export function getProfileChart() {
  return profileChart;
}

export function initProfile(mapRef, stateRef, tracksStateRef) {
  map = mapRef;
  state = stateRef;
  tracksState = tracksStateRef;

  loadDisplay();
  syncDisplayCheckboxes();

  // Profile menu toggle
  const menuBtn = document.getElementById('profile-menu-btn');
  const menuDropdown = document.getElementById('profile-menu-dropdown');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle('visible');
  });
  document.addEventListener('click', (e) => {
    if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
      menuDropdown.classList.remove('visible');
    }
  });

  // Display setting checkboxes
  const checkboxMap = {
    'prof-show-elevation': 'showElevation',
    'prof-show-trackslope': 'showTrackSlope',
    'prof-show-terrainslope': 'showTerrainSlope',
    'prof-show-speed': 'showSpeed',
    'prof-show-vspeed': 'showVSpeed',
    'prof-show-pauses': 'showPauses',
  };
  for (const [elId, key] of Object.entries(checkboxMap)) {
    document.getElementById(elId).addEventListener('change', (e) => {
      display[key] = e.target.checked;
      saveDisplay();
      updateProfile();
    });
  }
  document.getElementById('prof-x-axis').addEventListener('change', (e) => {
    display.xAxis = e.target.value;
    saveDisplay();
    updateProfile();
  });

  document.getElementById('profile-close').addEventListener('click', () => {
    closeProfile(true);
  });

  const resizeBtn = document.getElementById('profile-resize-btn');
  if (resizeBtn) {
    resizeBtn.addEventListener('click', () => {
      document.getElementById('profile-panel').classList.toggle('expanded');
      if (chart) chart.resize();
    });
  }

  document.getElementById('profile-filter-reset').addEventListener('click', () => {
    tracksState.clearSelectionSpan();
    updateProfile();
  });

  const profileToggleBtn = document.getElementById('profile-toggle-btn');
  profileToggleBtn.addEventListener('click', () => {
    const t = tracksState.getActiveTrack();
    if (!t || t.coords.length < 2) return;
    if (profilePanel.classList.contains('visible') && !tracksState.profileClosed) {
      closeProfile(true);
      return;
    }
    tracksState.profileClosed = false;
    updateProfile();
  });

  profileCanvas.addEventListener('mouseleave', () => {
    clearProfileHoverVertex();
    hideCursorTooltip();
  });
}
