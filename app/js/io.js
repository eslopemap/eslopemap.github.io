// Import/export, drag-drop, file handling.
// Uses @we-gold/gpxjs for GPX parsing.

import { parseGPX as gpxjsParse, stringifyGPX } from '@we-gold/gpxjs';
import { downloadFile } from './utils.js';
import { isTauri, pickAndWatchFolder, loadGpx, saveGpxFile, onGpxSyncEvents } from './tauri-bridge.js';

let tracksFns = {};  // wired at init

// ---- GPX Parsing (via gpxjs) ----

/**
 * Parse a GPX string into tracks, routes, and waypoints.
 * Multi-segment tracks are split into separate entries (matching split behavior).
 * Each result track carries _gpxParsed + _gpxTrackIdx for future round-trip export.
 */
export function parseGPXTracks(text, baseName) {
  const [parsed, err] = gpxjsParse(text, { removeEmptyFields: false });
  if (err || !parsed) {
    console.warn('GPX parse error:', err);
    return { tracks: [], waypoints: [] };
  }

  const result = { tracks: [], waypoints: [], _gpxParsed: parsed };
  const xml = parsed.xml;
  const trkEls = Array.from(xml.querySelectorAll('trk'));

  for (let ti = 0; ti < trkEls.length && ti < parsed.tracks.length; ti++) {
    const trkEl = trkEls[ti];
    const nameEl = trkEl.querySelector(':scope > name');
    const descEl = trkEl.querySelector(':scope > desc');
    const cmtEl = trkEl.querySelector(':scope > cmt');
    const typeEl = trkEl.querySelector(':scope > type');
    const trkName = nameEl ? nameEl.textContent.trim() : baseName;
    const trkDesc = descEl ? descEl.textContent.trim() : '';
    const trkCmt = cmtEl ? cmtEl.textContent.trim() : '';
    const trkType = typeEl ? typeEl.textContent.trim() : '';
    const segs = trkEl.querySelectorAll('trkseg');
    const gpxTrack = parsed.tracks[ti];

    if (segs.length <= 1) {
      const coords = gpxTrack.points.map(p => {
        const c = [p.longitude, p.latitude, p.elevation];
        if (p.time) c.push(p.time.getTime());
        return c;
      });
      if (coords.length) {
        result.tracks.push({
          name: trkName,
          coords,
          desc: trkDesc,
          cmt: trkCmt,
          trkType,
          sourceKind: 'track',
          _gpxParsed: parsed,
          _gpxTrackIdx: ti,
        });
      }
    } else {
      // gpxjs concatenates all segments; split back using per-segment point counts
      const groupId = 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      let offset = 0;
      for (let si = 0; si < segs.length; si++) {
        const segPtCount = segs[si].querySelectorAll('trkpt').length;
        const segPoints = gpxTrack.points.slice(offset, offset + segPtCount);
        const coords = segPoints.map(p => {
          const c = [p.longitude, p.latitude, p.elevation];
          if (p.time) c.push(p.time.getTime());
          return c;
        });
        if (coords.length) {
          result.tracks.push({
            name: `${trkName} seg${si + 1}`,
            coords,
            desc: trkDesc,
            cmt: trkCmt,
            trkType,
            sourceKind: 'track',
            _gpxParsed: parsed,
            _gpxTrackIdx: ti,
            _segmentIndex: si,
            groupId,
            groupName: trkName,
            segmentLabel: `seg ${si + 1}`,
          });
        }
        offset += segPtCount;
      }
    }
  }

  // Routes
  for (let i = 0; i < parsed.routes.length; i++) {
    const gr = parsed.routes[i];
    const rteEl = xml.querySelectorAll('rte')[i];
    const descEl = rteEl?.querySelector(':scope > desc');
    const cmtEl = rteEl?.querySelector(':scope > cmt');
    const typeEl = rteEl?.querySelector(':scope > type');
    const name = gr.name || baseName;
    const coords = gr.points.map(p => [p.longitude, p.latitude, p.elevation]);
    if (coords.length) {
      result.tracks.push({
        name,
        coords,
        desc: descEl ? descEl.textContent.trim() : '',
        cmt: cmtEl ? cmtEl.textContent.trim() : '',
        rteType: typeEl ? typeEl.textContent.trim() : '',
        sourceKind: 'route',
        _gpxParsed: parsed,
        _gpxRouteIdx: i,
      });
    }
  }

  // Waypoints
  for (const wp of parsed.waypoints) {
    result.waypoints.push({
      name: wp.name,
      coords: [wp.longitude, wp.latitude, wp.elevation],
      sym: wp.symbol,
      desc: wp.description,
      comment: wp.comment,
    });
  }

  return result;
}

