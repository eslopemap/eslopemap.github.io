// localStorage persistence for tracks and settings.
// No external deps — thin wrapper over localStorage with JSON encoding.

const TRACKS_KEY = 'slope:tracks';
const SETTINGS_KEY = 'slope:settings';
const PROFILE_SETTINGS_KEY = 'slope:profile-settings';
const WORKSPACE_KEY = 'slope:workspace';

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
  'showContours', 'showOpenSkiMap', 'cursorInfoMode', 'pauseThreshold',
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

// ---- Profile display settings ----

export function saveProfileSettings(settings) {
  try {
    localStorage.setItem(PROFILE_SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* quota exceeded or private mode */ }
}

export function loadProfileSettings() {
  try {
    const raw = localStorage.getItem(PROFILE_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ---- Clear ----

export function clearAll() {
  try {
    localStorage.removeItem(TRACKS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(PROFILE_SETTINGS_KEY);
    localStorage.removeItem(WORKSPACE_KEY);
  } catch { /* ignore */ }
}

// ---- Workspace tree ----

function serializeNode(node) {
  const base = { id: node.id, type: node.type };
  if (node.name != null) base.name = node.name;
  if (node.desc) base.desc = node.desc;
  if (node.cmt) base.cmt = node.cmt;
  if (node.sym) base.sym = node.sym;
  if (node.trkType) base.trkType = node.trkType;
  if (node.rteType) base.rteType = node.rteType;
  if (node.wptType) base.wptType = node.wptType;
  if (node._legacyTrackId) base._legacyTrackId = node._legacyTrackId;
  if (node._legacyTrackIds?.length) base._legacyTrackIds = node._legacyTrackIds;
  if (node.children?.length) base.children = node.children.map(serializeNode);
  return base;
}

export function saveWorkspace(workspace) {
  try {
    const data = { children: workspace.children.map(serializeNode) };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded or private mode */ }
}

export function loadWorkspace() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
