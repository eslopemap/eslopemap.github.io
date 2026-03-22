// Import/export, drag-drop, file handling.
// Uses @we-gold/gpxjs for GPX parsing.

import { parseGPX as gpxjsParse, stringifyGPX } from '@we-gold/gpxjs';
import { downloadFile } from './utils.js';

let tracksFns = {};  // wired at init

// ---- GPX Parsing (via gpxjs) ----

/**
 * Parse a GPX string into tracks, routes, and waypoints.
 * Multi-segment tracks are split into separate entries (matching legacy behavior).
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
    const trkName = nameEl ? nameEl.textContent.trim() : baseName;
    const segs = trkEl.querySelectorAll('trkseg');
    const gpxTrack = parsed.tracks[ti];

    if (segs.length <= 1) {
      const coords = gpxTrack.points.map(p => [p.longitude, p.latitude, p.elevation]);
      if (coords.length) {
        result.tracks.push({ name: trkName, coords, _gpxParsed: parsed, _gpxTrackIdx: ti });
      }
    } else {
      // gpxjs concatenates all segments; split back using per-segment point counts
      const groupId = 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      let offset = 0;
      for (let si = 0; si < segs.length; si++) {
        const segPtCount = segs[si].querySelectorAll('trkpt').length;
        const segPoints = gpxTrack.points.slice(offset, offset + segPtCount);
        const coords = segPoints.map(p => [p.longitude, p.latitude, p.elevation]);
        if (coords.length) {
          result.tracks.push({
            name: `${trkName} seg${si + 1}`,
            coords,
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
    const name = gr.name || baseName;
    const coords = gr.points.map(p => [p.longitude, p.latitude, p.elevation]);
    if (coords.length) {
      result.tracks.push({ name, coords, _gpxParsed: parsed, _gpxRouteIdx: i });
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
    for (const trk of result.tracks) {
      const t = tracksFns.createTrack(trk.name, trk.coords, {
        groupId: trk.groupId,
        groupName: trk.groupName,
        segmentLabel: trk.segmentLabel,
      });
      tracksFns.fitToTrack(t);
    }
    if (result.waypoints.length && tracksFns.addWaypoints) {
      tracksFns.addWaypoints(result.waypoints);
    }
  } else {
    const coordsList = parseGeoJSON(text);
    if (!coordsList.length) { console.warn('No tracks found in', filename); return; }
    for (let i = 0; i < coordsList.length; i++) {
      const name = coordsList.length > 1 ? `${baseName} (${i + 1})` : baseName;
      const t = tracksFns.createTrack(name, coordsList[i]);
      tracksFns.fitToTrack(t);
    }
  }
}

// ---- Export ----

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildTrackGPXString(name, coords) {
  const pts = coords.map(c => {
    const ele = c[2] != null ? `<ele>${c[2]}</ele>` : '';
    return `      <trkpt lat="${c[1]}" lon="${c[0]}">${ele}</trkpt>`;
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
  downloadFile(t.name + '.gpx', buildTrackGPXString(t.name, t.coords), 'application/gpx+xml');
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
  const wptXml = buildWaypointsGPXFragment(wpts);

  // Group tracks by groupId for proper <trk>/<trkseg> structure
  const trkFragments = [];
  const grouped = new Map();
  const ungrouped = [];
  for (const t of tracks) {
    if (t.groupId) {
      if (!grouped.has(t.groupId)) grouped.set(t.groupId, []);
      grouped.get(t.groupId).push(t);
    } else {
      ungrouped.push(t);
    }
  }

  // Grouped tracks → one <trk> per group with multiple <trkseg>
  for (const [, group] of grouped) {
    const name = group[0].groupName || group[0].name;
    const segs = group.map(t => {
      const pts = t.coords.map(c => {
        const ele = c[2] != null ? `<ele>${c[2]}</ele>` : '';
        return `      <trkpt lat="${c[1]}" lon="${c[0]}">${ele}</trkpt>`;
      }).join('\n');
      return `    <trkseg>\n${pts}\n    </trkseg>`;
    }).join('\n');
    trkFragments.push(`  <trk>\n    <name>${escapeXml(name)}</name>\n${segs}\n  </trk>`);
  }

  // Ungrouped tracks → one <trk> per track
  for (const t of ungrouped) {
    const pts = t.coords.map(c => {
      const ele = c[2] != null ? `<ele>${c[2]}</ele>` : '';
      return `      <trkpt lat="${c[1]}" lon="${c[0]}">${ele}</trkpt>`;
    }).join('\n');
    trkFragments.push(`  <trk>\n    <name>${escapeXml(t.name)}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>`);
  }

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="slope-editor">
${wptXml}
${trkFragments.join('\n')}
</gpx>`;
  downloadFile('all-tracks.gpx', gpx, 'application/gpx+xml');
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

  // Open folder button
  const openFolderBtn = document.getElementById('open-folder-btn');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', openFolder);
  }

  // Save to folder button (only if File System Access API available)
  const saveFolderBtn = document.getElementById('save-folder-btn');
  if (saveFolderBtn) {
    if ('showDirectoryPicker' in window) {
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

/** Open folder: use best available API */
async function openFolder() {
  if ('showDirectoryPicker' in window) {
    try { await openDirectoryPicker(); return; } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled
      console.warn('showDirectoryPicker failed, falling back:', e);
    }
  }
  openDirectoryInput();
}

/** Save all tracks to a folder (Tier 1 only — File System Access API) */
async function saveToFolder() {
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
