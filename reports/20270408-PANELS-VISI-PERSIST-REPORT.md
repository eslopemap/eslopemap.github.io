# Panels, Visibility, and Persistence Fixes

## Overview
Implemented the fixes as requested in the 20270408 prompt regarding panel visibility, layout, drag-and-drop issues, and layer persistence.

## Changes Made
1. **Layer Visibility:** Modified `layer-engine.js` so that when layers (basemaps or overlays) are added to the active state, their `hidden` flag in `state.layerSettings` is explicitly removed, ensuring they are visible immediately.
2. **Default Panels:** Edited `index.html` to collapse the settings controls panel by default and expand the `layer-order-panel`, and set the appropriate toggle button states.
3. **Profile Panel Autoload:** Set `profileClosed` to `true` by default in `tracks.js`. This prevents `updateProfileFn` from popping open the profile panel when restoring a previously active track during initialization.
4. **Drag-and-Drop Constraints:** Updated `io.js` to attach the `dragenter`, `dragleave`, `dragover`, and `drop` event listeners to `#map` instead of `document`. Also added defensive checks to only trigger on `Files` types. This prevents UI elements like opacity sliders or draggable layer rows from accidentally triggering the global import overlay.
5. **Custom Layer Persistence:** Exported `saveUserSources` and `loadUserSources` in `persist.js`. Wired `layer-registry.js` to persist to localStorage whenever user sources are added or removed. Finally, invoked `loadUserSources` in `main.js` on app initialization to restore these layers to the catalog.

## Next Steps
All tasks completed. Ready for commit.
