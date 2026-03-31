// UI helpers: basemap, legend, cursor info, search, mode state.

import {
  BASEMAP_LAYER_GROUPS, BASEMAP_DEFAULT_VIEW, OPENSKIMAP_LAYER_IDS,
  SWISSTOPO_SKI_LAYER_IDS, IGN_SKI_LAYER_IDS,
  ALL_BASEMAP_LAYER_IDS, DEM_TERRAIN_SOURCE_ID, DEM_MAX_Z, SLOPE_RELIEF_CROSSFADE_Z,
  ANALYSIS_COLOR, COLOR_RELIEF_STOPS,
  rampToLegendCss, interpolateStopsToLegendCss,
} from './constants.js';

import { parseBooleanParam, lonLatToTile, normalizeTileX } from './utils.js';

// ---- Layer visibility helpers ----

function setLayerVisibilitySafe(map, layerId, visible) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

export function setGlobalStatePropertySafe(map, name, value) {
  if (typeof map.setGlobalStateProperty === 'function') {
    map.setGlobalStateProperty(name, value);
  }
}

export function basemapOpacityExpr(multiplier = 1) {
  const base = ['coalesce', ['global-state', 'basemapOpacity'], 1];
  if (multiplier === 1) return base;
  return ['*', multiplier, base];
}

// ---- Basemap / contour / terrain ----

export function applyBasemapSelection(map, state, flyIfOutside) {
  const activeList = BASEMAP_LAYER_GROUPS[state.basemap] || [];
  const active = new Set(activeList);
  for (const layerId of ALL_BASEMAP_LAYER_IDS) {
    setLayerVisibilitySafe(map, layerId, active.has(layerId));
  }

  for (const layerId of activeList) {
    if (map.getLayer(layerId) && map.getLayer('dem-loader')) {
      map.moveLayer(layerId, 'dem-loader');
    }
  }
  for (const layerId of OPENSKIMAP_LAYER_IDS) {
    if (map.getLayer(layerId) && map.getLayer('dem-loader')) {
      map.moveLayer(layerId, 'dem-loader');
    }
  }

  if (flyIfOutside) {
    const dv = BASEMAP_DEFAULT_VIEW[state.basemap];
    if (dv && dv.bounds) {
      const c = map.getCenter();
      const [w, s, e, n] = dv.bounds;
      if (c.lng < w || c.lng > e || c.lat < s || c.lat > n) {
        map.flyTo({center: dv.center, zoom: dv.zoom, duration: 1500});
      }
    }
  }

  const shouldShowContours = (state.basemap === 'osm');
  if (state.basemap !== 'none') state.showContours = shouldShowContours;
  const contourCb = document.getElementById('showContours');
  if (contourCb) contourCb.checked = shouldShowContours;
  applyContourVisibility(map, state);
}

export function applyContourVisibility(map, state) {
  setLayerVisibilitySafe(map, 'contours', state.showContours);
  setLayerVisibilitySafe(map, 'contour-text', state.showContours);
}

export function applyOpenSkiMapOverlay(map, state) {
  for (const id of OPENSKIMAP_LAYER_IDS) {
    setLayerVisibilitySafe(map, id, state.showOpenSkiMap);
  }
}

export function applySwisstopoSkiOverlay(map, state) {
  for (const id of SWISSTOPO_SKI_LAYER_IDS) {
    setLayerVisibilitySafe(map, id, state.showSwisstopoSki);
  }
}

export function applyIgnSlopesOverlay(map, state) {
  for (const id of IGN_SKI_LAYER_IDS) {
    setLayerVisibilitySafe(map, id, state.showIgnSlopes);
  }
}

export function applyTerrainState(map, state) {
  if (state.terrain3d) {
    map.setTerrain({source: DEM_TERRAIN_SOURCE_ID, exaggeration: state.terrainExaggeration});
  } else {
    map.setTerrain(null);
  }
}

// ---- Legend ----

