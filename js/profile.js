// Elevation profile (Chart.js).

import { haversineKm } from './utils.js';
import { queryLoadedElevationAtLngLat } from './dem.js';
import { showCursorTooltipAt, hideCursorTooltip } from './ui.js';

let map, state, tracksState;

const profilePanel = document.getElementById('profile-panel');
const profileCanvas = document.getElementById('profile-canvas');
let profileChart = null;
let hoveredProfileTrackId = null;
let hoveredProfileVertexIndex = null;

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
  if (!t || index == null || index < 0 || index >= t.coords.length) {
    clearProfileHoverVertex();
    hideCursorTooltip();
    return;
  }
  if (hoveredProfileTrackId === t.id && hoveredProfileVertexIndex === index) return;
  hoveredProfileTrackId = t.id;
  hoveredProfileVertexIndex = index;
  const coord = t.coords[index];
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
      showCursorTooltipAt(state, rect.left + pt.x, rect.top + pt.y, `${result.elevation.toFixed(0)} m`, result.slopeDeg != null ? `${result.slopeDeg.toFixed(0)}°` : 'n/a');
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

function computeProfile(coords) {
  const distances = [0];
  const elevations = [];
  const slopes = [];
  const terrainSlopes = [];
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) distances.push(distances[i-1] + haversineKm(coords[i-1], coords[i]));
    elevations.push(coords[i][2] != null ? coords[i][2] : null);
    const terrainSample = queryLoadedElevationAtLngLat(map, {lng: coords[i][0], lat: coords[i][1]});
    terrainSlopes.push(terrainSample && Number.isFinite(terrainSample.slopeDeg) ? terrainSample.slopeDeg : null);
    if (i > 0) {
      const dh = (coords[i][2] != null && coords[i-1][2] != null)
        ? coords[i][2] - coords[i-1][2] : null;
      const dd = (distances[i] - distances[i-1]) * 1000;
      slopes.push(dh != null && dd > 0 ? Math.sign(dh) * Math.atan2(Math.abs(dh), dd) * 180 / Math.PI : null);
    } else {
      slopes.push(null);
    }
  }
  return {distances, elevations, slopes, terrainSlopes};
}

export function updateProfile() {
  const t = tracksState.getActiveTrack();
  if (!t || t.coords.length < 2 || tracksState.profileClosed) {
    if (!t || t.coords.length < 2) {
      closeProfile(false);
    }
    tracksState.syncProfileToggleButton();
    return;
  }
  const {distances, elevations, slopes, terrainSlopes} = computeProfile(t.coords);
  const labels = distances.map(d => d.toFixed(2));

  destroyProfileChart();
  profilePanel.classList.add('visible');
  syncBottomRightOffset();
  tracksState.syncProfileToggleButton();

  profileChart = new Chart(profileCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Elevation (m)',
          data: elevations,
          borderColor: '#4a90d9',
          backgroundColor: 'rgba(74,144,217,0.12)',
          fill: true,
          pointRadius: 0,
          borderWidth: 1.5,
          tension: 0.3,
          yAxisID: 'yEle',
          spanGaps: true
        },
        {
          label: 'Track slope (°)',
          data: slopes,
          borderColor: '#e53935',
          pointRadius: 0,
          borderWidth: 1,
          tension: 0.3,
          yAxisID: 'ySlope',
          spanGaps: true
        },
        {
          label: 'Terrain slope (°)',
          data: terrainSlopes,
          borderColor: '#7c3aed',
          pointRadius: 0,
          borderWidth: 1,
          borderDash: [5, 3],
          tension: 0.3,
          yAxisID: 'ySlope',
          spanGaps: true
        }
      ]
    },
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
        legend: { display: true, position: 'top', labels: { boxWidth: 12, font: {size: 10} } },
        annotation: {
          annotations: {
            zeroLine: {
              type: 'line',
              yMin: 0,
              yMax: 0,
              yScaleID: 'ySlope',
              borderColor: 'rgba(0,0,0,0.25)',
              borderWidth: 1,
              borderDash: [4, 3]
            }
          }
        },
        tooltip: {
          callbacks: {
            title: (items) => items[0] ? `${items[0].label} km` : ''
          }
        }
      },
      scales: {
        x: {
          display: true,
          title: { display: true, text: 'km', font: {size: 10} },
          ticks: { font: {size: 9}, maxTicksLimit: 10 }
        },
        yEle: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'm', font: {size: 10} },
          ticks: { font: {size: 9} },
          grid: { drawOnChartArea: true }
        },
        ySlope: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: '°', font: {size: 10} },
          ticks: { font: {size: 9} },
          grid: { drawOnChartArea: false }
        }
      }
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

  document.getElementById('profile-close').addEventListener('click', () => {
    closeProfile(true);
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