// ---- GeoJSON Parsing ----

export function parseGeoJSON(text) {
  const gj = JSON.parse(text);
  const results = [];

  function extractCoords(geom) {
    if (geom.type === 'LineString') {
      results.push(geom.coordinates.map(c => [c[0], c[1], c[2] != null ? c[2] : null]));
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates) {
        results.push(line.map(c => [c[0], c[1], c[2] != null ? c[2] : null]));
      }
    }
  }

  if (gj.type === 'FeatureCollection') {
    for (const f of gj.features) extractCoords(f.geometry);
  } else if (gj.type === 'Feature') {
    extractCoords(gj.geometry);
  } else {
    extractCoords(gj);
  }
  return results;
}

// ---- Import dispatch ----

export function importFileContent(filename, text) {
  const baseName = filename.replace(/\.[^.]+$/, '');

  if (filename.endsWith('.gpx')) {
    const result = parseGPXTracks(text, baseName);
    if (!result.tracks.length && !result.waypoints.length) {
      console.warn('No tracks or waypoints found in', filename);
      return;
    }
    const createdTracks = [];
    for (const trk of result.tracks) {
      const t = tracksFns.createTrack(trk.name, trk.coords, {
        desc: trk.desc,
        cmt: trk.cmt,
        trkType: trk.trkType,
        rteType: trk.rteType,
        sourceKind: trk.sourceKind,
        groupId: trk.groupId,
        groupName: trk.groupName,
        segmentLabel: trk.segmentLabel,
        skipTreeHook: true,
      });
      createdTracks.push(t);
      tracksFns.fitToTrack(t);
    }
    if (result.waypoints.length && tracksFns.addWaypoints) {
      tracksFns.addWaypoints(result.waypoints);
    }
    if (tracksFns.onFileBatchImported) {
      tracksFns.onFileBatchImported(baseName, createdTracks, result.waypoints);
    }
  } else {
    const coordsList = parseGeoJSON(text);
    if (!coordsList.length) { console.warn('No tracks found in', filename); return; }
    const createdTracks = [];
    for (let i = 0; i < coordsList.length; i++) {
      const name = coordsList.length > 1 ? `${baseName} (${i + 1})` : baseName;
      const t = tracksFns.createTrack(name, coordsList[i], { skipTreeHook: true });
      createdTracks.push(t);
      tracksFns.fitToTrack(t);
    }
    if (tracksFns.onFileBatchImported) {
      tracksFns.onFileBatchImported(baseName, createdTracks, []);
    }
  }
}

