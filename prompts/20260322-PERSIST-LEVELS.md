# Plan: Persistence, Waypoints, Track Nesting, Import/Export & File Split

Five workstreams, ordered by dependency. Each produces one or more commits with tests and slope.md updates.

## Library: `@we-gold/gpxjs`

All GPX parsing/serialization uses [`@we-gold/gpxjs`](https://github.com/We-Gold/gpxjs):
- `parseGPX(source)` → `[ParsedGPX, null]` or `[null, Error]`
- `stringifyGPX(parsedGPX)` → XML string (round-trips the original `xml: Document`)
- Preserves tracks, routes, waypoints, metadata, extensions, and any unknown elements.
- **Round-trip principle**: any GPX data not handled by the app (extensions, metadata, etc.) is kept in the `ParsedGPX.xml` Document and re-exported via `stringifyGPX()`. Each track object stores a reference to its source `ParsedGPX` so export can reconstruct the original.
- Loaded from local `node_modules` ESM bundle via importmap: `"@we-gold/gpxjs": "./node_modules/@we-gold/gpxjs/dist/gpxjs.js"`
- Install: `npm i @we-gold/gpxjs`

---

## 1. localStorage persistence via nanostores/persistent

**Goal**: Save/restore tracks + settings across page reloads.

**Approach**:
- Add `nanostores` + `@nanostores/persistent` from CDN (`esm.sh`). Both are tiny (~300 B + ~400 B).
- Create `js/persist.js` — thin wrapper that:
  - Creates a `persistentAtom('slope:settings', defaults, { encode: JSON.stringify, decode: JSON.parse })` for settings (basemap, mode, opacity, hillshade, cursorInfoMode, terrain3d, exaggeration, multiplyBlend, showContours, showOpenSkiMap).
  - Creates a `persistentAtom('slope:tracks', [], ...)` for track data (name, color, coords, waypoints).
  - Exposes `saveSettings(state)`, `loadSettings()`, `saveTracks(tracks)`, `loadTracks()`.
- **Settings**: on startup, merge persisted settings with URL hash (URL hash wins for any key present). On settings change, write to persistent store.
- **Tracks**: on startup, restore saved tracks. On any track mutation (add/remove/edit vertex/rename), debounce-save to persistent store (200 ms).
- **Interaction with URL hash**: URL hash remains the primary source for view position (lng/lat/zoom/bearing/pitch) and analysis settings. localStorage adds persistence for settings that aren't in the URL (like track data) and acts as defaults when URL hash is empty.
- **Clear button**: add a "Clear saved data" option in advanced settings (clears both keys).

**Data format** (localStorage value for `slope:tracks`):
```json
[{
  "name": "Track 1",
  "color": "#e74c3c",
  "coords": [[6.86, 45.83, 1500], ...],
  "waypoints": [{"name": "Summit", "coords": [6.87, 45.84, 2100], "sym": "Flag"}]
}]
```

**Tests**:
- E2E: create a track → reload → track is restored with correct name, color, coords.
- E2E: change settings → reload → settings persist.
- E2E: "Clear saved data" → reload → clean slate.

**Commit**: `feat: localStorage persistence for tracks and settings via nanostores/persistent`

---

## 2. GPX waypoints (`<wpt>`) + gpxjs migration

**Goal**: Replace hand-rolled GPX parser with `@we-gold/gpxjs`. Parse `<wpt>` elements; render as symbol layer with label. Ensure GPX round-trips faithfully — any data not actively handled is preserved for re-export.

**GPX round-trip strategy**:
- On import, store the `ParsedGPX` object (which contains the original `xml: Document`) alongside the created tracks.
- Each track keeps a `_gpxSource: { parsedGPX, trackIndex }` back-reference.
- On export, if a track came from GPX import, use `stringifyGPX(parsedGPX)` to get the full document back (preserving extensions, metadata, unknown elements). Coordinates are updated in the Document from the (potentially edited) track coords before stringification.
- For newly-drawn tracks (no `_gpxSource`), build a minimal GPX from scratch.

**Parsing changes** (in io.js, using gpxjs):
- `parseGPX(text)` returns `[parsedGPX, null]` — gives `.tracks[]`, `.routes[]`, `.waypoints[]`, `.metadata`.
- Each `Track` from gpxjs has `.points[]` with `{ latitude, longitude, elevation, time, extensions }`.
- gpxjs flattens multi-segment tracks: each `<trkseg>` becomes a separate Track in `.tracks[]` — need to reconstruct grouping (workstream #4) by inspecting the source XML or using the track name pattern.

**Waypoint data model**:
- Global `waypoints[]` array: `{ id, name, coords: [lng, lat, ele?], sym, desc, comment }`.
- Populated from `parsedGPX.waypoints[]` on import.

**Rendering**:
- Single GeoJSON source `waypoints` with a `symbol` layer using text labels + circle fallback.
- Use MapLibre `text-field: ['get', 'name']` with `text-offset` and a small circle icon.
- Waypoints are always visible (not tied to active track).

**Export**:
- `exportAllGPX()`: if all tracks share a common `ParsedGPX` source, use `stringifyGPX()` after syncing coords back. Otherwise, build a composite GPX with `<wpt>` elements included.
- `exportActiveGPX()`: for a single track, build GPX with just that track's data.

**Track panel UI**:
- Minimal: show waypoint count in track panel header, expand for list with delete.

**Tests**:
- E2E: import GPX with `<wpt>` elements → waypoints appear on map.
- E2E: import GPX with `<wpt>` + `<trk>` → both tracks and waypoints loaded.
- E2E: export → re-import → data matches (round-trip).
- E2E: GPX with extensions → export preserves extensions.

**Commits**:
1. `refactor: replace hand-rolled GPX parser with @we-gold/gpxjs`
2. `feat: GPX waypoint (<wpt>) parsing and map rendering with labels`
3. `feat: GPX round-trip preservation of extensions and metadata`

---

## 3. Split tracks.js — extract track-edit.js

**Goal**: tracks.js is ~1200 lines. Split editing logic from track CRUD, rendering, and stats.

**Interface boundary**:

| File | Responsibility | Approximate lines |
|------|---------------|-------------------|
| `js/tracks.js` | Track CRUD, data model, stats, map sources/layers, track list UI, panel management | ~550 |
| `js/track-edit.js` | Vertex interaction (click/drag/tap), insert popup, hover-insert, mobile editing, selection, insert preview, crosshair, keyboard shortcuts | ~450 |
| `js/io.js` | Import/export (GPX/GeoJSON parsing, file generation, drag-drop, directory access) — extracted in workstream 5 | ~300 |

**Concrete split** — `track-edit.js` gets:
- `enterEditMode()`, `exitEditMode()`
- Map click handler (vertex add/select/delete)
- `hitTestVertex()`, `cancelMobileMove()`
- `updateInsertPopup()`, `removeInsertPopup()`
- `updateInsertPreview()`, `findClosestPointOnTrack()`
- `clearHoverInsertMarker()`, `showHoverInsertMarker()`
- Desktop mouse handlers (drag vertex, hover insert, mousemove)
- Mobile touch handlers
- Keyboard handlers (Escape, Ctrl+Z)
- Draw button + undo button click handlers
- `startNewTrack()` (delegates createTrack to tracks.js)

**Interface** — `track-edit.js` imports from `tracks.js`:
```js
import {
  tracks, getActiveTrack, createTrack, deleteTrack,
  setActiveTrack, refreshTrackSource, renderTrackList,
  invalidateTrackStats, trackPtsLayerId,
  setTrackPanelVisible, syncUndoBtn, syncProfileToggleButton,
} from './tracks.js';
```

And `tracks.js` calls `track-edit.js` only for:
```js
import { initTrackEdit, isTrackEditing } from './track-edit.js';
```

**Shared state**: editing-specific state (`editingTrackId`, `selectedVertexIndex`, `insertAfterIdx`, `mobileFriendlyMode`, etc.) moves to `track-edit.js`. Track data (`tracks[]`, `activeTrackId`) stays in `tracks.js`.

**Tests**: existing E2E tests must keep passing — this is a refactor with no behavior change.

**Commit**: `refactor: extract track-edit.js from tracks.js (editing/interaction logic)`

---

## 4. Two-level nesting in track panel (GPX track > segment)

**Goal**: Support full GPX hierarchy — a GPX file becomes a "group" containing tracks, each track containing segments. Display 2-level nesting in the panel. Allow renaming at each level.

**Data model change**:
```js
// Current:
{ id, name, color, coords, _statsCache }

// New (backward-compatible):
{
  id, name, color, coords, _statsCache,
  parentId: null | 'grp-xxx',  // null = top-level
  children: [],                 // for group nodes only
  type: 'track' | 'group'
}
```

**Alternative (simpler)**: keep the flat `tracks[]` array, add a `groupName` + `segmentIndex` field. Group by `groupName` at render time. This avoids tree traversal complexity.

**Decision**: flat array with grouping metadata. A track has:
```js
{
  id, name, color, coords, _statsCache,
  groupId: null | string,     // tracks with same groupId are siblings
  groupName: null | string,   // display name for the group
  segmentLabel: null | string  // e.g. "seg 1", "seg 2"
}
```

**GPX import change**: gpxjs flattens each `<trkseg>` into a separate Track entry in `.tracks[]`. On import, group consecutive tracks sharing the same XML `<trk>` parent into a group with a shared `groupId` and `groupName`. The source `ParsedGPX` object's XML document is inspected to determine the original `<trk>/<trkseg>` hierarchy.

**Track panel rendering change** (`renderTrackList()`):
- Group tracks by `groupId`. Ungrouped tracks render as today.
- For groups: render a collapsible header row with the group name (editable via inline edit) and aggregate stats.
- Under the header: indented rows for each segment, each with its own name (editable), stats, edit/delete buttons.
- Clicking the group header selects all segments (shows all on profile). Clicking a segment selects just that one.

**Rename**: double-click the name text (group or segment) → inline `<input>` → Enter/blur saves. The name is persisted in the track object.

**Tests**:
- E2E: import multi-segment GPX → panel shows 2-level nesting.
- E2E: rename group → name updates, persists after save/reload.
- E2E: rename segment → name updates.
- E2E: collapse/expand group.
- E2E: export multi-segment → GPX preserves hierarchy.

**Commits**:
1. `feat: track data model supports groupId/groupName for nesting`
2. `feat: 2-level nested track panel with collapse/expand and inline rename`

---

## 5. Import/export refactor + directory support → `js/io.js`

**Goal**: Extract all import/export code into `js/io.js`. Add progressive directory read/write support.

### 5a. Extract `js/io.js`

**Moves to `io.js`**:
- `importFileContent(filename, text)`
- `gpxParsePoints(ptEls)`, `parseGPX(text, baseName)`, `parseGeoJSON(text)`
- `exportActiveGPX()`, `exportActiveGeoJSON()`, `exportAllGPX()`
- Drag-and-drop event handlers (`dragenter`, `dragleave`, `dragover`, `drop`)
- Export button wiring
- New: directory import/export functions

**Interface**:
```js
// io.js exports:
export function initIO(mapRef, { createTrack, getActiveTrack, tracks, addWaypoints }) { ... }
export function parseGPX(text, baseName) { ... }  // also used by tests
export function parseGeoJSON(text) { ... }

// io.js imports from tracks.js:
import { createTrack, getActiveTrack, tracks, fitToTrack } from './tracks.js';
```

**Commit**: `refactor: extract io.js from tracks.js (import/export + drag-drop)`

### 5b. Directory support (progressive)

Three tiers, detected at runtime:

| Tier | API | Capabilities | Browsers |
|------|-----|-------------|----------|
| 1 | File System Access API (`showDirectoryPicker`) | Read + Write | Chrome, Edge |
| 2 | `<input type="file" webkitdirectory>` | Read only | All modern |
| 3 | Drag & drop with `DataTransferItem.webkitGetAsEntry()` | Read only | All modern |

**Implementation**:

```js
// Feature detection
const hasFileSystemAccess = 'showDirectoryPicker' in window;

// Tier 1: File System Access API
async function openDirectory() {
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  // iterate entries, filter *.gpx / *.geojson
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && /\.(gpx|geojson|json)$/i.test(name)) {
      const file = await handle.getFile();
      const text = await file.text();
      importFileContent(name, text);
    }
  }
  return dirHandle; // keep handle for write-back
}

async function saveToDirectory(dirHandle, tracks) {
  for (const t of tracks) {
    const fileHandle = await dirHandle.getFileHandle(
      `${t.name.replace(/[^a-z0-9]/gi, '_')}.gpx`,
      { create: true }
    );
    const writable = await fileHandle.createWritable();
    await writable.write(buildGPXString(t));
    await writable.close();
  }
}

// Tier 2: <input webkitdirectory> fallback
function openDirectoryFallback() {
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true;
  input.multiple = true;
  input.accept = '.gpx,.geojson,.json';
  input.addEventListener('change', () => {
    for (const file of input.files) {
      file.text().then(text => importFileContent(file.name, text));
    }
  });
  input.click();
}

// Tier 3: Drag & drop directory (already partially exists, enhance)
// Use DataTransferItem.webkitGetAsEntry() to recurse into directories
async function handleDropEntries(items) {
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (!entry) continue;
    if (entry.isFile) {
      entry.file(file => file.text().then(text => importFileContent(file.name, text)));
    } else if (entry.isDirectory) {
      await readDirectoryEntries(entry);
    }
  }
}
```

**UI**:
- Add "Open folder…" button in the track export bar (or replace/augment current export buttons).
- On Chrome: uses tier 1 (read+write). Button label: "Open folder…" / "Save to folder…".
- On other browsers: "Open folder…" uses tier 2 (read-only). No "Save to folder" (falls back to individual file downloads).
- Drag & drop: enhanced to detect directories via `webkitGetAsEntry().isDirectory`.

**Tests**:
- E2E (Chromium): test File System Access API mock (Playwright supports `page.evaluate` to stub `showDirectoryPicker`).
- E2E: test `<input webkitdirectory>` flow.
- E2E: import GPX via enhanced drag & drop.

**Commits**:
1. `refactor: extract io.js from tracks.js (import/export + drag-drop)`
2. `feat: progressive directory import/export (File System Access, webkitdirectory, DnD)`

---

## Implementation order

```
Phase 1 — Refactors (no new behavior)
  ├── 3. Split track-edit.js from tracks.js
  └── 5a. Extract io.js from tracks.js

Phase 2 — New features (build on clean modules)
  ├── 1. localStorage persistence (nanostores/persistent)
  ├── 2. GPX waypoints
  ├── 4. Two-level nesting (groupId)
  └── 5b. Directory support

Each step: implement → test → update slope.md → commit
playwright tests take >3 minutes to run, do not run the full test suite.
At the end, try to optimize the runtime of the tests.
```

**Rationale**: refactors first so the new features land in clean, focused files. Persistence and waypoints are independent. Nesting and directory support build on the new io.js.

---

## slope.md updates

After each phase, update:
- **Module structure** section: add new files, update line counts and descriptions
- **Dependency flow**: add new edges
- **Track editor — state model**: update for groupId/groupName, waypoints
- **GPX / GeoJSON import**: add waypoint parsing, directory import tiers
- **New section: Persistence**: localStorage keys, merge logic with URL hash
- **New section: Waypoints**: rendering, UI, export behavior
- **New section: Track nesting**: grouping model, panel rendering, rename

---

## Risk notes

- **gpxjs multi-segment handling**: gpxjs creates one Track per `<trkseg>`. For grouping (workstream #4), we need to inspect the XML `<trk>` parent elements to reconstruct the hierarchy. The `parsedGPX.xml` Document makes this possible.
- **nanostores/persistent CDN**: use `esm.sh` pinned versions. Fallback: implement the ~30 lines of localStorage wrapper manually if CDN is problematic.
- **File System Access API**: only Chromium. Progressive enhancement is key — app must work perfectly without it. The `<input webkitdirectory>` fallback is cross-browser but read-only.
- **Track nesting complexity**: the flat-array-with-groupId approach keeps the data model simple and avoids breaking existing code that iterates `tracks[]`. Export must reconstruct the `<trk>/<trkseg>` hierarchy from the grouping metadata.
- **Persistence data migration**: if the persisted format changes later, include a `version` field in the stored JSON and migrate on load.
