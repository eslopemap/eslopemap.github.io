// Layer engine — consumes the catalog to toggle basemaps, overlays,
// manage z-order, per-layer settings, and bookmarks.

import {
  getCatalogEntry, getLayerIds, getAllBasemapLayerIds, getOverlays,
  generateBookmarkName,
} from './layer-registry.js';

// ── Helpers ─────────────────────────────────────────────────────────

function setLayerVisibilitySafe(map, layerId, visible) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function getNativeBasemapLayerIds(map) {
  if (!map.__nativeBasemapLayerIds) {
    map.__nativeBasemapLayerIds = new Map();
  }
  return map.__nativeBasemapLayerIds;
}

function isNativeStyleBasemap(map, catalogId) {
  return getNativeBasemapLayerIds(map).has(catalogId);
}

function getCatalogLayerIdsForMap(map, catalogId) {
  const runtimeIds = getNativeBasemapLayerIds(map).get(catalogId);
  return runtimeIds ? [...runtimeIds] : getLayerIds(catalogId);
}

function getAllBasemapLayerIdsForMap(map) {
  const runtimeIds = [...getNativeBasemapLayerIds(map).values()].flat();
  return [...getAllBasemapLayerIds(), ...runtimeIds];
}

function getOpacityPaintProperties(layerType) {
  if (layerType === 'raster') return ['raster-opacity'];
  if (layerType === 'fill') return ['fill-opacity'];
  if (layerType === 'line') return ['line-opacity'];
  if (layerType === 'symbol') return ['text-opacity', 'icon-opacity'];
  if (layerType === 'background') return ['background-opacity'];
  if (layerType === 'circle') return ['circle-opacity'];
  return [];
}

function setOpacityForLayerType(map, layerId, layerType, opacity) {
  for (const property of getOpacityPaintProperties(layerType)) {
    map.setPaintProperty(layerId, property, opacity);
  }
}

function getNativeOpacityDefaults(map) {
  if (!map.__nativeOpacityDefaults) {
    map.__nativeOpacityDefaults = new Map();
  }
  return map.__nativeOpacityDefaults;
}

function scaleOpacityValue(baseValue, opacity) {
  if (typeof baseValue === 'number') return baseValue * opacity;
  if (opacity === 1) return baseValue;
  return ['*', baseValue, opacity];
}

function setScaledNativeOpacityForLayer(map, layerId, layer, opacity) {
  const defaultsByLayer = getNativeOpacityDefaults(map);
  let layerDefaults = defaultsByLayer.get(layerId);
  if (!layerDefaults) {
    layerDefaults = {};
    defaultsByLayer.set(layerId, layerDefaults);
  }

  for (const property of getOpacityPaintProperties(layer.type)) {
    if (!(property in layerDefaults)) {
      layerDefaults[property] = layer.paint?.[property];
    }
    if (layerDefaults[property] == null) continue;
    map.setPaintProperty(layerId, property, scaleOpacityValue(layerDefaults[property], opacity));
  }
}

// ── Basemap ─────────────────────────────────────────────────────────

/**
 * Show layers for the selected basemap, hide all others.
 * Moves active basemap layers below `dem-loader`.
 * Optionally flies to the basemap's default view if camera is outside its region.
 */
