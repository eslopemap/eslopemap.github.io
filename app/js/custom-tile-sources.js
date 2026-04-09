import { getUserSources, registerUserSource, unregisterUserSource } from './layer-registry.js';
import { buildCatalogEntryFromTileJson, getConfigValue, isTauri, setConfigValue } from './tauri-bridge.js';

function normalizeTileJson(tileJson) {
  if (!tileJson || typeof tileJson !== 'object') {
    throw new Error('TileJSON object is required');
  }
  const normalized = { ...tileJson };
  if (!normalized.id) {
    normalized.id = normalized.name || `custom-${Date.now()}`;
  }
  if (!normalized.name) {
    normalized.name = normalized.id;
  }
  const hasTiles = Array.isArray(normalized.tiles) && normalized.tiles.length > 0;
  const hasPmtilesUrl = normalized.protocol === 'pmtiles' && typeof normalized.url === 'string' && normalized.url;
  if (!hasTiles && !hasPmtilesUrl) {
    throw new Error('TileJSON must define tiles[] or a pmtiles url');
  }
  return normalized;
}

function withMetadata(entry, persistence) {
  return { ...entry, persistence };
}

export function isTileJsonLike(value) {
  return !!(
    value
    && typeof value === 'object'
    && (
      value.tilejson
      || (Array.isArray(value.tiles) && value.tiles.length > 0)
      || (value.protocol === 'pmtiles' && typeof value.url === 'string')
    )
  );
}

export async function loadPersistedCustomTileSources() {
  if (!isTauri()) return [];
  const tileJsonSources = await getConfigValue('sources.custom_tilejsons');
  for (const tileJson of tileJsonSources ?? []) {
    const normalized = normalizeTileJson(tileJson);
    registerUserSource(withMetadata(buildCatalogEntryFromTileJson(normalized), 'desktop-config'));
  }
  return tileJsonSources ?? [];
}

export async function addCustomTileSource(tileJson, options = {}) {
  const { refreshUi = null } = options;
  const normalized = normalizeTileJson(tileJson);
  const persistence = isTauri() ? 'desktop-config' : 'browser';
  const entry = withMetadata(buildCatalogEntryFromTileJson(normalized), persistence);
  registerUserSource(entry);
  if (isTauri()) {
    const existing = await getConfigValue('sources.custom_tilejsons');
    const next = [...(existing ?? []).filter(source => (source?.id || source?.name) !== (normalized.id || normalized.name)), normalized];
    await setConfigValue('sources.custom_tilejsons', next);
  }
  refreshUi?.();
  return entry;
}

export async function removeCustomTileSource(id, options = {}) {
  const { refreshUi = null } = options;
  const existing = getUserSources().find(source => source.id === id) || null;
  const removed = unregisterUserSource(id);
  if (removed && isTauri() && existing?.persistence === 'desktop-config') {
    const current = await getConfigValue('sources.custom_tilejsons');
    const next = (current ?? []).filter(source => `tilejson-${source?.id || source?.name || ''}` !== id);
    await setConfigValue('sources.custom_tilejsons', next);
  }
  refreshUi?.();
  return removed;
}