// ---- Export ----

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sanitizeFileStem(name, fallback = 'export') {
  const normalized = String(name || fallback).trim().replace(/[\\/:*?"<>|]+/g, '_');
  return normalized || fallback;
}

function findTrackById(id) {
  if (!id) return null;
  if (typeof tracksFns.findTrackById === 'function') return tracksFns.findTrackById(id);
  return tracksFns.getTracks?.().find(track => track.id === id) || null;
}

function findWaypointById(id) {
  if (!id) return null;
  if (typeof tracksFns.findWaypointById === 'function') return tracksFns.findWaypointById(id);
  return tracksFns.getWaypoints?.().find(waypoint => waypoint.id === id) || null;
}

function buildTrackEntryFromTrack(track, override = {}) {
  return {
    name: override.name ?? track.name ?? 'Track',
    desc: override.desc ?? track.desc ?? '',
    cmt: override.cmt ?? track.cmt ?? '',
    type: override.type ?? track.trkType ?? '',
    segments: override.segments ?? [track.coords || []],
  };
}

function buildRouteEntryFromTrack(track, override = {}) {
  return {
    name: override.name ?? track.name ?? 'Route',
    desc: override.desc ?? track.desc ?? '',
    cmt: override.cmt ?? track.cmt ?? '',
    type: override.type ?? track.rteType ?? '',
    coords: override.coords ?? track.coords ?? [],
  };
}

function buildWaypointEntryFromWaypoint(waypoint, override = {}) {
  return {
    name: override.name ?? waypoint.name ?? '',
    desc: override.desc ?? waypoint.desc ?? '',
    cmt: override.cmt ?? waypoint.comment ?? waypoint.cmt ?? '',
    sym: override.sym ?? waypoint.sym ?? '',
    type: override.type ?? waypoint.wptType ?? '',
    coords: override.coords ?? waypoint.coords ?? null,
  };
}

function extendBounds(bounds, coord) {
  if (!coord || coord.length < 2 || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return bounds;
  if (!bounds) {
    return {
      minLon: coord[0],
      minLat: coord[1],
      maxLon: coord[0],
      maxLat: coord[1],
    };
  }
  bounds.minLon = Math.min(bounds.minLon, coord[0]);
  bounds.minLat = Math.min(bounds.minLat, coord[1]);
  bounds.maxLon = Math.max(bounds.maxLon, coord[0]);
  bounds.maxLat = Math.max(bounds.maxLat, coord[1]);
  return bounds;
}

function collectBoundsAndTime(payload) {
  let bounds = null;
  let earliestTime = null;
  const visitCoord = (coord) => {
    bounds = extendBounds(bounds, coord);
    if (coord?.[3] != null) {
      earliestTime = earliestTime == null ? coord[3] : Math.min(earliestTime, coord[3]);
    }
  };

  for (const track of payload.tracks) {
    for (const segment of track.segments || []) {
      for (const coord of segment || []) visitCoord(coord);
    }
  }
  for (const route of payload.routes) {
    for (const coord of route.coords || []) visitCoord(coord);
  }
  for (const waypoint of payload.waypoints) {
    if (waypoint.coords) visitCoord(waypoint.coords);
  }

  return { bounds, earliestTime };
}

function buildMetadataFragment(payload) {
  const { bounds, earliestTime } = collectBoundsAndTime(payload);
  const lines = [
    '  <metadata>',
    `    <name>${escapeXml(payload.name || 'Export')}</name>`,
    `    <desc>${escapeXml(payload.desc || '')}</desc>`,
    `    <time>${new Date(earliestTime ?? Date.now()).toISOString()}</time>`,
  ];
  if (bounds) {
    lines.push(`    <bounds minlat="${bounds.minLat}" minlon="${bounds.minLon}" maxlat="${bounds.maxLat}" maxlon="${bounds.maxLon}" />`);
  }
  lines.push('  </metadata>');
  return lines.join('\n');
}

function buildTrackPointFragment(coord, tagName) {
  const ele = coord[2] != null ? `<ele>${coord[2]}</ele>` : '';
  const time = coord[3] != null ? `<time>${new Date(coord[3]).toISOString()}</time>` : '';
  return `      <${tagName} lat="${coord[1]}" lon="${coord[0]}">${ele}${time}</${tagName}>`;
}

function buildTrackFragment(entry) {
  const segments = (entry.segments || []).map((segment) => {
    const pts = segment.map(coord => buildTrackPointFragment(coord, 'trkpt')).join('\n');
    return `    <trkseg>\n${pts}\n    </trkseg>`;
  }).join('\n');
  return [
    '  <trk>',
    `    <name>${escapeXml(entry.name || 'Track')}</name>`,
    `    <cmt>${escapeXml(entry.cmt || '')}</cmt>`,
    `    <desc>${escapeXml(entry.desc || '')}</desc>`,
    `    <type>${escapeXml(entry.type || '')}</type>`,
    segments,
    '  </trk>',
  ].join('\n');
}

function buildRouteFragment(entry) {
  const pts = (entry.coords || []).map(coord => buildTrackPointFragment(coord, 'rtept')).join('\n');
  return [
    '  <rte>',
    `    <name>${escapeXml(entry.name || 'Route')}</name>`,
    `    <cmt>${escapeXml(entry.cmt || '')}</cmt>`,
    `    <desc>${escapeXml(entry.desc || '')}</desc>`,
    `    <type>${escapeXml(entry.type || '')}</type>`,
    pts,
    '  </rte>',
  ].join('\n');
}

function buildWaypointFragment(entry) {
  if (!entry.coords) return '';
  const ele = entry.coords[2] != null ? `\n    <ele>${entry.coords[2]}</ele>` : '';
  return [
    `  <wpt lat="${entry.coords[1]}" lon="${entry.coords[0]}">${ele}`,
    `    <name>${escapeXml(entry.name || '')}</name>`,
    `    <cmt>${escapeXml(entry.cmt || '')}</cmt>`,
    `    <desc>${escapeXml(entry.desc || '')}</desc>`,
    `    <sym>${escapeXml(entry.sym || '')}</sym>`,
    `    <type>${escapeXml(entry.type || '')}</type>`,
    '  </wpt>',
  ].join('\n');
}

function buildGpxDocument(payload) {
  const fragments = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="slope-editor">',
    buildMetadataFragment(payload),
  ];

  for (const waypoint of payload.waypoints) {
    const fragment = buildWaypointFragment(waypoint);
    if (fragment) fragments.push(fragment);
  }
  for (const route of payload.routes) fragments.push(buildRouteFragment(route));
  for (const track of payload.tracks) fragments.push(buildTrackFragment(track));

  fragments.push('</gpx>');
  return fragments.join('\n');
}

function buildPayloadFromNode(node) {
  const payload = {
    name: node?.name || 'Export',
    desc: node?.desc || '',
    tracks: [],
    routes: [],
    waypoints: [],
  };

  function visit(current) {
    if (!current) return;
    if (current.type === 'file' || current.type === 'folder') {
      for (const child of current.children || []) visit(child);
      return;
    }
    if (current.type === 'track') {
      const segments = (current._trackIds || [])
        .map(id => findTrackById(id))
        .filter(Boolean)
        .map(track => track.coords || []);
      const firstTrack = findTrackById(current._trackIds?.[0]);
      if (segments.length && firstTrack) {
        payload.tracks.push(buildTrackEntryFromTrack(firstTrack, {
          name: current.name,
          desc: current.desc,
          cmt: current.cmt,
          type: current.trkType,
          segments,
        }));
      }
      return;
    }
    if (current.type === 'route') {
      const routeTrack = findTrackById(current._trackId);
      if (routeTrack) {
        payload.routes.push(buildRouteEntryFromTrack(routeTrack, {
          name: current.name,
          desc: current.desc,
          cmt: current.cmt,
          type: current.rteType,
        }));
      }
      return;
    }
    if (current.type === 'waypoint') {
      const waypoint = findWaypointById(current._waypointId) || current;
      payload.waypoints.push(buildWaypointEntryFromWaypoint(waypoint, {
        name: current.name,
        desc: current.desc,
        cmt: current.cmt,
        sym: current.sym,
        type: current.wptType,
        coords: current.coords || waypoint.coords,
      }));
    }
  }

  visit(node);
  return payload;
}

export function exportNodeGPX(node) {
  const payload = buildPayloadFromNode(node);
  if (!payload.tracks.length && !payload.routes.length && !payload.waypoints.length) return false;
  downloadFile(`${sanitizeFileStem(payload.name)}.gpx`, buildGpxDocument(payload), 'application/gpx+xml');
  return true;
}

// Exposed for unit tests
export { buildGpxDocument, buildPayloadFromNode };

function buildTrackGPXString(name, coords) {
  const pts = coords.map(c => {
    const ele = c[2] != null ? `<ele>${c[2]}</ele>` : '';
    const time = c[3] != null ? `<time>${new Date(c[3]).toISOString()}</time>` : '';
    return `      <trkpt lat="${c[1]}" lon="${c[0]}">${ele}${time}</trkpt>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="slope-editor">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

function exportActiveGPX() {
  const t = tracksFns.getActiveTrack();
  if (!t || !t.coords.length) return;
  const payload = {
    name: t.name || 'Track',
    desc: t.desc || '',
    tracks: [],
    routes: [],
    waypoints: [],
  };
  if ((t.sourceKind || 'track') === 'route') payload.routes.push(buildRouteEntryFromTrack(t));
  else payload.tracks.push(buildTrackEntryFromTrack(t));
  downloadFile(`${sanitizeFileStem(payload.name)}.gpx`, buildGpxDocument(payload), 'application/gpx+xml');
}

function exportActiveGeoJSON() {
  const t = tracksFns.getActiveTrack();
  if (!t || !t.coords.length) return;
  const gj = {
    type: 'Feature',
    properties: { name: t.name },
    geometry: {
      type: 'LineString',
      coordinates: t.coords.map(c => c[2] != null ? [c[0], c[1], c[2]] : [c[0], c[1]])
    }
  };
  downloadFile(t.name + '.geojson', JSON.stringify(gj, null, 2), 'application/geo+json');
}

function buildWaypointsGPXFragment(waypoints) {
  if (!waypoints || !waypoints.length) return '';
  return waypoints.map(wp => {
    const ele = wp.coords[2] != null ? `\n    <ele>${wp.coords[2]}</ele>` : '';
    const name = wp.name ? `\n    <name>${escapeXml(wp.name)}</name>` : '';
    const sym = wp.sym ? `\n    <sym>${escapeXml(wp.sym)}</sym>` : '';
    const desc = wp.desc ? `\n    <desc>${escapeXml(wp.desc)}</desc>` : '';
    const cmt = wp.comment ? `\n    <cmt>${escapeXml(wp.comment)}</cmt>` : '';
    return `  <wpt lat="${wp.coords[1]}" lon="${wp.coords[0]}">${ele}${name}${sym}${desc}${cmt}\n  </wpt>`;
  }).join('\n');
}

function exportAllGPX() {
  const tracks = tracksFns.getTracks();
  const wpts = tracksFns.getWaypoints ? tracksFns.getWaypoints() : [];
  if (!tracks.length && !wpts.length) return;
  const payload = {
    name: 'All tracks',
    desc: '',
    tracks: [],
    routes: [],
    waypoints: wpts.map(waypoint => buildWaypointEntryFromWaypoint(waypoint)),
  };
  const groupedTracks = new Map();

  for (const track of tracks) {
    if ((track.sourceKind || 'track') === 'route') {
      payload.routes.push(buildRouteEntryFromTrack(track));
      continue;
    }
    if (track.groupId) {
      if (!groupedTracks.has(track.groupId)) groupedTracks.set(track.groupId, []);
      groupedTracks.get(track.groupId).push(track);
      continue;
    }
    payload.tracks.push(buildTrackEntryFromTrack(track));
  }

  for (const [, grouped] of groupedTracks) {
    const first = grouped[0];
    payload.tracks.push(buildTrackEntryFromTrack(first, {
      name: first.groupName || first.name,
      desc: first.desc || '',
      cmt: first.cmt || '',
      type: first.trkType || '',
      segments: grouped.map(track => track.coords || []),
    }));
  }

  downloadFile('all-tracks.gpx', buildGpxDocument(payload), 'application/gpx+xml');
}

// ---- Init: wire drag-drop + export buttons ----

export function initIO(deps) {
  tracksFns = deps;

  const dropOverlay = document.getElementById('drop-overlay');

  // Drag & drop import (with directory support)
  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('visible');
  });
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('visible'); }
  });
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('visible');
    // Try directory entries first (webkitGetAsEntry)
    const items = e.dataTransfer.items;
    if (items && items.length) {
      const entries = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.some(en => en.isDirectory)) {
        for (const entry of entries) {
          if (entry.isDirectory) await readDirectoryEntries(entry);
          else if (entry.isFile) await readFileEntry(entry);
        }
        return;
      }
    }
    // Fall back to files
    for (const file of e.dataTransfer.files) {
      const reader = new FileReader();
      reader.onload = () => importFileContent(file.name, reader.result);
      reader.readAsText(file);
    }
  });

  // Export buttons
  document.getElementById('export-gpx-btn').addEventListener('click', exportActiveGPX);
  document.getElementById('export-geojson-btn').addEventListener('click', exportActiveGeoJSON);
  document.getElementById('export-all-gpx-btn').addEventListener('click', exportAllGPX);

  // Open file button
  const openFileBtn = document.getElementById('open-file-btn');
  if (openFileBtn) {
    openFileBtn.addEventListener('click', openFile);
  }

  // Open folder button
  const openFolderBtn = document.getElementById('open-folder-btn');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', openFolder);
  }

  // Save to folder button (File System Access API or Tauri IPC)
  const saveFolderBtn = document.getElementById('save-folder-btn');
  if (saveFolderBtn) {
    if (isTauri() || 'showDirectoryPicker' in window) {
      saveFolderBtn.addEventListener('click', saveToFolder);
    } else {
      saveFolderBtn.style.display = 'none';
    }
  }
}

// ---- Directory support (progressive) ----

const FILE_PATTERN = /\.(gpx|geojson|json)$/i;

/** Tier 1: File System Access API (Chrome/Edge — read+write) */
async function openDirectoryPicker() {
  const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && FILE_PATTERN.test(name)) {
      const file = await handle.getFile();
      const text = await file.text();
      importFileContent(name, text);
    }
  }
}

/** Tier 2: <input webkitdirectory> fallback (all modern browsers — read only) */
function openDirectoryInput() {
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true;
  input.multiple = true;
  input.accept = '.gpx,.geojson,.json';
  input.addEventListener('change', () => {
    for (const file of input.files) {
      if (FILE_PATTERN.test(file.name)) {
        file.text().then(text => importFileContent(file.name, text));
      }
    }
  });
  input.click();
}

/** Open single file(s): use file picker */
function openFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.gpx,.geojson,.json';
  input.addEventListener('change', () => {
    for (const file of input.files) {
      if (FILE_PATTERN.test(file.name)) {
        file.text().then(text => importFileContent(file.name, text));
      }
    }
  });
  input.click();
}

/** Open folder: use best available API */
async function openFolder() {
  // Desktop mode: use Tauri dialog + file watcher
  if (isTauri()) {
    try { await openFolderTauri(); } catch (e) {
      console.error('[io] Tauri openFolder failed:', e);
    }
    return;
  }
  if ('showDirectoryPicker' in window) {
    try { await openDirectoryPicker(); return; } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled
      console.warn('showDirectoryPicker failed, falling back:', e);
    }
  }
  openDirectoryInput();
}

/** Desktop: pick folder via Tauri dialog, scan + watch for GPX files */
async function openFolderTauri() {
  // Use Tauri dialog plugin to pick a folder
  const internals = globalThis.__TAURI_INTERNALS__ ?? globalThis.__TAURI__;
  let folderPath;
  if (internals?.invoke) {
    // Use the dialog plugin's open command
    folderPath = await internals.invoke('plugin:dialog|open', {
      directory: true,
      multiple: false,
      title: 'Open GPX Folder',
    });
  }
  if (!folderPath) return; // user cancelled

  const result = await pickAndWatchFolder(folderPath);
  if (!result?.snapshot?.files?.length) {
    console.info('[io] Folder has no GPX files:', folderPath);
    return;
  }

  // Load and import each GPX file from the snapshot
  for (const fileState of result.snapshot.files) {
    try {
      const content = await loadGpx(fileState.path);
      const name = fileState.path.split('/').pop() || 'track.gpx';
      importFileContent(name, content);
    } catch (e) {
      console.warn('[io] Failed to load GPX:', fileState.path, e);
    }
  }
}

/** Save all tracks to a folder (Tier 1 only — File System Access API) */
async function saveToFolder() {
  // Desktop mode: save via Tauri IPC (atomic writes + watcher suppression)
  if (isTauri()) {
    try { await saveToFolderTauri(); } catch (e) {
      console.error('[io] Tauri saveToFolder failed:', e);
    }
    return;
  }
  const tracks = tracksFns.getTracks();
  if (!tracks.length) return;
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  for (const t of tracks) {
    const safeName = t.name.replace(/[^a-z0-9._-]/gi, '_');
    const fileHandle = await dirHandle.getFileHandle(safeName + '.gpx', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buildTrackGPXString(t.name, t.coords));
    await writable.close();
  }
}

/** Desktop: save tracks to the watched folder via Tauri IPC */
async function saveToFolderTauri() {
  const tracks = tracksFns.getTracks();
  if (!tracks.length) return;

  // Use Tauri dialog to pick a folder if none is being watched
  const internals = globalThis.__TAURI_INTERNALS__ ?? globalThis.__TAURI__;
  let snapshot;
  try {
    const { getSnapshot } = await import('./tauri-bridge.js');
    snapshot = await getSnapshot();
  } catch { /* ignore */ }

  let folder = snapshot?.folder;
  if (!folder) {
    if (internals?.invoke) {
      folder = await internals.invoke('plugin:dialog|open', {
        directory: true,
        multiple: false,
        title: 'Save GPX Files To',
      });
    }
    if (!folder) return;
  }

  for (const t of tracks) {
    const safeName = t.name.replace(/[^a-z0-9._-]/gi, '_');
    const filePath = `${folder}/${safeName}.gpx`;
    const gpxContent = buildTrackGPXString(t.name, t.coords);
    await saveGpxFile(filePath, gpxContent);
  }
}

/** Tier 3: Read directory entries from drag & drop */
async function readDirectoryEntries(dirEntry) {
  const reader = dirEntry.createReader();
  const entries = await new Promise((resolve) => {
    reader.readEntries(resolve);
  });
  for (const entry of entries) {
    if (entry.isFile && FILE_PATTERN.test(entry.name)) {
      await readFileEntry(entry);
    } else if (entry.isDirectory) {
      await readDirectoryEntries(entry);
    }
  }
}

function readFileEntry(entry) {
  return new Promise((resolve) => {
    entry.file((file) => {
      file.text().then(text => {
        importFileContent(file.name, text);
        resolve();
      });
    });
  });
}
