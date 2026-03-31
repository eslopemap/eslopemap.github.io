---
description: Tauri Spike 2 plan for file-centric GPX sync v1
---

# Tauri Spike 2 — File-Centric GPX Sync v1

## Goal

Validate that a **file-centric** GPX sync model is understandable, testable, and robust enough for v1.

This spike is specifically meant to answer:

- can we treat a GPX file as the sync identity
- can we avoid track-level merge semantics in v1
- can we handle save, rename, delete, and external edits with understandable behavior

## Deliverable

Create a minimal demonstrator under:

- `spike_demo/gpx_sync_filecentric`

The demonstrator must show a small desktop flow where a watched folder and the app stay synchronized at the **whole-file level**.
The index.html part must work both in Tauri and in a regular browser, using The File System Access API.

- `spike_demo/gpx_sync_filecentric/gpx_samples` with sample GPX files for the testing

## Non-Goals

- no trackpoint-level merge
- no fancy diff UI
- no full production tree implementation
- no multi-window sync
- no cloud sync support

## Core Hypothesis

For v1, a file-centric model is sufficient if:

- the watched folder is explicit
- writes are atomic
- app-originated writes do not create confusing watcher loops
- conflicts are detected at the file level
- rename/move behavior is explicit and limited

## Demonstrator Scope

### Minimal UI

The demo UI should include:

- watched folder path
- file list in the folder
- selected file editor area or preview
- dirty state indicator
- buttons for:
  - `Watch Folder`
  - `Save`
  - `Reload from Disk`
  - `Simulate External Change` if useful for deterministic testing
- a debug event log panel

### File Model

Use only whole-file sync semantics.

Required file states:

- known and clean
- dirty in app
- changed on disk
- conflict
- deleted on disk

## Rust Responsibilities

### Watcher Layer

- use `notify`
- debounce noisy event bursts
- normalize rename/write/remove cases into app-level events
- keep a per-file state map containing:
  - path
  - content hash
  - last known mtime
  - dirty-in-app flag
  - last-write-origin marker if needed

### Command Layer

Implement only the minimal command surface needed:

- `pick_and_watch_folder`
- `list_folder_gpx`
- `load_gpx`
- `save_gpx`
- optionally `rename_gpx`

### Save Semantics

- write atomically using temp-file + rename
- update internal file state after successful save
- avoid watcher echo causing fake conflicts

## Frontend Responsibilities

- show one selected file at a time
- mark file dirty on edit
- save the entire GPX file on save
- respond to watcher events by either:
  - auto-reloading if clean
  - marking conflict if dirty

## Required Test Scenarios

### Scenario 1 — Clean External Edit

1. watch a folder with one GPX file
2. app is clean
3. file changes externally
4. app reloads automatically

Expected:

- no conflict
- updated content visible
- event log is clear

### Scenario 2 — Dirty In-App Then External Edit

1. open file
2. modify in app without saving
3. modify same file externally

Expected:

- file enters conflict state
- app does not silently overwrite external content
- user gets a clear choice

### Scenario 3 — App Save

1. modify file in app
2. save

Expected:

- atomic write succeeds
- dirty state clears
- watcher does not produce a false conflict

### Scenario 4 — External Rename

1. watch a folder with a GPX file
2. rename the file externally

Expected:

- file list updates predictably
- no duplicate phantom entries remain

### Scenario 5 — External Delete

1. watch a folder with a GPX file
2. delete it externally

Expected:

- UI reflects deletion
- selection state is handled safely

### Scenario 6 — Multi-Track File

1. load a GPX containing multiple `<trk>` elements
2. edit one logical track in the UI
3. save

Expected:

- entire GPX file is rewritten
- no claim is made that individual tracks are independent sync identities

## Fixtures

Create and commit deterministic fixtures under:

- `tests/fixtures/gpx/simple-single-track.gpx`
- `tests/fixtures/gpx/multi-track.gpx`
- `tests/fixtures/gpx/conflict-base.gpx`

Optional:

- `tests/fixtures/gpx/renamed-copy.gpx`
- `tests/fixtures/gpx/external-edit-variant.gpx`

## Recommended Test Strategy

### Rust Unit Tests

- content hash changes detected correctly
- same content does not trigger false update
- atomic save writes expected bytes
- watcher-event normalization handles noisy sequences

### Rust Integration Tests

Use temp directories to simulate:

- create
- modify
- rename
- delete
- save from app then observe resulting watcher events

### Frontend Tests

You can use e.g. rodney with `uvx rodney --help` or Playwright.

Mock the bridge and validate:

- dirty-state transitions
- conflict-state transitions
- user choice flow after conflict

### End-to-End Demo Checks

- select file
- edit file
- save file
- trigger external change
- verify event log and UI state

## Evaluation Criteria

At the end of the spike, answer these explicitly:

- Is the file-centric model understandable enough for users?
- Is the code path testable without depending on the full production app?
- Are watcher loops manageable with modest complexity?
- Are rename/delete behaviors acceptable in v1?
- Is there any evidence that track-level sync is required immediately?

## Exit Criteria

The spike is successful if:

- the demonstrator proves that whole-file sync is workable
- the conflict model is understandable
- the test scenarios above are automated or at least scripted reproducibly
- the team can confidently defer track-level merge semantics beyond v1

If the spike fails, document exactly where the file-centric model breaks down before expanding scope.

Use https://github.com/danielraffel/tauri-webdriver for end-to-end testing
