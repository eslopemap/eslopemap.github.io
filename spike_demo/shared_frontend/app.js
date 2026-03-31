const config = globalThis.__SPIKE_CONFIG__;

if (!config) {
  throw new Error('Missing __SPIKE_CONFIG__ bootstrap config.');
}

const statusEls = {
  currentSource: document.getElementById('current-source'),
  lastTileUrl: document.getElementById('last-tile-url'),
  tileRequestCount: document.getElementById('tile-request-count'),
  lastError: document.getElementById('last-error'),
  eventLog: document.getElementById('event-log'),
  sourceMode: document.getElementById('source-mode'),
};

const state = {
  mode: 'online',
  tileRequestCount: 0,
  lastTileUrl: 'n/a',
  lastError: 'none',
};

/** Append one timestamped line to the small event log. */
function pushEvent(message) {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  statusEls.eventLog.prepend(item);
  while (statusEls.eventLog.children.length > 8) {
    statusEls.eventLog.removeChild(statusEls.eventLog.lastElementChild);
  }
}

/** Redraw the debug panel from the current in-memory state. */
function renderStatus() {
  statusEls.currentSource.textContent = state.mode === 'online' ? 'Online OSM' : 'Offline MBTiles';
  statusEls.lastTileUrl.textContent = state.lastTileUrl;
  statusEls.tileRequestCount.textContent = String(state.tileRequestCount);
  statusEls.lastError.textContent = state.lastError;
}

/** Track tile requests through MapLibre's transform hook. */
function trackTileRequest(url) {
  state.tileRequestCount += 1;
  state.lastTileUrl = url;
  renderStatus();
}

const map = new maplibregl.Map({
  container: 'map',
  center: [0, 0],
  zoom: 2,
  attributionControl: true,
  transformRequest(url, resourceType) {
    if (resourceType === 'Tile') {
      trackTileRequest(url);
    }
    return { url };
  },
  style: {
    version: 8,
    sources: {
      online: {
        type: 'raster',
        tiles: [config.onlineTileTemplate],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors',
        maxzoom: 19,
      },
      offline: {
        type: 'raster',
        tiles: [config.offlineTileTemplate],
        tileSize: 256,
        attribution: 'Local dummy MBTiles fixture',
        minzoom: 1,
        maxzoom: 3,
      },
    },
    layers: [
      {
        id: 'online-layer',
        type: 'raster',
        source: 'online',
        layout: { visibility: 'visible' },
      },
      {
        id: 'offline-layer',
        type: 'raster',
        source: 'offline',
        layout: { visibility: 'none' },
      },
    ],
  },
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
pushEvent(`Demo booted: ${config.demoLabel}`);

map.on('load', () => {
  pushEvent('Map style loaded');
  renderStatus();
});

map.on('sourcedata', (event) => {
  if (!event.sourceId || event.sourceDataType !== 'content') {
    return;
  }
  pushEvent(`Source update: ${event.sourceId}`);
});

map.on('error', (event) => {
  const err = event?.error;
  state.lastError = err ? String(err.message || err) : 'unknown map error';
  renderStatus();
  pushEvent(`Map error: ${state.lastError}`);
});

/** Toggle which raster layer is visible without changing the rest of the map. */
function applySourceMode(mode) {
  state.mode = mode;
  state.lastError = 'none';
  map.setLayoutProperty('online-layer', 'visibility', mode === 'online' ? 'visible' : 'none');
  map.setLayoutProperty('offline-layer', 'visibility', mode === 'offline' ? 'visible' : 'none');
  renderStatus();
  pushEvent(`Switched source to ${mode}`);
}

statusEls.sourceMode.addEventListener('change', (event) => {
  applySourceMode(event.target.value);
});

renderStatus();
