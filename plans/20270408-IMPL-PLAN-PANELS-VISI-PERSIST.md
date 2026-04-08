# Implementation Plan: Panels, Visibility, Persist

1. **Adding a layer should always make it visible**
   - **File:** `app/js/layer-engine.js`
   - **Action:** In `setOverlay` and `setBasemapStack`, when a layer is activated, force the `hidden` flag to `false` in `state.layerSettings`.

2. **Default panel on page load should be layers and not settings**
   - **File:** `app/index.html`
   - **Action:** Add `collapsed` class to `<div id="controls">`. Add `visible` class to `<div id="layer-order-panel">`.
   - **Action:** Set `layer-order-toggle` button to `active`.

3. **Do not open the Profile panel on page load even if a track was selected**
   - **File:** `app/js/tracks.js`
   - **Action:** Change `let profileClosed = false;` to `let profileClosed = true;` so that any `updateProfile()` call triggered automatically during initialization immediately closes the panel.

4. **Restrict global drag-and-drop to the map component, preventing slider drag activation**
   - **File:** `app/js/io.js`
   - **Action:** In `dragenter`, ensure `e.dataTransfer.types.includes('Files')` is checked to prevent internal UI dragging from showing the drop overlay.
   - **Action:** Change `document.addEventListener` for drag/drop to target `document.getElementById('map')` so it doesn't trigger when dragging over UI panels.

5. **Save custom layers to get them back upon app restart**
   - **File:** `app/js/persist.js`
   - **Action:** Export `saveUserSources` and `loadUserSources` functions backed by `localStorage` (key: `slope:user-sources`).
   - **File:** `app/js/layer-registry.js`
   - **Action:** Call `saveUserSources` inside `registerUserSource`, `unregisterUserSource`, and `clearUserSources`.
   - **File:** `app/js/main.js`
   - **Action:** Call `loadUserSources()` during initialization and iterate the saved sources via `registerUserSource()`.
