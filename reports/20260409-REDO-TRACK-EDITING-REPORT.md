# Report: redo support in track editing

**Date:** 2026-04-09  
**Plan:** `plans/20260409-PLAN-REDO-TRACK-EDITING.md`

## Summary

Implemented true track-editing `redo` support for desktop/browser editing flows.

Delivered:

- a shared `undo-stack.js` module with undo + redo stacks,
- track editor wiring for redo button and keyboard shortcuts,
- browser-visible toolbar affordance (`#redo-btn`),
- unit coverage for redo semantics,
- Playwright desktop coverage for redo on point add, vertex drag, and midpoint insert,
- user-guide updates for the new shortcuts and UI.

## What changed

### 1. Shared history module

Created `app/js/undo-stack.js`.

It now owns:

- snapshot creation,
- undo stack management,
- redo stack management,
- redo-branch clearing after fresh edits,
- restoration of editor-derived state:
  - `selectedVertexIndex`
  - `insertAfterIdx`

This replaces the previous inline undo-only logic that lived in `track-edit.js`.

### 2. Track editor wiring

Updated `app/js/track-edit.js` to:

- use `createUndoStack(...)`,
- expose `popRedo()` beside `popUndo()`,
- show and enable/disable both `undo` and `redo` buttons in edit mode,
- bind redo to both shortcut families:
  - `Ctrl/Cmd+Y`
  - `Ctrl/Cmd+Shift+Z`
- keep the same focus guard behavior as undo/delete by skipping shortcuts while typing in inputs, textareas, or contenteditable nodes.

### 3. Toolbar affordance

Updated `app/index.html` to add a neighboring `redo` button.

Behavior:

- hidden outside track edit mode,
- disabled when there is no redo history,
- enabled immediately after a successful undo.

### 4. Mobile-cancel edge case

One subtle case required explicit handling:

- when mobile vertex move is canceled through the insert popup flow, the editor internally restores the previous geometry via undo,
- that internal restore should **not** seed user-visible redo history.

To avoid reopening canceled internal edits, that path now calls undo with `suppressRedo: true`.

## Persistence semantics

Redo history remains **session-local**.

It is intentionally cleared when:

- entering edit mode,
- exiting edit mode,
- resetting the app for tests,
- making a fresh edit after an undo.

No persistence format changes were made, so redo state is not saved across reloads.

## Tests added or updated

### Unit

Updated `tests/unit/undo-stack.test.mjs` to target the production `undo-stack.js` module directly.

Covered:

- undo restores prior snapshot,
- redo reapplies the most recently undone snapshot,
- fresh edit after undo clears redo branch,
- repeated redo stops at stack boundary,
- selected vertex and insert index restoration,
- deleted-track and empty-stack boundaries.

### Playwright desktop e2e

Extended `tests/e2e/track-desktop.spec.js` with:

- redo via `Meta+Y` after two undos on point-add flow,
- redo via `Meta+Shift+Z` after undo on point-add flow,
- drag vertex → undo → redo geometry restoration,
- midpoint insert → undo → redo geometry restoration.

Also added small helper support in `tests/e2e/helpers.js` for:

- reading active-track coordinates,
- firing deterministic MapLibre mouse events,
- programmatic point-to-point drag simulation.

## Risks / notes

- The new midpoint-insert Playwright test depends on the current desktop hover-insert threshold and track geometry used in the fixture interaction.
- The new drag test also depends on MapLibre hit-testing over the first vertex. If rendering timing changes, small waits may need tuning.
- Redo currently covers the interactive geometry edits already managed by the track editor history stack. Broader non-editor track operations remain outside this history model.

## Files changed

- `app/index.html`
- `app/js/track-edit.js`
- `app/js/undo-stack.js`
- `app/user-guide/content/track-editing.md`
- `tests/e2e/helpers.js`
- `tests/e2e/track-desktop.spec.js`
- `tests/unit/undo-stack.test.mjs`

## Validation status

Implementation completed.

Pending at time of writing:

- run unit tests,
- run targeted Playwright desktop tests,
- fix any interaction-flake or assertion drift discovered during execution,
- create final git commit.