export function updateLegend(state, map) {
  const legend = document.getElementById('legend');
  const ramp = document.getElementById('legendRamp');
  const labels = document.getElementById('legendLabels');

  const effectiveMode = (state.mode === 'slope+relief')
    ? (typeof map !== 'undefined' && map.getZoom() < SLOPE_RELIEF_CROSSFADE_Z ? 'color-relief' : 'slope')
    : state.mode;

  if (!effectiveMode) {
    legend.classList.add('cursor-only');
    ramp.title = '';
    ramp.style.background = 'none';
    labels.innerHTML = '';
  } else if (effectiveMode === 'slope') {
    legend.classList.remove('cursor-only');
    ramp.title = 'Slope (degrees)';
    ramp.style.background = rampToLegendCss('slope');
    labels.innerHTML = '<div class="legend-ticks"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>' +
     '<div class="legend-ticks"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>' +
      '<span>0°</span><span>15°</span><span>30°</span><span>45°</span><span>60°</span><span>75°</span><span>90°</span>';
  } else if (effectiveMode === 'aspect') {
    legend.classList.remove('cursor-only');
    ramp.title = 'Aspect (compass direction)';
    ramp.style.background = rampToLegendCss('aspect');
    labels.innerHTML = '<div class="legend-ticks"><span></span><span></span><span></span><span></span><span></span></div>' +
      '<span>N</span><span>E</span><span>S</span><span>W</span><span>N</span>';
  } else {
    legend.classList.remove('cursor-only');
    ramp.title = 'Elevation color relief (meters)';
    ramp.style.background = interpolateStopsToLegendCss(COLOR_RELIEF_STOPS);
    labels.innerHTML = '<div class="legend-ticks"><span></span><span></span><span></span><span></span><span></span><span></span></div>' +
      '<span>-250 m</span><span>0 m</span><span>500 m</span><span>1500 m</span><span>3000 m</span><span>8000 m</span>';
  }
}

// ---- Mode state ----

export function applyModeState(map, state) {
  const blendMode = state.multiplyBlend ? 'soft-multiply' : 'normal';

  if (!state.mode) {
    if (map.getLayer('analysis')) map.setLayoutProperty('analysis', 'visibility', 'none');
    if (map.getLayer('analysis-relief')) map.setLayoutProperty('analysis-relief', 'visibility', 'none');
    return;
  }

  if (state.mode === 'slope+relief') {
    // Show only the layer relevant to current zoom; hide the other entirely
    // to avoid rendering a fully-transparent terrain-analysis layer.
    const zoom = map.getZoom();
    const showSlope = zoom >= SLOPE_RELIEF_CROSSFADE_Z - 1;
    const showRelief = zoom < SLOPE_RELIEF_CROSSFADE_Z;
    if (map.getLayer('analysis')) {
      map.setLayoutProperty('analysis', 'visibility', showSlope ? 'visible' : 'none');
      if (showSlope) {
        map.setPaintProperty('analysis', 'attribute', 'slope');
        map.setPaintProperty('analysis', 'color', ANALYSIS_COLOR.slope);
        map.setPaintProperty('analysis', 'opacity',
          ['interpolate', ['linear'], ['zoom'],
            SLOPE_RELIEF_CROSSFADE_Z - 1, 0,
            SLOPE_RELIEF_CROSSFADE_Z, state.slopeOpacity
          ]);
        map.setPaintProperty('analysis', 'blend-mode', blendMode);
      }
    }
    if (map.getLayer('analysis-relief')) {
      map.setLayoutProperty('analysis-relief', 'visibility', showRelief ? 'visible' : 'none');
      if (showRelief) {
        map.setPaintProperty('analysis-relief', 'opacity',
          ['interpolate', ['linear'], ['zoom'],
            SLOPE_RELIEF_CROSSFADE_Z - 1, state.slopeOpacity,
            SLOPE_RELIEF_CROSSFADE_Z, 0
          ]);
        map.setPaintProperty('analysis-relief', 'blend-mode', blendMode);
      }
    }
  } else if (state.mode === 'slope' || state.mode === 'aspect') {
    if (map.getLayer('analysis')) {
      map.setLayoutProperty('analysis', 'visibility', 'visible');
      map.setPaintProperty('analysis', 'attribute', state.mode);
      map.setPaintProperty('analysis', 'color', ANALYSIS_COLOR[state.mode]);
      map.setPaintProperty('analysis', 'opacity', state.slopeOpacity);
      map.setPaintProperty('analysis', 'blend-mode', blendMode);
    }
    if (map.getLayer('analysis-relief')) map.setLayoutProperty('analysis-relief', 'visibility', 'none');
  } else if (state.mode === 'color-relief') {
    if (map.getLayer('analysis')) map.setLayoutProperty('analysis', 'visibility', 'none');
    if (map.getLayer('analysis-relief')) {
      map.setLayoutProperty('analysis-relief', 'visibility', 'visible');
      map.setPaintProperty('analysis-relief', 'opacity', state.slopeOpacity);
      map.setPaintProperty('analysis-relief', 'blend-mode', blendMode);
    }
  }
}

