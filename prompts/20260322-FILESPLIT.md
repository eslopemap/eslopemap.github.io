# FUTURE — Maintenance & Evolution Strategy

## Current state assessment

The app is a single ~3 700-line HTML file with inline CSS and JavaScript. This zero-build approach keeps deployment trivial (push to a Gist, serve from any static host) but the file is reaching the point where navigation, testing, and parallel development become painful:

- **State management** is spread across a plain `state` object, several global `let` variables (`activeTrackId`, `editingTrackId`, `drawMode`, etc.), and MapLibre global-state properties. They get out of sync easily.
- **Track editing** now has three overlapping modes (select / edit / draw) managed by ad-hoc conditionals rather than a formal state machine.
- **Event wiring** is monolithic: there is a single `map.on('click')` handler with nested conditionals for draw-mode, insert-hover, modifier-delete, and mobile-select.
- **No tests.** Every change is verified manually in the browser.

The app is still maintainable because everything is collocated and dependencies are minimal. But each new feature (session storage, GPX waypoints, multi-segment routing, etc.) will compound the complexity.

## Recommended strategy

### 1. Keep zero-build — use ES modules from CDNs

Modern browsers load `<script type="module">` natively. Replace the classic `<script>` tags with:

```html
<script type="importmap">
{
  "imports": {
    "maplibre-gl": "https://esm.sh/maplibre-gl@5",
    "chart.js": "https://esm.sh/chart.js@4",
    "chartjs-plugin-annotation": "https://esm.sh/chartjs-plugin-annotation@3",
    "maplibre-contour": "https://esm.sh/maplibre-contour@0.0.5"
  }
}
</script>
<script type="module" src="main.js"></script>
```

This keeps the zero-build experience (no bundler, just files served statically) while enabling multi-file code splitting.

### 2. Split into focused modules

Suggested file structure:

```
slope.html          — shell markup only
css/
  main.css
js/
  main.js           — entry point: create map, wire top-level events
  state.js          — reactive state store (see below)
  dem.js            — DEM tile logic, hybrid border layer, elevation sampling
  tracks.js         — track CRUD, GeoJSON generation, import/export
  track-editor.js   — draw / edit / select state machine, vertex interaction
  profile.js        — Chart.js profile panel
  ui.js             — settings panel, legend, search, cursor tooltip
  utils.js          — haversine, Terrarium encode/decode, helpers
```

### 3. Introduce a tiny reactive state store

A 30-line reactive store (`state.js`) using `Proxy` or explicit getters eliminates manual `syncFoo()` calls:

```js
export function createStore(initial, onChange) {
  return new Proxy(initial, {
    set(target, key, value) {
      const old = target[key];
      target[key] = value;
      if (old !== value) onChange(key, value, old);
      return true;
    }
  });
}
```

Side effects (repaint, URL sync, UI updates) are driven from a single `onChange` dispatcher instead of being scattered after every `state.foo = …`.

### 4. Formalize the track-editing state machine

Replace the three booleans with an explicit finite-state machine:

```
IDLE → SELECT (click track) → EDIT (click ✎) → IDLE (Escape)
IDLE → DRAW (click ✏) → IDLE (dbl-click / Escape)
```

Each state defines which interactions are active (vertex drag, hover-insert, mobile move, etc.). This prevents the "if drawMode && !editingTrackId && …" conditional chains.

### 5. Session / local storage

Persist tracks and UI preferences in `localStorage`:

```js
// On every track mutation:
localStorage.setItem('slope:tracks', JSON.stringify(tracks.map(t => ({
  name: t.name, color: t.color, coords: t.coords
}))));

// On startup:
const saved = JSON.parse(localStorage.getItem('slope:tracks') || '[]');
for (const s of saved) createTrack(s.name, s.coords, s.color);
```

Also persist settings (basemap, mode, opacity, cursorInfoMode, etc.) so the user returns to their last configuration.

### 6. Feature roadmap

| Feature | Effort | Notes |
|---|---|---|
| **localStorage persistence** | Small | Save/restore tracks + settings (see above) |
| **GPX waypoints** | Small | Add `<wpt>` parsing; render as symbol layer with label |
| **Named tracks** | Small | Right-click track name → rename |
| **Undo/redo stack** | Medium | Replace ad-hoc `coords.pop()` with a command stack (push/splice/move commands) |
| **GPX time support** | Medium | Parse `<time>` elements; compute speed; show on profile |
| **Route planning** | Large | Use OSRM/Valhalla/BRouter for auto-routing between waypoints; needs external API |
| **Offline tiles** | Large | Service worker + IndexedDB tile cache for DEM and basemap |
| **Multi-user sharing** | Large | Share via URL-encoded compressed track data or a lightweight backend |

### 7. Useful libraries (no build step)

- **[Turf.js](https://turfjs.org/)** (`esm.sh/turf`) — spatial analysis, line slicing, point-on-line, buffer, etc. Replaces hand-rolled haversine and closest-point-on-segment.
- **[toGeoJSON](https://github.com/mapbox/togeojson)** (`esm.sh/@mapbox/togeojson`) — robust GPX/KML/TCX parser, handles edge cases.
- **[FileSaver.js](https://github.com/nicolo-ribaudo/FileSaver.js)** — cross-browser file save (current `downloadFile` is fine for modern browsers).
- **[Preact](https://preactjs.com/)** (`esm.sh/preact`) — if the UI grows complex enough to justify a component model. 3 KB, JSX-free `htm` tagged template alternative available.
- **[nanostores](https://github.com/nanostores/nanostores)** (`esm.sh/nanostores`) — tiny reactive state (300 bytes) that works without a framework.

### 8. Testing

Even without a build step, you can test with:

```bash
npx vitest --config vitest.config.js
```

Extract pure functions (haversine, Terrarium encode/decode, GPX parse, closest-point-on-segment) into importable modules and unit-test them. Integration tests can use Playwright to load the HTML and verify map interactions.
