# Plan: increase functionality coverage and add redo in track editing

**Date:** 2026-04-09  
**Scope:** use the consolidated 4-suite coverage report to guide new tests toward missing user-visible functionality, with a dedicated follow-up plan for redo support in desktop track editing.

## Problem summary

The consolidated coverage report is now authoritative across four suites:

- Vitest unit coverage
- Playwright browser e2e JS coverage
- Rust `cargo llvm-cov` coverage
- Tauri WebDriver behavioral desktop coverage

The report shows that the weakest frontend areas are not low-value helper code. They are user-facing workflows with meaningful interaction complexity:

- `app/js/track-edit.js` — 13.2%
- `app/js/track-ops.js` — 14.0%
- `app/js/gpx-tree.js` — 19.5%
- `app/js/saved-data.js` — 23.3%
- `app/js/io.js` — 23.6%
- `app/js/selection-tools.js` — 25.6%
- `app/js/tracks.js` — 26.6%

On the desktop side, Tauri e2e currently exercises important persistence and local-tile flows, but it still misses at least two high-value behaviors:

- `remove_tile_source`
- `clear_tile_cache`

The goal should be to raise **functionality coverage**, not merely line coverage. That means prioritizing flows a user can see break, flows that cross module boundaries, and flows that differ between web and desktop modes.

## Planning principles

### 1. Prefer end-to-end user stories over isolated assertions

A new test should prove that a real workflow works, for example:

- create, modify, undo, and persist a track
- import data, surface errors, and recover cleanly
- register or remove a local source and verify the UI reflects it

### 2. Use the cheapest test level that still validates the functionality

- use **Vitest** for pure decision logic and state transitions
- use **Playwright** for browser UI and DOM-heavy map workflows
- use **Tauri WebDriver** for desktop-only persistence, IPC, and local tile server behavior
- use **Rust tests** only when the missing behavior is backend-owned

### 3. Target workflow seams with broad impact

The best candidates are features that fan out across multiple modules:

- track editing and edit-mode state
- track tree actions and selection propagation
- import / export / saved-data flows
- desktop source lifecycle and cache management

### 4. Avoid filler tests

Do not add tests that assert implementation details without protecting a real user flow. If a line can only be covered through brittle internals and no user value is added, leave it uncovered.

## Coverage-driven priorities

## Priority 1 — track editing workflows (`track-edit.js`, `tracks.js`, `main.js`)

These files carry the highest user-facing risk and the lowest merged JS coverage. They also already have partial Playwright support, which means adding tests here is efficient.

### Proposed new browser e2e scenarios

- drag an existing vertex and verify geometry and stats update
- insert a vertex using the hover insert marker and verify point count increases
- click a vertex without dragging and verify selection changes without geometry mutation
- exit edit mode by double-clicking and verify editing state clears cleanly
- delete the selected vertex with keyboard delete/backspace and verify the active track updates
- verify right-click during edit mode does not accidentally mutate the track
- verify dragging suppresses the follow-up map click so no extra point is inserted

### Why this is high value

These paths exercise real mouse and keyboard behavior in `track-edit.js`, including drag lifecycle, selection state, insert markers, undo stack pushes, and map cursor transitions. A failure here is immediately visible to users editing GPX geometry.

### Suggested implementation order

1. extend `tests/e2e/helpers.js` with small reusable helpers for drag and vertex targeting
2. add Playwright tests in `tests/e2e/track-desktop.spec.js`
3. only add unit coverage where logic can be isolated without mocking MapLibre too heavily

## Priority 2 — track operations and tree actions (`track-ops.js`, `gpx-tree.js`, `selection-tools.js`)

Coverage is weak in the modules responsible for manipulating and selecting track structures, which are central to the editor workflow.

### Proposed functional scenarios

- split a track from the tree and verify resulting segment structure
- merge or join selected tracks and verify resulting tree state and active selection
- duplicate or rename a track from tree actions and verify persistence in UI state
- promote/demote selection operations and verify map and tree stay synchronized
- apply selection-based operations after switching the active track and verify no stale selection leaks across tracks

### Test levels

- **Playwright** for tree-to-map synchronization and selection UX
- **Vitest** for smaller pure helpers in operation planning or selection computations if any are extractable

### Why this is high value

These workflows are used immediately after import and during editing. They cover not just one module but coordination between tree rendering, selection state, active track ownership, and derived map sources.

## Priority 3 — import, saved data, and recovery flows (`io.js`, `saved-data.js`, `web-import.js`)

These files sit on critical entry and persistence paths, but the report still shows limited functional coverage.

### Proposed functional scenarios

- import invalid GeoJSON or GPX and verify the user gets a safe error path without corrupting current state
- import multiple files in sequence and verify naming, activation, and panel state remain coherent
- clear one saved-data category and verify unrelated categories remain intact
- clear all saved data, reload, and verify the empty-state UI is coherent
- import from URL, then reload, and verify persisted state or expected non-persistence per mode

### Desktop extension