export async function setBasemap(map, state, id, flyIfOutside = false) {
  state.basemap = id;

  const entry = getCatalogEntry(id);
  if (typeof map.__ensureBasemapStyle === 'function') {
    await map.__ensureBasemapStyle(id);
  }

  const activeIds = new Set(getCatalogLayerIdsForMap(map, id));
  for (const layerId of getAllBasemapLayerIdsForMap(map)) {
    setLayerVisibilitySafe(map, layerId, activeIds.has(layerId));
  }

  // Move active basemap layers below dem-loader
  for (const layerId of getCatalogLayerIdsForMap(map, id)) {
    if (map.getLayer(layerId) && map.getLayer('dem-loader')) {
      map.moveLayer(layerId, 'dem-loader');
    }
  }

  // Native-style basemaps scale authored opacity; catalog basemaps use
  // global-state expressions — no per-layer setPaintProperty needed.
  if (isNativeStyleBasemap(map, id)) {
    applyLayerOpacity(map, id, state.basemapOpacity ?? 1);
  }

  // Move overlay layers below dem-loader too (preserve z-order)
  applyLayerOrder(map, state);

  if (flyIfOutside) {
    if (entry?.defaultView && entry.region) {
      const c = map.getCenter();
      const [w, s, e, n] = entry.region;
      if (c.lng < w || c.lng > e || c.lat < s || c.lat > n) {
        map.flyTo({ center: entry.defaultView.center, zoom: entry.defaultView.zoom, duration: 1500 });
      }
    }
  }
}

// ── Overlays ────────────────────────────────────────────────────────

/**
 * Toggle an overlay on/off. Updates state.activeOverlays and layer visibility.
 */
export function setOverlay(map, state, catalogId, visible) {
  const overlays = new Set(state.activeOverlays);
  if (visible) {
    overlays.add(catalogId);
  } else {
    overlays.delete(catalogId);
  }
  state.activeOverlays = [...overlays];

  for (const layerId of getLayerIds(catalogId)) {
    setLayerVisibilitySafe(map, layerId, visible);
  }

  // Ensure layer order reflects current state
  syncLayerOrder(state);
  applyLayerOrder(map, state);
}

/**
 * Apply all overlay visibility from state.activeOverlays.
 * Used at init / when restoring a bookmark.
 */
export function applyAllOverlays(map, state) {
  const active = new Set(state.activeOverlays);
  for (const entry of getOverlays()) {
    const visible = active.has(entry.id);
    for (const layer of entry.layers) {
      setLayerVisibilitySafe(map, layer.id, visible);
    }
  }
  applyLayerOrder(map, state);
}

// ── Layer order ─────────────────────────────────────────────────────

/**
 * Ensure state.layerOrder contains exactly the active overlay IDs.
 * Adds new overlays at the end, removes stale ones.
 */
export function syncLayerOrder(state) {
  const active = new Set(state.activeOverlays);
  const current = (state.layerOrder || []).filter(id => active.has(id));
  // Add any active overlays not yet in order
  for (const id of state.activeOverlays) {
    if (!current.includes(id)) current.push(id);
  }
  state.layerOrder = current;
}

/**
 * Apply the z-order on the map: moves overlay MapLibre layers in the
 * order specified by state.layerOrder, all below `dem-loader`.
 */
export function applyLayerOrder(map, state) {
  if (!map.getLayer('dem-loader')) return;
  const order = state.layerOrder || [];
  // Move overlays in order (first = bottom, last = top, all below dem-loader)
  for (const catalogId of order) {
    for (const layerId of getLayerIds(catalogId)) {
      if (map.getLayer(layerId)) {
        map.moveLayer(layerId, 'dem-loader');
      }
    }
  }
}

/**
 * Move an overlay in the z-order.
 * @param {number} fromIndex - current index in state.layerOrder
 * @param {number} toIndex - target index
 */
export function reorderLayer(map, state, fromIndex, toIndex) {
  const order = [...(state.layerOrder || [])];
  if (fromIndex < 0 || fromIndex >= order.length) return;
  if (toIndex < 0 || toIndex >= order.length) return;
  const [item] = order.splice(fromIndex, 1);
  order.splice(toIndex, 0, item);
  state.layerOrder = order;
  applyLayerOrder(map, state);
}

// ── Per-layer settings (opacity / blend) ────────────────────────────

/**
 * Apply per-layer opacity for a catalog entry's MapLibre layers.
 * For native-style basemaps, scales only authored opacity properties.
 * For catalog layers, directly sets opacity (used by overlay per-layer settings).
 */
