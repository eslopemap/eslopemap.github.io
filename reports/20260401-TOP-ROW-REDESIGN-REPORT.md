# Top Row Redesign Report

## Summary

Implemented the plan from `plans/20260401-PLAN-TOP-ROW.md` to redesign the top row controls as a full-width responsive flex bar with unified panel toggle buttons.

## Changes

### HTML (`app/index.html`)
- Removed `#toolbar` and standalone `#edit-rail`
- Created `#controls-wrapper` with 3 zones: `#bar-left`, `#bar-center`, `#bar-right`
- `#bar-left`: `#panel-toggles` (Settings, Profile, Tracks buttons) + `#help-link` + `#search-box`
- `#bar-center`: edit (✎) and rect-select (⬚) buttons (formerly `#edit-rail`)
- `#bar-right`: `#track-tool-row` (formerly inside `#track-panel-shell`)
- `#profile-toggle-btn` and `#tracks-btn` moved from `#track-tool-row` to `#panel-toggles`
- `#controls` and `#track-panel-shell` now standalone positioned elements outside the wrapper

### CSS (`app/css/main.css`)
- `#controls-wrapper`: `position: absolute; top:0; left:0; right:0; display:flex; pointer-events:none`
- Children get `pointer-events: auto` to allow interaction through the full-width bar
- `.panel-toggle-btn`: unified button style with active state (`#4a90d9` blue)
- `#controls`: `position: absolute; top: 46px; left: 10px` (below bar)
- `#track-panel-shell`: `top: 46px; right: 10px` (below bar)
- Mobile `@media (max-width: 640px)`: bar moves to bottom, labels hidden, search/help hidden
- On mobile, panels stay at top (not repositioned to bottom) to avoid blocking map taps

### JS (`app/js/main.js`)
- `syncControlsToggleLabel()`: toggles `.active` class instead of changing text content

### JS (`app/js/tracks.js`)
- `syncTrackPanelShell()`: no longer reparents `trackToolRow` between shell and header
- Removed `trackPanelHeader` DOM ref (no longer needed)
- `tracksBtn` active state via class toggle only (no text change to ×)

## Test Results
- **44/44 e2e tests pass** (Playwright)
- **37/37 unit tests pass** (Vitest)

## Issues Encountered
- Mobile test regression: `#controls` panel (settings) at fixed bottom position overlapped tap area on mobile viewport (390×844). Fixed by keeping panels at top-left/top-right on mobile.
- `pointer-events: none` on `#controls-wrapper` correctly allows map interaction through gaps while children remain clickable.

## Before / After
- Before: `/tmp/before-top-row.png`
- After: `/tmp/after-top-row-final.png`
