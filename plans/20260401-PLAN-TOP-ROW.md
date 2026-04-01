# Plan: Top Row Controls Wrapper & Panel Toggle UX

## Goal

Consolidate the top row widgets (settings toggle, search, edit rail, track toolbar) into a single responsive `#controls-wrapper` with different layouts for desktop and mobile. Make the 3 panel toggle buttons (settings, profile, tracks) consistent and self-evident.

---

## Current State

```text
DESKTOP:
┌─────────────────────────────────────────────────────────────────────────────┐
│ [⚙ Settings ▾] [Help] [🔍]          (gap)          [track-tool-row] [📍]  │
│ ┌──────────────┐                               ┌──────────────────────┐    │
│ │ Settings     │                               │    Track panel       │    │
│ │ panel        │                               │                      │    │
│ └──────────────┘                               └──────────────────────┘    │
│                                                                            │
│ [✎] ← edit-rail (left, vertically centered)                               │
│ [⬚]                                                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

### Current elements and their containers

| Element | Current container | Position |
|---|---|---|
| `#settings-controls-toggle` | `#toolbar` inside `#controls-wrapper` | top-left |
| `#help-link` | `#toolbar` inside `#controls-wrapper` | top-left, after settings |
| `#search-box` | `#toolbar` inside `#controls-wrapper` | top-left, after help |
| `#controls` (settings panel) | `#controls-wrapper` | below toolbar, left |
| `#edit-rail` | standalone `div` | left, vertically centered |
| `#track-tool-row` | `#track-panel-shell` | top-right |
| `#track-panel` | `#track-panel-shell` | below track-tool-row, right |

### 3 Panel toggle buttons (current)

| Button | Panel | Current placement | Icon | Label |
|---|---|---|---|---|
| `#settings-controls-toggle` | `#controls` | top-left toolbar | 🌍 | "Settings ▾" |
| `#profile-toggle-btn` | `#profile-panel` | inside `#track-tool-row` | 📈 | none |
| `#tracks-btn` | `#track-panel` | inside `#track-tool-row` | 📍 | none |

---

## Phase 1: Unify Panel Toggle Buttons

### UX principle
The 3 panel toggles should be **visually grouped, consistently styled, and clearly labeled** to indicate their function. They toggle side/bottom panels.

### Design

- Extract the 3 toggle buttons from their current locations into a **toggle group** `<div id="panel-toggles">` placed at the **left** of the top bar (desktop) or in the **bottom nav bar** (mobile).
- Uniform style: `.panel-toggle-btn` class with:
  - Icon + text label (desktop: always visible; mobile: icon-only on narrow, labels appear on wider screens)
  - Active state = filled accent color (existing `.active` pattern: `#4a90d9`)
  - Consistent size and spacing
- Order: **Settings** | **Profile** | **Tracks**
- `#settings-controls-toggle` becomes a `.panel-toggle-btn` and loses the "▾" chevron.
- `#profile-toggle-btn` and `#tracks-btn` get text labels on desktop: "Profile", "Tracks".
- The `#help-link` stays in the top bar, to the right of the toggle group.

### HTML changes
```html
<!-- Inside #controls-wrapper, new first child: -->
<div id="panel-toggles">
  <button id="settings-controls-toggle" class="panel-toggle-btn" title="Settings">🌍 <span class="btn-label">Settings</span></button>
  <button id="profile-toggle-btn" class="panel-toggle-btn" title="Elevation profile" disabled>📈 <span class="btn-label">Profile</span></button>
  <button id="tracks-btn" class="panel-toggle-btn" title="Track list" disabled>📍 <span class="btn-label">Tracks</span></button>
</div>
```

### CSS
```css
#panel-toggles {
  display: flex;
  gap: 4px;
}
.panel-toggle-btn {
  /* Same as existing .tb-btn but with text label support */
  background: rgba(255,255,255,0.94);
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.25);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
}
.panel-toggle-btn.active {
  background: #4a90d9;
  color: #fff;
}
```

### JS changes
- `#profile-toggle-btn` and `#tracks-btn` are **moved out** of `#track-tool-row` into `#panel-toggles`.
- Their event listeners remain the same, just the DOM location changes.
- `syncControlsToggleLabel` updated to just toggle `.active` class instead of changing text content.

---

## Phase 2: Responsive `#controls-wrapper` Layout

### Desktop layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Settings] [Profile] [Tracks] [Help] [🔍]    [✎ ⬚]    [+ 🔗 📄 📁 ⚙ ⋮ ▣…] │
│  ← panel-toggles →  ← bar-left →    ← center → ← bar-right (track tools) →│
└──────────────────────────────────────────────────────────────────────────────┘
```

- `#controls-wrapper` becomes a **full-width** absolute bar at the top.
- Uses `display: flex; justify-content: space-between` with 3 zones:
  - **Left**: `#panel-toggles` + `#help-link` + `#search-box`
  - **Center**: `#edit-rail` (moved from standalone to inside wrapper)
  - **Right**: `#track-tool-row` (minus the 3 extracted toggle buttons)
