# Plan: redo support in track editing

**Date:** 2026-04-09  
**Scope:** add a true `redo` operation for track editing, bind it to both requested shortcut families, and validate it with unit and browser e2e coverage.

## Goal

Add a true `redo` operation that reverses `undo` in track editing flows and bind it to both:

- `Ctrl+Y` / `Cmd+Y`
- `Ctrl+Shift+Z` / `Cmd+Shift+Z`

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
- redo should behave consistently across `Ctrl` and `Cmd` platforms

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

### Milestone A — confirm stack capability

Determine whether redo belongs in the existing stack abstraction or requires a new redo buffer implementation.

### Milestone B — wire editor behavior

Deliver keyboard shortcuts, editor command routing, and undo/redo UI-state synchronization.

### Milestone C — validate with tests

Deliver unit and browser e2e coverage for redo across point add, vertex drag, and insert-between flows.

## Success criteria

The effort is successful when:

- redo is available through both requested shortcut families
- redo reliably restores the most recently undone track-edit mutation
- redo history is cleared correctly by fresh edits after undo
- redo remains session-local and does not create persistence regressions
- tests protect user-visible editing behavior rather than internal implementation details