// ---- Cursor info / tooltip ----

const cursorTooltip = document.getElementById('cursor-tooltip');

export function setCursorInfo(state, eleText, slopeText) {
  if (state.cursorInfoMode === 'corner') {
    const el = document.getElementById('cursorElevation');
    if (el) el.textContent = eleText;
    const sl = document.getElementById('cursorSlope');
    if (sl) sl.textContent = slopeText || 'n/a';
  }
}

export function showCursorTooltipAt(state, screenX, screenY, eleText, slopeText) {
  if (state.cursorInfoMode !== 'cursor') {
    cursorTooltip.classList.remove('visible');
    return;
  }
  cursorTooltip.innerHTML = `Elev: <code>${eleText}</code> · Slope: <code>${slopeText || 'n/a'}</code>`;
  cursorTooltip.style.left = (screenX + 15) + 'px';
  cursorTooltip.style.top = (screenY + 15) + 'px';
  cursorTooltip.classList.add('visible');
}

export function hideCursorTooltip() {
  cursorTooltip.classList.remove('visible');
}

export function updateCursorInfoVisibility(state) {
  const cursorInfoEl = document.getElementById('cursor-info');
  if (state.cursorInfoMode === 'corner') {
    if (cursorInfoEl) cursorInfoEl.style.display = '';
  } else {
    if (cursorInfoEl) cursorInfoEl.style.display = 'none';
    hideCursorTooltip();
  }
}

// ---- URL hash ----

