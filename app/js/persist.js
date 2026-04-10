// localStorage persistence for tracks and settings.
// No external deps — thin wrapper over localStorage with JSON encoding.

const TRACKS_KEY = 'slope:tracks';
const WAYPOINTS_KEY = 'slope:waypoints';
const SETTINGS_KEY = 'slope:settings';
const PROFILE_SETTINGS_KEY = 'slope:profile-settings';
const WORKSPACE_KEY = 'slope:workspace';
const USER_SOURCES_KEY = 'slope:user-sources';

// ---- Tracks ----

/** Serialize tracks for storage (strips internal fields) */
function serializeTracks(tracks) {
  return tracks.map(t => ({
    id: t.id,
    name: t.name,
    color: t.color,
    coords: t.coords,
    desc: t.desc || undefined,
    cmt: t.cmt || undefined,
    trkType: t.trkType || undefined,
    rteType: t.rteType || undefined,
    sourceKind: t.sourceKind || undefined,
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

// ---- Waypoints ----

function serializeWaypoints(waypoints) {
  return waypoints.map(wp => ({
    id: wp.id,
    name: wp.name,
    coords: wp.coords,
    sym: wp.sym || undefined,
    desc: wp.desc || undefined,
    comment: wp.comment || undefined,
  }));
}

export function saveWaypoints(waypoints) {
  try {
    localStorage.setItem(WAYPOINTS_KEY, JSON.stringify(serializeWaypoints(waypoints)));
  } catch { /* quota exceeded or private mode */ }
}

export function loadWaypoints() {
  try {
    const raw = localStorage.getItem(WAYPOINTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ---- Settings ----

const SETTING_KEYS = [
  'basemapStack', 'basemapOpacities',
  'mode', 'slopeOpacity', 'basemapOpacity', 'hillshadeOpacity',
  'hillshadeMethod', 'terrain3d', 'terrainExaggeration', 'multiplyBlend',
  'showHillshade', 'showContours', 'showTileGrid',
  'activeOverlays', 'layerOrder', 'layerSettings', 'bookmarks',
  'cursorInfoMode', 'pauseThreshold', 'profileSmoothing', 'mapPixelRatio',
  'viewCenter', 'viewZoom', 'viewBearing', 'viewPitch',
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
    localStorage.removeItem(WAYPOINTS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(PROFILE_SETTINGS_KEY);
    localStorage.removeItem(WORKSPACE_KEY);
    localStorage.removeItem(USER_SOURCES_KEY);
  } catch { /* ignore */ }
}

export function clearTracks() {
  try {
    localStorage.removeItem(TRACKS_KEY);
    localStorage.removeItem(WAYPOINTS_KEY);
    localStorage.removeItem(WORKSPACE_KEY);
  } catch { /* ignore */ }
}

export function clearSettings() {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(PROFILE_SETTINGS_KEY);
  } catch { /* ignore */ }
}

// ---- Storage stats ----

/** Byte length of a localStorage value (UTF-16 → bytes). Returns 0 if missing. */
function keyBytes(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? v.length * 2 : 0;
  } catch { return 0; }
}

/** Number of top-level items in a JSON-array localStorage value. */
function keyCount(key) {
  try {
    const v = localStorage.getItem(key);
    if (!v) return 0;
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.length : 0;
  } catch { return 0; }
}

export function getTrackStats() {
  const bytes = keyBytes(TRACKS_KEY) + keyBytes(WAYPOINTS_KEY) + keyBytes(WORKSPACE_KEY);
  const trackCount = keyCount(TRACKS_KEY);
  const waypointCount = keyCount(WAYPOINTS_KEY);
  return { bytes, trackCount, waypointCount };
}

export function getSettingsStats() {
  return { bytes: keyBytes(SETTINGS_KEY) + keyBytes(PROFILE_SETTINGS_KEY) };
}

export function getAllStats() {
  let bytes = 0;
  let keyCount = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('slope:')) {
        bytes += keyBytes(k);
        keyCount++;
      }
    }
  } catch { /* ignore */ }
  return { bytes, keyCount };
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
  if (node._waypointId) base._waypointId = node._waypointId;
  if (node._trackId) base._trackId = node._trackId;
  if (node._trackIds?.length) base._trackIds = node._trackIds;
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
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Migrate legacy field names
    if (data?.children) migrateNodes(data.children);
    return data;
  } catch { return null; }
}

function migrateNodes(nodes) {
  for (const node of nodes) {
    if (node._legacyTrackId) { node._trackId = node._legacyTrackId; delete node._legacyTrackId; }
    if (node._legacyTrackIds) { node._trackIds = node._legacyTrackIds; delete node._legacyTrackIds; }
    if (node.children) migrateNodes(node.children);
  }
}

// ---- User sources ----

export function saveUserSources(sources) {
  try {
    localStorage.setItem(USER_SOURCES_KEY, JSON.stringify(sources));
  } catch { /* quota exceeded or private mode */ }
}

export function loadUserSources() {
  try {
    const raw = localStorage.getItem(USER_SOURCES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