- When viewport narrows, `justify-content: space-between` collapses center naturally.
- The settings panel `#controls` stays positioned **below** the left side of the bar (unchanged anchoring, just below `#controls-wrapper`).
- The track panel `#track-panel` stays positioned **below** the right side of the bar.

### CSS structure
```css
#controls-wrapper {
  position: absolute;
  top: 0; left: 0; right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  gap: 8px;
  pointer-events: none;       /* let map clicks through */
}
#controls-wrapper > * {
  pointer-events: auto;       /* but children capture events */
}

#bar-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

#bar-center {
  display: flex;
  align-items: center;
  gap: 6px;
}

#bar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
```

### Track panel illusion
The track panel currently lives inside `#track-panel-shell` which has a `.panel-surface` class applied when visible, making the track-tool-row appear to be inside the panel. After moving track-tool-row into the top bar:

- `#track-panel-shell` no longer contains `#track-tool-row`.
- When `#track-panel` is visible, `#track-panel-shell` positions itself at `top: <bar-height>px; right: 10px` with enough width to **visually overlap** behind the right end of the bar, creating the illusion that the track tools are part of the panel.
- The `#track-panel-shell.visible` adds `.panel-surface` as before, but `#track-tool-row` stays in the bar.

---

### Mobile layout (bottom nav bar)

```text
┌──────────────────────────────────────────────────────────────────┐
│                         MAP CANVAS                               │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ [🌍] [📈] [📍]  [+] [📄] [🔗] [📁] [✎] [⋮]  ← bottom nav bar │
└──────────────────────────────────────────────────────────────────┘
│                      [Profile panel]                             │
└──────────────────────────────────────────────────────────────────┘
```

- Triggered by `@media (max-width: 640px)` or `(pointer: coarse)` — same breakpoint as existing mobile behavior.
- `#controls-wrapper` moves to `bottom: 0; left: 0; right: 0` (before profile panel).
- Becomes a horizontal scrollable bar: `overflow-x: auto; -webkit-overflow-scrolling: touch`.
- Panel toggle labels hidden (`span.btn-label { display: none }`). Settings button shows only 🌍 (no text).
- `#search-box` and `#help-link` hidden on mobile (search accessible via a button or collapsed).
- `#controls` (settings panel) opens **upward** from the bottom bar.
- `#track-panel` opens **upward** from the bottom bar.
- Profile panel pushes everything up.
- Max button bar height: same as current toolbar (~36px).

### CSS for mobile
```css
@media (max-width: 640px) {
  #controls-wrapper {
    top: auto;
    bottom: var(--bottom-overlay-bottom);
    padding: 6px 10px;
    justify-content: center;
  }
  .btn-label { display: none; }
  #help-link { display: none; }
  #search-box { display: none; }

  #controls {
    position: absolute;
    bottom: 100%;
    left: 0;
    max-height: 60vh;
  }

  #track-panel-shell {
    position: absolute;
    bottom: 100%;
    right: 0;
  }
}
```

---

## Phase 3: Cleanup & Polish

### Items
1. Update `UI.md` with new layout diagram
2. Update e2e tests if any selectors change (panel-toggles IDs stay the same, so minimal)
3. Ensure keyboard shortcuts still work (E for edit, R for rectangle select, etc.)
4. Verify profile panel interaction: profile toggle in the bar, profile panel at bottom — no layout conflict
5. Test that map drag-to-collapse-settings still works (collapse on `map.dragstart`)

---

## Implementation Order

1. **Extract toggle buttons** into `#panel-toggles` div (HTML + CSS + JS wiring)
2. **Move `#edit-rail`** into `#controls-wrapper` center zone
3. **Move `#track-tool-row`** into `#controls-wrapper` right zone
4. **Restyle `#controls-wrapper`** as full-width flex bar (desktop)
5. **Adjust panel positioning** — `#controls` drops below left, `#track-panel-shell` drops below right
6. **Mobile layout** — media query for bottom nav bar
7. **Polish** — transitions, hover states, active states consistency
8. **Update docs** — `UI.md`, `FEATURES.md`
9. **Update tests** — verify selectors, add responsive tests if needed

---

## Files to modify

| File | Changes |
|---|---|
| `app/index.html` | Restructure `#controls-wrapper`, add `#panel-toggles`, `#bar-left`, `#bar-center`, `#bar-right`; move `#edit-rail` inside; move `#track-tool-row` inside |
| `app/css/main.css` | New flex layout for `#controls-wrapper`, panel toggle styles, mobile media query, adjusted panel positioning |
| `app/js/main.js` | Update `syncControlsToggleLabel`, adjust references to moved elements |
| `app/js/tracks.js` | Update `syncTrackPanelShell` — track-tool-row no longer moves between parents |
| `UI.md` | New ASCII layout diagram |
| `tests/e2e/*.spec.js` | Verify and fix any broken selectors |

---

## Constraints

- **Keep height small**: the top bar should be a single row of buttons, no taller than current toolbar (~36px)
- **No new dependencies**: pure CSS flexbox layout
- **Backward compatible**: all existing functionality preserved
- **Progressive**: mobile layout degrades gracefully
