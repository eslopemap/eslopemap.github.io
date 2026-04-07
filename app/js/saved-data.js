// Saved Data panel — shows storage usage per category with clear buttons.
// Works in both web (localStorage only) and desktop (localStorage + Tauri IPC).

import {
  getTrackStats, getSettingsStats, getAllStats,
  clearAll, clearTracks, clearSettings,
} from './persist.js';
import { isTauri, getCacheStats, clearTileCache } from './tauri-bridge.js';

// ---- Helpers ----

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2000);
}

// ---- Row builder ----

function buildRow(label, { path, size, detail, onClear, clearLabel }) {
  const row = document.createElement('div');
  row.className = 'saved-data-row';

  const info = document.createElement('div');
  info.className = 'saved-data-info';

  const title = document.createElement('strong');
  title.textContent = label;
  info.appendChild(title);

  if (path) {
    const pathEl = document.createElement('div');
    pathEl.className = 'saved-data-path';
    pathEl.textContent = path;
    pathEl.title = path;
    info.appendChild(pathEl);
  }

  const sizeEl = document.createElement('div');
  sizeEl.className = 'saved-data-size';
  sizeEl.textContent = size;
  if (detail) sizeEl.textContent += ` — ${detail}`;
  sizeEl.dataset.testid = `saved-data-size-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  info.appendChild(sizeEl);

  row.appendChild(info);

  if (onClear) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'saved-data-clear-btn';
    btn.textContent = clearLabel || 'Clear';
    btn.dataset.testid = `saved-data-clear-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    btn.addEventListener('click', async () => {
      const confirmMsg = `Clear ${label.toLowerCase()}?`;
      if (!confirm(confirmMsg)) return;
      await onClear();
      showToast(`${label} cleared`);
      // Refresh the panel after clearing
      await refreshPanel();
    });
    row.appendChild(btn);
  }

  return row;
}

// ---- Browser tile cache (CacheStorage) ----

async function getBrowserTileCacheStats() {
  if (typeof caches === 'undefined') return null;
  try {
    const keys = await caches.keys();
    // maplibre-contour uses 'demtiles' cache; maplibre-gl may use others
    let totalSize = 0;
    let totalCount = 0;
    const cacheNames = [];
    for (const name of keys) {
      const cache = await caches.open(name);
      const cacheKeys = await cache.keys();
      totalCount += cacheKeys.length;
      cacheNames.push(name);
      // CacheStorage doesn't expose size directly; estimate from response bodies
      for (const req of cacheKeys) {
        try {
          const resp = await cache.match(req);
          if (resp) {
            const buf = await resp.clone().arrayBuffer();
            totalSize += buf.byteLength;
          }
        } catch { /* skip unreadable entries */ }
      }
    }
    return { totalSize, totalCount, cacheNames };
  } catch { return null; }
}

async function clearBrowserTileCache() {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    for (const name of keys) {
      await caches.delete(name);
    }
  } catch { /* ignore */ }
}

// ---- Panel refresh ----

let _panelEl = null;

async function refreshPanel() {
  const panel = _panelEl;
  if (!panel) return;

  const container = panel.querySelector('#saved-data-rows');
  if (!container) return;
  container.innerHTML = '';

  // 1. Local JS tile cache (CacheStorage)
  const browserCache = await getBrowserTileCacheStats();
  if (browserCache) {
    container.appendChild(buildRow('Local tile cache', {
      size: formatBytes(browserCache.totalSize),
      detail: `${browserCache.totalCount} entries` + (browserCache.cacheNames.length ? ` in ${browserCache.cacheNames.join(', ')}` : ''),
      onClear: clearBrowserTileCache,
    }));
  } else {
    container.appendChild(buildRow('Local tile cache', {
      size: 'Not available',
      detail: 'CacheStorage API not supported',
    }));
  }

  // 2. Server-side tile cache (Tauri only)
  if (isTauri()) {
    const stats = await getCacheStats();
    if (stats) {
      container.appendChild(buildRow('Server tile cache', {
        path: stats.root,
        size: formatBytes(stats.total_size_bytes),
        detail: `${stats.file_count} tiles (max ${formatBytes(stats.max_size_bytes)})`,
        onClear: clearTileCache,
      }));
    }
  }

  // 3. GPX tracks & waypoints
  const trackStats = getTrackStats();
  container.appendChild(buildRow('GPX tracks', {
    path: 'localStorage (slope:tracks, slope:waypoints, slope:workspace)',
    size: formatBytes(trackStats.bytes),
    detail: `${trackStats.trackCount} tracks, ${trackStats.waypointCount} waypoints`,
    onClear: () => { clearTracks(); location.reload(); },
    clearLabel: 'Clear & reload',
  }));

  // 4. Settings
  const settingsStats = getSettingsStats();
  container.appendChild(buildRow('Settings', {
    path: 'localStorage (slope:settings, slope:profile-settings)',
    size: formatBytes(settingsStats.bytes),
    onClear: () => { clearSettings(); location.reload(); },
    clearLabel: 'Reset & reload',
  }));

  // 5. All browser data
  const allStats = getAllStats();
  container.appendChild(buildRow('All browser data', {
    path: `localStorage (${allStats.keyCount} slope:* keys)`,
    size: formatBytes(allStats.bytes),
    onClear: () => { clearAll(); location.reload(); },
    clearLabel: 'Clear all & reload',
  }));
}

// ---- Init ----

export function initSavedDataPanel() {
  _panelEl = document.getElementById('saved-data-panel');
  if (!_panelEl) return;

  const toggle = document.getElementById('saved-data-toggle');
  if (toggle) {
    toggle.addEventListener('click', async () => {
      const isOpen = !_panelEl.classList.contains('collapsed');
      _panelEl.classList.toggle('collapsed', isOpen);
      toggle.classList.toggle('open', !isOpen);
      if (!isOpen) await refreshPanel();
    });
  }
}

export { refreshPanel as refreshSavedData };
