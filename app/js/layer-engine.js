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

/**
 * On-demand: ensure a single catalog entry's sources and layers exist on the map.
 * Layers are added hidden (visibility: 'none') before 'dem-loader'.
 */
export function ensureCatalogEntry(map, catalogId) {
  const entry = getCatalogEntry(catalogId);
  if (!entry) return;
  for (const [sourceId, sourceDef] of Object.entries(entry.sources)) {
    if (!map.getSource(sourceId)) map.addSource(sourceId, sourceDef);
  }
  for (const layer of entry.layers) {
    if (!map.getLayer(layer.id)) {
      map.addLayer(
        { ...layer, layout: { ...(layer.layout || {}), visibility: 'none' } },
        map.getLayer('dem-loader') ? 'dem-loader' : undefined,
      );
    }
  }
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

function getAuthoredLayerOpacity(layer) {
  for (const property of getOpacityPaintProperties(layer?.type)) {
    const value = layer?.paint?.[property];
    if (typeof value === 'number') return value;
    if (
      Array.isArray(value)
      && value[0] === '*'
      && typeof value[1] === 'number'
    ) {
      return value[1];
    }
    if (
      Array.isArray(value)
      && value[0] === '*'
      && typeof value[2] === 'number'
    ) {
      return value[2];
    }
  }
  return 1;
}

function getCatalogDefaultOpacity(catalogId) {
  const entry = getCatalogEntry(catalogId);
  if (!entry?.layers?.length) return 1;
  for (const layer of entry.layers) {
    const opacity = getAuthoredLayerOpacity(layer);
    if (opacity != null) return opacity;
  }
  return 1;
}

function ensureLayerStateDefaults(state, catalogId) {
  const entry = getCatalogEntry(catalogId);
  if (!entry) return;

  if (entry.category === 'basemap') {
    const defaultOpacity = getCatalogDefaultOpacity(catalogId);
    if (defaultOpacity !== 1 && state.basemapOpacities?.[catalogId] == null) {
      state.basemapOpacities = {
        ...(state.basemapOpacities || {}),
        [catalogId]: defaultOpacity,
      };
    }
    if (state.layerSettings?.[catalogId]?.hidden) {
      state.layerSettings = {
        ...(state.layerSettings || {}),
        [catalogId]: { ...(state.layerSettings?.[catalogId] || {}), hidden: false },
      };
    }
    return;
  }

  const nextSettings = { ...(state.layerSettings || {}) };
  const current = nextSettings[catalogId] || {};
  const next = { ...current, hidden: false };
  if (current.opacity == null) {
    next.opacity = getCatalogDefaultOpacity(catalogId);
  }
  nextSettings[catalogId] = next;
  state.layerSettings = nextSettings;
}

// ── Basemap ─────────────────────────────────────────────────────────

/**
 * Get the opacity for a basemap in the stack. Falls back to global basemapOpacity.
 */
function getBasemapOpacity(state, id) {
  return state.basemapOpacities?.[id] ?? state.basemapOpacity ?? 1;
}

/**
 * Show layers for all basemaps in the stack, hide all others.
 * Stack order: first = bottom, last = top. All below `dem-loader`.
 */
export async function setBasemapStack(map, state, ids, flyIfOutside = false) {
  const requestedIds = [...ids].filter(id => id !== 'none') ;
  const effectiveIds = requestedIds.length >= 1 ? requestedIds : ['none'];
  state.basemapStack = requestedIds;

  for (const id of effectiveIds) {
    ensureLayerStateDefaults(state, id);
  }

  for (const id of effectiveIds) {
    if (typeof map.__ensureBasemapStyle === 'function') {
      await map.__ensureBasemapStyle(id);
    }
    // On-demand: create sources/layers if not yet on the map
    ensureCatalogEntry(map, id);
  }

  // Collect all layer IDs that should be visible (respecting manual hidden state)
  const hiddenEntries = new Set(
    Object.entries(state.layerSettings || {}).filter(([, s]) => s.hidden).map(([id]) => id)
  );
  const activeIds = new Set();
  for (const id of effectiveIds) {
    if (hiddenEntries.has(id)) continue; // respect manually-hidden basemaps
    for (const layerId of getCatalogLayerIdsForMap(map, id)) {
      activeIds.add(layerId);
    }
  }

  // Toggle visibility for all basemap layers
  for (const layerId of getAllBasemapLayerIdsForMap(map)) {
    setLayerVisibilitySafe(map, layerId, activeIds.has(layerId));
  }

  // Move stack layers below dem-loader in stack order (bottom first)
  for (const id of effectiveIds) {
    for (const layerId of getCatalogLayerIdsForMap(map, id)) {
      if (map.getLayer(layerId) && map.getLayer('dem-loader')) {
        map.moveLayer(layerId, 'dem-loader');
      }
    }
    // Apply per-basemap opacity
    if (isNativeStyleBasemap(map, id)) {
      applyLayerOpacity(map, id, getBasemapOpacity(state, id));
    }
  }

  applyLayerOrder(map, state);

  // Fly to region of the primary (bottom) basemap if camera is outside
  if (flyIfOutside && requestedIds.length) {
    const entry = getCatalogEntry(requestedIds[0]);
    if (entry?.defaultView && entry.region) {
      const c = map.getCenter();
      const [w, s, e, n] = entry.region;
      if (c.lng < w || c.lng > e || c.lat < s || c.lat > n) {
        map.flyTo({ center: entry.defaultView.center, zoom: entry.defaultView.zoom, duration: 1500 });
      }
    }
  }
}

/**
 * Show layers for the selected basemap, hide all others.
 * Backward-compat wrapper around setBasemapStack for single-basemap use.
 */
export async function setBasemap(map, state, id, flyIfOutside = false) {
  await setBasemapStack(map, state, id === 'none' ? [] : [id], flyIfOutside);
}

// ── Overlays ────────────────────────────────────────────────────────

/**
 * Toggle an overlay on/off. Updates state.activeOverlays and layer visibility.
 */
export function setOverlay(map, state, catalogId, visible) {
  const overlays = new Set(state.activeOverlays);
  if (visible) {
    overlays.add(catalogId);
    ensureLayerStateDefaults(state, catalogId);
    // On-demand: create sources/layers if not yet on the map
    ensureCatalogEntry(map, catalogId);
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
  const hiddenEntries = new Set(
    Object.entries(state.layerSettings || {}).filter(([, s]) => s.hidden).map(([id]) => id)
  );
  for (const entry of getOverlays()) {
    const visible = active.has(entry.id) && !hiddenEntries.has(entry.id);
    if (active.has(entry.id)) ensureCatalogEntry(map, entry.id);
    for (const layer of entry.layers) {
      setLayerVisibilitySafe(map, layer.id, visible);
    }
  }
  applyLayerOrder(map, state);
}

// ── Layer order ─────────────────────────────────────────────────────

/**
 * Ensure state.layerOrder contains exactly the active layer IDs:
 * basemapStack entries (bottom) + activeOverlays + virtual system layers (top).
 * Adds new layers at the end of their section, removes stale ones.
 */
export function syncLayerOrder(state) {
  const basemaps = new Set(state.basemapStack || []);
  const overlays = new Set(state.activeOverlays);
  
  // Virtual system layers: always present in layerOrder (visibility toggled separately)
  const systemLayers = ['_hillshade', '_analysis', '_contours'];
  
  const allActive = new Set([...basemaps, ...overlays, ...systemLayers]);

  const current = (state.layerOrder || []).filter(id => allActive.has(id));
  // Add any active layers not yet in order
  for (const id of state.basemapStack || []) {
    if (!current.includes(id)) current.push(id);
  }
  for (const id of state.activeOverlays) {
    if (!current.includes(id)) current.push(id);
  }
  for (const id of systemLayers) {
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

/**
 * Toggle visibility of a layer in the Layers panel.
 * Works for both basemaps and overlays.
 */
export function setLayerVisible(map, state, catalogId, visible) {
  const entry = getCatalogEntry(catalogId);
  if (!entry) return;

  if (entry.category === 'basemap') {
    // Toggle basemap visibility via its MapLibre layers
    for (const layerId of getCatalogLayerIdsForMap(map, catalogId)) {
      setLayerVisibilitySafe(map, layerId, visible);
    }
    if (isNativeStyleBasemap(map, catalogId)) {
      for (const layerId of (getNativeBasemapLayerIds(map).get(catalogId) || [])) {
        setLayerVisibilitySafe(map, layerId, visible);
      }
    }
  } else {
    for (const layerId of getLayerIds(catalogId)) {
      setLayerVisibilitySafe(map, layerId, visible);
    }
  }

  // Track hidden state in layerSettings
  const settings = { ...(state.layerSettings || {}) };
  settings[catalogId] = { ...(settings[catalogId] || {}), hidden: !visible };
  state.layerSettings = settings;
}

/**
 * Remove a layer from the active state.
 * For basemaps, removes from basemapStack. For overlays, removes from activeOverlays.
 */
export function removeLayer(map, state, catalogId) {
  const entry = getCatalogEntry(catalogId);
  if (!entry) return;

  if (entry.category === 'basemap') {
    const newStack = (state.basemapStack || []).filter(id => id !== catalogId);
    // Don't await — caller can handle async if needed
    setBasemapStack(map, state, newStack);
  } else {
    setOverlay(map, state, catalogId, false);
  }
  syncLayerOrder(state);
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
 * Restores hidden state (visibility) and per-layer opacity.
 */
export function applyAllLayerSettings(map, state) {
  const settings = state.layerSettings || {};
  for (const [catalogId, s] of Object.entries(settings)) {
    if (s.opacity != null) {
      applyLayerOpacity(map, catalogId, s.opacity);
    }
    if (s.hidden) {
      setLayerVisible(map, state, catalogId, false);
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

  const basemapStack = [...(state.basemapStack || ['none'])];
  const name = generateBookmarkName(basemapStack, state.activeOverlays);

  // Capture system layer state in layerSettings
  const layerSettings = JSON.parse(JSON.stringify(state.layerSettings || {}));
  
  // Store analysis layer state
  if (state.mode && state.mode !== 'none' && state.mode !== '') {
    layerSettings._analysis = {
      mode: state.mode,
      opacity: state.slopeOpacity,
    };
  }
  
  // Store hillshade layer state
  if (state.showHillshade) {
    layerSettings._hillshade = {
      opacity: state.hillshadeOpacity,
      method: state.hillshadeMethod,
    };
  }
  
  // Store contours layer state
  if (state.showContours) {
    layerSettings._contours = { visible: true };
  }

  const bookmark = {
    id,
    name,
    basemapStack,
    basemapOpacities: { ...(state.basemapOpacities || {}) },
    overlays: [...state.activeOverlays],
    layerOrder: [...(state.layerOrder || [])],
    layerSettings,
  };

  const bookmarks = [...(state.bookmarks || []), bookmark];
  state.bookmarks = bookmarks;
  return bookmark;
}

/**
 * Apply a bookmark to state + map.
 */
export async function applyBookmark(map, state, bookmark) {
  state.activeOverlays = [...bookmark.overlays];
  state.layerOrder = [...(bookmark.layerOrder || bookmark.overlays)];
  state.layerSettings = JSON.parse(JSON.stringify(bookmark.layerSettings || {}));
  state.basemapOpacities = { ...(bookmark.basemapOpacities || {}) };

  // Restore system layer state from layerSettings
  const settings = state.layerSettings;
  
  if (settings._analysis) {
    state.mode = settings._analysis.mode || 'slope+relief';
    state.slopeOpacity = settings._analysis.opacity ?? 0.45;
  } else {
    state.mode = '';
  }
  
  if (settings._hillshade) {
    state.showHillshade = true;
    state.hillshadeOpacity = settings._hillshade.opacity ?? 0.10;
    state.hillshadeMethod = settings._hillshade.method || 'igor';
  } else {
    state.showHillshade = false;
  }
  
  if (settings._contours) {
    state.showContours = true;
  } else {
    state.showContours = false;
  }

  const stack = bookmark.basemapStack || (bookmark.basemap ? [bookmark.basemap] : []);
  await setBasemapStack(map, state, stack);
  applyAllOverlays(map, state);
  applyAllLayerSettings(map, state);
  // Re-apply basemap opacities from bookmark
  for (const id of (bookmark.basemapStack || [])) {
    const opacity = state.basemapOpacities?.[id];
    if (opacity != null) applyLayerOpacity(map, id, opacity);
  }
  
  // Sync layerOrder to include virtual system layers
  syncLayerOrder(state);
  // NOTE: caller must apply system layer UI state (applyModeState, applyHillshadeVisibility, etc.)
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