export function applyLayerOpacity(map, catalogId, opacity) {
  const entry = getCatalogEntry(catalogId);
  if (!entry) return;
  const runtimeIds = getNativeBasemapLayerIds(map).get(catalogId);
  if (runtimeIds?.length) {
    for (const layerId of runtimeIds) {
      const layer = map.getLayer(layerId);
      if (!layer) continue;
      setScaledNativeOpacityForLayer(map, layerId, layer, opacity);
    }
    return;
  }
  for (const layer of entry.layers) {
    if (!map.getLayer(layer.id)) continue;
    setOpacityForLayerType(map, layer.id, layer.type, opacity);
  }
}

/**
 * Apply all per-layer settings from state.layerSettings onto the map.
 */
export function applyAllLayerSettings(map, state) {
  const settings = state.layerSettings || {};
  for (const [catalogId, s] of Object.entries(settings)) {
    if (s.opacity != null) {
      applyLayerOpacity(map, catalogId, s.opacity);
    }
  }
}

// ── Bookmarks ───────────────────────────────────────────────────────

/**
 * Create a bookmark from current state.
 * @returns {Object} bookmark object
 */
export function createBookmark(state) {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'bm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const name = generateBookmarkName(state.basemap, state.activeOverlays);

  const bookmark = {
    id,
    name,
    basemap: state.basemap,
    overlays: [...state.activeOverlays],
    layerOrder: [...(state.layerOrder || [])],
    layerSettings: JSON.parse(JSON.stringify(state.layerSettings || {})),
  };

  const bookmarks = [...(state.bookmarks || []), bookmark];
  state.bookmarks = bookmarks;
  return bookmark;
}

/**
 * Apply a bookmark to state + map.
 */
export async function applyBookmark(map, state, bookmark) {
  state.basemap = bookmark.basemap;
  state.activeOverlays = [...bookmark.overlays];
  state.layerOrder = [...(bookmark.layerOrder || bookmark.overlays)];
  state.layerSettings = JSON.parse(JSON.stringify(bookmark.layerSettings || {}));

  await setBasemap(map, state, bookmark.basemap);
  applyAllOverlays(map, state);
  applyAllLayerSettings(map, state);
}

/**
 * Delete a bookmark by id.
 */
export function deleteBookmark(state, bookmarkId) {
  state.bookmarks = (state.bookmarks || []).filter(b => b.id !== bookmarkId);
}

/**
 * Rename a bookmark.
 */
export function renameBookmark(state, bookmarkId, newName) {
  const bookmarks = [...(state.bookmarks || [])];
  const bm = bookmarks.find(b => b.id === bookmarkId);
  if (bm) bm.name = newName;
  state.bookmarks = bookmarks;
}

// ── Migration ───────────────────────────────────────────────────────

/** Map old per-overlay boolean state keys to catalog IDs */
const LEGACY_OVERLAY_MAP = {
  showOpenSkiMap: 'openskimap',
  showSwisstopoSki: 'swisstopo-ski',
  showSwisstopoSlope: 'swisstopo-slope',
  showIgnSki: 'ign-ski',
  showIgnSlopes: 'ign-slopes',
};

/**
 * Migrate legacy persisted settings (per-overlay booleans) into the
 * new activeOverlays array format. Returns true if migration occurred.
 */
export function migrateSettings(settings) {
  if (!settings) return false;
  // Already migrated?
  if (settings.activeOverlays) return false;

  const overlays = [];
  for (const [key, catalogId] of Object.entries(LEGACY_OVERLAY_MAP)) {
    if (settings[key]) overlays.push(catalogId);
    delete settings[key];
  }
  // Contours handled separately (not in overlay catalog — it's a special layer)
  settings.activeOverlays = overlays;
  settings.layerOrder = [...overlays];
  settings.layerSettings = {};
  settings.bookmarks = settings.bookmarks || [];
  return true;
}