export function parseHashParams() {
  const hash = window.location.hash.replace(/^#/, '');
  const fallback = {
    center: [6.8652, 45.8326],
    zoom: 12,
    basemap: null,
    mode: 'slope+relief',
    slopeOpacity: 0.45,
    terrain3d: false,
    terrainExaggeration: 1.4,
    bearing: 0,
    pitch: 0
  };

  if (hash.includes('=')) {
    const params = new URLSearchParams(hash);
    const lngRaw = Number(params.get('lng'));
    const latRaw = Number(params.get('lat'));
    const zoomRaw = Number(params.get('zoom'));
    const basemapRaw = (params.get('basemap') || '').trim();
    const modeRaw = (params.get('mode') || '').trim();
    const opacityRaw = Number(params.get('opacity'));
    const terrain3dRaw = parseBooleanParam(params.get('terrain'));
    const terrainExaggerationRaw = Number(params.get('exaggeration'));
    const bearingRaw = Number(params.get('bearing'));
    const pitchRaw = Number(params.get('pitch'));

    const hasLng = Number.isFinite(lngRaw) && lngRaw >= -180 && lngRaw <= 180;
    const hasLat = Number.isFinite(latRaw) && latRaw >= -85.051129 && latRaw <= 85.051129;
    const hasZoom = Number.isFinite(zoomRaw) && zoomRaw >= 0 && zoomRaw <= 24;
    const hasOpacity = Number.isFinite(opacityRaw) && opacityRaw >= 0 && opacityRaw <= 1;
    const hasTerrainExaggeration = Number.isFinite(terrainExaggerationRaw) && terrainExaggerationRaw >= 1 && terrainExaggerationRaw <= 3;
    const hasBearing = Number.isFinite(bearingRaw);
    const hasPitch = Number.isFinite(pitchRaw) && pitchRaw >= 0 && pitchRaw <= 85;
    const validModes = new Set(['', 'slope+relief', 'slope', 'aspect', 'color-relief']);

    return {
      center: (hasLng && hasLat) ? [lngRaw, latRaw] : fallback.center,
      zoom: hasZoom ? zoomRaw : fallback.zoom,
      basemap: (basemapRaw && BASEMAP_LAYER_GROUPS[basemapRaw]) ? basemapRaw : null,
      mode: validModes.has(modeRaw) ? modeRaw : fallback.mode,
      slopeOpacity: hasOpacity ? opacityRaw : fallback.slopeOpacity,
      terrain3d: terrain3dRaw == null ? fallback.terrain3d : terrain3dRaw,
      terrainExaggeration: hasTerrainExaggeration ? terrainExaggerationRaw : fallback.terrainExaggeration,
      bearing: hasBearing ? bearingRaw : fallback.bearing,
      pitch: hasPitch ? pitchRaw : fallback.pitch
    };
  }

  return fallback;
}

export function syncViewToUrl(map, state) {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const bearing = map.getBearing();
  const pitch = map.getPitch();
  const params = new URLSearchParams();
  params.set('lng', center.lng.toFixed(6));
  params.set('lat', center.lat.toFixed(6));
  params.set('zoom', zoom.toFixed(2));
  params.set('basemap', state.basemap);
  params.set('mode', state.mode);
  params.set('opacity', state.slopeOpacity.toFixed(2));
  params.set('terrain', state.terrain3d ? '1' : '0');
  params.set('exaggeration', state.terrainExaggeration.toFixed(2));
  params.set('bearing', bearing.toFixed(2));
  params.set('pitch', pitch.toFixed(2));
  const hash = `#${params.toString()}`;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
}

// ---- Tile grid ----

export function getVisibleTriplesForMap(map) {
  const z = Math.min(DEM_MAX_Z, Math.max(0, Math.floor(map.getZoom())));
  const bounds = map.getBounds();
  const north = bounds.getNorth();
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const east = bounds.getEast();

  const lonRanges = (west <= east) ? [[west, east]] : [[west, 180], [-180, east]];
  const out = [];

  for (const range of lonRanges) {
    const nw = lonLatToTile(range[0], north, z);
    const se = lonLatToTile(range[1], south, z);
    const xMin = Math.min(nw.x, se.x);
    const xMax = Math.max(nw.x, se.x);
    const yMin = Math.min(nw.y, se.y);
    const yMax = Math.max(nw.y, se.y);

    for (let y = yMin; y <= yMax; y++) {
      if (y < 0 || y >= Math.pow(2, z)) continue;
      for (let x = xMin; x <= xMax; x++) {
        const wx = normalizeTileX(x, z);
        out.push({z, x: wx, y, key: `${z}/${wx}/${y}`});
      }
    }
  }

  return out;
}

// ---- Search (Nominatim) ----

export function initSearch(map) {
  const searchBox = document.getElementById('search-box');
  const searchIcon = document.getElementById('search-icon');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  let searchDebounce = 0;
  let searchAbort = null;

  function expandSearch() {
    searchBox.classList.add('expanded');
    searchInput.focus();
  }
  function collapseSearch() {
    searchBox.classList.remove('expanded');
    searchInput.value = '';
    searchResults.classList.remove('visible');
    searchResults.innerHTML = '';
  }

  searchIcon.addEventListener('click', () => {
    if (searchBox.classList.contains('expanded')) {
      collapseSearch();
    } else {
      expandSearch();
    }
  });

  searchBox.addEventListener('mouseenter', () => {
    if (!searchBox.classList.contains('expanded')) expandSearch();
  });

  document.addEventListener('click', (e) => {
    if (!searchBox.contains(e.target)) collapseSearch();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') collapseSearch();
  });

  async function nominatimSearch(query) {
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      signal: searchAbort.signal,
      headers: {'Accept-Language': navigator.language || 'en'}
    });
    return resp.json();
  }

  function renderResults(results) {
    searchResults.innerHTML = '';
    if (!results.length) {
      searchResults.classList.remove('visible');
      return;
    }
    for (const r of results) {
      const div = document.createElement('div');
      div.className = 'search-result';
      const nameParts = r.display_name.split(', ');
      const name = nameParts[0];
      const detail = nameParts.slice(1, 3).join(', ');
      div.innerHTML = `<div class="search-result-name">${name}</div><div class="search-result-detail">${detail}</div>`;
      div.addEventListener('click', () => {
        const lon = parseFloat(r.lon);
        const lat = parseFloat(r.lat);
        const bbox = r.boundingbox;
        if (bbox) {
          map.fitBounds([[parseFloat(bbox[2]), parseFloat(bbox[0])], [parseFloat(bbox[3]), parseFloat(bbox[1])]], {
            padding: 40, maxZoom: 15, duration: 1500
          });
        } else {
          map.flyTo({center: [lon, lat], zoom: 13, duration: 1500});
        }
        collapseSearch();
      });
      searchResults.appendChild(div);
    }
    searchResults.classList.add('visible');
  }

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    clearTimeout(searchDebounce);
    if (q.length < 2) {
      searchResults.classList.remove('visible');
      searchResults.innerHTML = '';
      return;
    }
    searchDebounce = setTimeout(async () => {
      try {
        const results = await nominatimSearch(q);
        renderResults(results);
      } catch (err) {
        if (err.name !== 'AbortError') console.error('Search failed:', err);
      }
    }, 350);
  });
}
