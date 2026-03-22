// localStorage persistence for tracks and settings.
// No external deps — thin wrapper over localStorage with JSON encoding.

const TRACKS_KEY = 'slope:tracks';
const SETTINGS_KEY = 'slope:settings';

// ---- Tracks ----

/** Serialize tracks for storage (strips internal fields) */
function serializeTracks(tracks) {
  return tracks.map(t => ({
    name: t.name,
    color: t.color,
    coords: t.coords,
    groupId: t.groupId || undefined,
    groupName: t.groupName || undefined,
    segmentLabel: t.segmentLabel || undefined,
  }));
}

export function saveTracks(tracks) {
  try {
    localStorage.setItem(TRACKS_KEY, JSON.stringify(serializeTracks(tracks)));
  } catch { /* quota exceeded or private mode */ }
}

export function loadTracks() {
  try {
    const raw = localStorage.getItem(TRACKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ---- Settings ----

const SETTING_KEYS = [
  'basemap', 'mode', 'slopeOpacity', 'basemapOpacity', 'hillshadeOpacity',
  'hillshadeMethod', 'terrain3d', 'terrainExaggeration', 'multiplyBlend',
  'showContours', 'showOpenSkiMap', 'cursorInfoMode',
];

export function saveSettings(state) {
  try {
    const obj = {};
    for (const k of SETTING_KEYS) {
      if (state[k] !== undefined) obj[k] = state[k];
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj));
  } catch { /* quota exceeded or private mode */ }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ---- Clear ----

export function clearAll() {
  try {
    localStorage.removeItem(TRACKS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
  } catch { /* ignore */ }
}
