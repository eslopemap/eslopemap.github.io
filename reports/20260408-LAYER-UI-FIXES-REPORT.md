# Layer UI Fixes & Improvements Report

**Date:** 2025-04-08

## Summary

Addressed 7 follow-up items related to layer management, UI layout, track panel display, and test stability.

## Changes

### 1. Visibility toggle sync with persistence/bookmarks
- **Files:** `app/js/layer-engine.js`
- `applyAllLayerSettings()` now restores both opacity AND hidden state from `layerSettings`
- `applyBookmark()` re-applies basemap opacities after bookmark restoration
- Layer order panel re-rendered after map load to show correct initial visibility state

### 2. Opacity slider drag fix
- **Files:** `app/js/main.js`
- Added `draggable=false` to opacity range inputs
- Added `dragstart` preventDefault and `mousedown`/`touchstart` stopPropagation
- Prevents native drag-and-drop from capturing slider interactions

### 3. 3D terrain standalone button
- **Files:** `app/js/main.js`, `app/css/main.css`, `app/index.html`
- Removed checkbox from settings panel
- Created custom MapLibre control (`Terrain3DControl`) with isometric cube SVG
- Positioned above geolocate control in bottom-right corner
- Active state highlighted in blue

### 4. Un-tilt map on 3D terrain disable
- **Files:** `app/js/main.js`
- When toggling 3D off, `map.easeTo({ pitch: 0, duration: 500 })` smoothly resets tilt

### 5. Panel restructure: Layers ↔ Settings
- **Files:** `app/index.html`, `app/js/main.js`, `app/css/main.css`
- Layers button first (🗂), Settings button second (⚙)
- **Layers panel** now contains: Basemap, Mode, Contour lines, Add layer, Layer order, Layer settings (advanced collapse), Bookmarks
- **Settings panel** slimmed to: Elevation & slope display, Pause threshold, Profile smoothing, DEM tile grid, Clear data
- Panels are exclusive (opening one closes the other)
- Both close on map drag

### 6. Track panel middle-ellipsis for long names
- **Files:** `app/js/gpx-tree.js`, `app/css/main.css`
- Tree names split into `tree-name-start` (truncates with ellipsis) + `tree-name-end` (last 12 chars, always visible)
- Full name shown as native tooltip on hover
- Track panel shell max-width capped at 360px

### 7. Test fixes
- **DEM rendering tests:** Replaced fixed `waitForTimeout` with polling `waitForDemRender()` that checks pixel data; increased test timeout to 30s for SwiftShader
- **Persist test:** Adapted to new panel layout; use `evaluate` for range input value
- Added `profileSmoothing` to persisted setting keys

### Minor
- Updated DEM screenshot baselines

## Test Results

| Suite | Pass | Fail |
|-------|------|------|
| Unit (vitest) | 83 | 0 |
| E2E (playwright) | 51 | 0 |

All tests pass, including the 3 DEM rendering tests that were previously timing out.

## Commits

1. `f07a2e8` — fix: visibility toggle sync, opacity slider drag, persist profileSmoothing
2. `c01d5aa` — feat: 3D terrain standalone button with cube SVG, un-tilt on disable
3. `f85e24e` — feat: move layer-related settings into Layers panel, swap positions
4. `214532a` — feat: middle-ellipsis for long track names with tooltip
5. `be7ed66` — fix: DEM rendering tests, persist test adapted to new UI
