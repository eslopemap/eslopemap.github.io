# Implementation Plan — FEAT1 Tree, Actions, Metadata

## Goal

Deliver the Phase 1 foundation for the feature set described in [20260326-FEAT.md](/Users/eoubrayrie/code/MAPS/slopedothtml/prompts/20260326-FEAT.md):

- GPX workspace tree model
- context-menu-driven metadata editing
- left edit rail / action-surface cleanup
- shortcut foundation
- shared action shell that later phases can plug into

This plan is standalone and intentionally excludes simplification, split/merge, densify, rectangle selection behavior, and pause cleanup logic beyond the scaffolding needed to support them later.

## Scope

In scope:

- replace ad hoc track grouping with an explicit workspace tree model
- support `folder`, `file`, `track`, `segment`, `route`, `waypoint` nodes
- add object context menus and `Info` editing flow
- move editing controls into a dedicated left rail
- add keyboard shortcut registry and focus guards
- prepare a reusable action dispatch shell with normalized target resolution

Out of scope:

- actual simplify algorithm
- split / merge execution
- densify execution
- rectangle selection interaction
- pause detection cleanup algorithm
- export compatibility expansion beyond fields required by metadata editing persistence

## Design decisions to preserve

- `trkseg` remains non-renameable in V1 because GPX 1.1 has no native name field.
- `Info` replaces double-click rename as the canonical metadata entry point.
- The tree stays compact; point-level nodes are not rendered by default.
- All future tools should resolve through one normalized action contract, even if only the shell is implemented in FEAT1.

## Files to add

- `js/gpx-model.js`
- `js/gpx-tree.js`
- `js/shortcuts.js`

## Files to modify

- `index.html`
- `css/main.css`
- `js/main.js`
- `js/tracks.js`
- `js/io.js`
- `js/state.js`
- `js/persist.js`
- `slope.md`

## Work breakdown

### 1. Add tree data model

Create `js/gpx-model.js`.

Responsibilities:

- define node shapes for `folder`, `file`, `track`, `segment`, `route`, `waypoint`
- generate stable ids
- create default names
- provide tree traversal helpers
- resolve descendants by type
- map imported GPX content into tree nodes
- expose helper to derive a `selectionSpan` shell for future tools

Recommended exported helpers:

- `createWorkspaceModel()`
- `createFolderNode()`
- `createFileNode()`
- `createTrackNode()`
- `createSegmentNode()`
- `createRouteNode()`
- `createWaypointNode()`
- `walkNodes()`
- `findNodeById()`
- `getNodeChildren()`
- `resolveActionTargets()`

### 2. Add tree renderer and context menu

Create `js/gpx-tree.js`.

Responsibilities:

- render the hierarchical tree in the existing track panel area
- support disclosure state
- show row icons, names, stats summary, and add-child affordance
- attach right-click, long-press, and kebab-menu context menu entry points
- open `Info` sheet/modal for supported node types
- expose event hooks back to `main.js` / `tracks.js`

Recommended API:

- `initGpxTree(deps)`
- `renderGpxTree()`
- `openNodeContextMenu(nodeId, anchor)`
- `openInfoEditor(nodeId)`
- `syncTreeSelection()`

### 3. Move to `Info`-driven metadata editing

Implementation detail:

- remove dependence on double-click rename from the future path
- keep any legacy inline rename code only until tree rendering is fully switched over
- when a new file is created, immediately call `openInfoEditor(fileId)`

Fields in V1:

- `folder`: name
- `file`: name, desc
- `track`: name, desc, cmt, type
- `route`: name, desc, cmt, type
- `waypoint`: name, desc, cmt, sym, type

Persistence:

- metadata edits must be persisted through the same save flow as track geometry

### 4. Introduce left edit rail

Modify `index.html` and `css/main.css`.

Objectives:

- separate edit-state tools from object-management actions
- keep the existing top-right or panel action surface focused on object/workspace actions

Minimum FEAT1 rail:

- new track
- edit active track
- undo
- rectangle selection placeholder or disabled button
- mobile mode toggle where applicable

### 5. Add shortcut foundation

Create `js/shortcuts.js`.

Responsibilities:

- central shortcut registry
- focus guards so shortcuts do not fire in inputs/textareas/contenteditable
- macOS `Cmd` parity for documented `Ctrl` shortcuts
- dispatch to app actions through injected callbacks

Implement in FEAT1:

- `Ctrl/Cmd+P`
- `Ctrl/Cmd+L`
- `N`
- `E`
- `Ctrl/Cmd+I`
- `Esc`

Stub but reserve for FEAT2:

- `R`
- `Ctrl/Cmd+Shift+S`
- selection clipboard shortcuts

### 6. Prepare shared action shell

Extend `js/tracks.js` or add a small internal action-dispatch layer in preparation for `js/track-ops.js`.

Need in FEAT1:

- normalize current active object selection
- resolve current node or track target
- expose future-compatible action dispatch signature

Recommended shape:

```text
dispatchTrackAction(actionId, targetContext)
```

Where `targetContext` contains:

- selected node ids
- active track id
- future `selectionSpan`
- source surface: tree, panel, shortcut, map

### 7. Update import mapping

Modify `js/io.js` so imported objects are created through the new workspace model.

Requirements:

- GPX file import creates `file` + descendants
- directory import creates `folder` + files
- multi-segment tracks create `track` with segment children
- waypoints attach under file

Need only enough export compatibility to avoid data loss for newly added metadata fields.

### 8. Update docs

Modify `slope.md`.

Document:

- tree-based workspace
- context menu and `Info`
- left edit rail
- shortcuts added in FEAT1

## Suggested implementation order

1. `gpx-model.js`
2. state + persist changes
3. `gpx-tree.js`
4. wire imports through tree model
5. add `Info` editor
6. left rail HTML/CSS
7. `shortcuts.js`
8. docs update

## State changes

Add to state or equivalent store:

- `workspaceTree`
- `selectedNodeIds`
- `contextMenuState`
- `infoEditorState`
- `expandedNodeIds`
- `activeActionContext`

## Testing checklist

Manual:

- import GPX with one track, multiple segments, route, and waypoints
- import folder and confirm folder/file hierarchy
- open context menu from right click, long press, and kebab button
- open `Info`, edit metadata, save, reload, confirm persistence
- create new file and confirm `Info` opens immediately
- verify shortcuts do not trigger while typing in search or metadata fields
- verify left edit rail and existing panel actions do not overlap awkwardly on mobile width

E2E candidates:

- context menu opens on track row
- `Info` edits track name and persists after reload
- `Cmd/Ctrl+P` toggles profile
- `Cmd/Ctrl+L` toggles track list

## Risks

- existing `tracks.js` rendering and interaction logic is still track-array-centric, so tree state and rendered map state can drift unless ownership is made explicit
- legacy rename handlers may conflict until fully removed from the active UI path
- directory import sync state may be tempting to overbuild in FEAT1; keep it visual-only if write-back is not ready

## Commit slices

Recommended commit sequence once code work starts:

1. `Add GPX workspace tree model and state scaffolding`
2. `Render workspace tree and object context menu`
3. `Replace rename flow with Info editor`
4. `Move edit controls to left rail and add shortcuts foundation`
5. `Update slope.md for workspace tree and Info editing`