For desktop-specific source-backed imports, add coverage only where Tauri behavior genuinely differs, such as backend-discovered local layers or config-backed state restoration.

## Priority 4 — desktop source lifecycle gaps (`remove_tile_source`, `clear_tile_cache`)

The report explicitly identifies these behavioral gaps in Tauri coverage.

### Proposed Tauri e2e scenarios

- register a local MBTiles or PMTiles source, remove it through the desktop path, then verify:
  - it disappears from the TileJSON catalog
  - it disappears from the UI source list
  - after app reload it does not reappear

- populate tile cache, clear it through the desktop command or UI path, then verify:
  - cache stats drop as expected
  - a previously cached tile is no longer served from cache
  - behavior after reload matches the cleared state

### Why this is high value

These are backend-owned lifecycle flows that web tests cannot prove. They close explicit gaps in the current desktop behavioral inventory and reduce the risk of stale local data or misleading source lists.

## Priority 5 — Rust backend gaps (`src-tauri/src/main.rs`, command wiring)

Rust line coverage is materially better than frontend coverage, but `src-tauri/src/main.rs` remains low because app wiring and command registration are hard to cover indirectly.

### Recommended approach

Do not chase `main.rs` line coverage directly. Instead:

- add focused Rust tests around command handlers that are currently only hit through Tauri e2e
- prioritize config validation, tile-source removal semantics, and cache-clear side effects
- let Tauri e2e continue to prove the top-level desktop integration path

## Redo functionality plan

## Goal

Add a true `redo` operation that reverses `undo` in track editing flows and bind it to both:

- `Ctrl+Y` / `Meta+Y`
- `Ctrl+Shift+Z` / `Meta+Shift+Z`

## Current state

The editor currently exposes undo behavior in user flows and keyboard handling, but no redo behavior is visible in the inspected track-edit event handling. There is already an `undo-stack.test.mjs`, which suggests the stack abstraction may already support or nearly support redo semantics, but the UI/editor wiring must be verified during implementation.

## Functional requirements

- redo restores the most recently undone edit
- a new edit after undo clears any redo branch
- redo works for point creation, point deletion, vertex drag, and insert-between operations
- redo updates derived state exactly as undo does:
  - active track geometry
  - track stats
  - selected vertex when relevant
  - undo/redo button enabled state
- redo shortcuts must not fire while typing in text inputs or textareas
- redo should behave consistently across `Ctrl` and `Meta` platforms

## Proposed implementation steps

### 1. Audit the current undo stack API

Check whether the existing stack already has a redo buffer or whether it is strictly destructive on pop.

Possible outcomes:

- if redo support already exists in the state layer, wire it into `track-edit.js` and UI controls
- if not, extend the stack abstraction first and keep editor code thin

### 2. Add editor command wiring

In `track-edit.js`:

- add a `redo` action symmetrical to `popUndo()`
- bind keyboard shortcuts for:
  - `Ctrl+Y` / `Meta+Y`
  - `Ctrl+Shift+Z` / `Meta+Shift+Z`
- ensure shortcut guards match the existing delete/undo focus protections

### 3. Add visible UI affordance

If the app already has an undo button, add a neighboring redo button with matching enable/disable semantics. If UI work is deferred, the keyboard path can land first, but the plan should treat the button as the expected end state because discoverability matters.

### 4. Add tests before or with implementation

#### Unit tests

Extend `tests/unit/undo-stack.test.mjs` to cover:

- undo followed by redo restores previous snapshot
- new edit after undo clears redo history
- repeated redo stops cleanly at stack boundary

#### Browser e2e tests

Extend `tests/e2e/track-desktop.spec.js` to cover:

- add points, undo twice, redo once via `Meta+Y`
- add points, undo once, redo via `Meta+Shift+Z`
- drag a vertex, undo, redo, verify geometry returns to dragged position
- insert a midpoint vertex, undo, redo, verify point count and coordinates restore

### 5. Consider persistence semantics explicitly

Redo history should almost certainly be session-local and **not** persisted across reload. Document and test that expectation if the implementation touches persistence or reset paths.

## Milestones

### Milestone A — close explicit desktop behavioral gaps

Deliver Tauri e2e coverage for:

- `remove_tile_source`
- `clear_tile_cache`

### Milestone B — lift track editing functionality coverage

Deliver new Playwright coverage for drag, insert, delete, selection, and edit-exit flows.

### Milestone C — strengthen track/tree operation coverage

Deliver at least two high-value tree or selection operation workflows with real user-visible assertions.

### Milestone D — ship redo

Deliver redo stack support, keyboard bindings, optional button support, and unit plus e2e coverage.

## Success criteria

The effort is successful when:

- the next consolidated report shows meaningful gains in `track-edit.js`, `track-ops.js`, `gpx-tree.js`, and adjacent editing modules
- Tauri e2e inventory includes `remove_tile_source` and `clear_tile_cache`
- redo is available through both requested shortcut families and behaves reliably after undo
- tests remain scenario-driven and protect user-visible behavior rather than internal implementation details
