## Create a track

Select `+` to create a new track. Each click on the map adds a vertex. Press `Escape` or double-click to finish the line.

When a new track is finished, Slope Mapper opens the info editor so you can name it before continuing.

## Enter edit mode for an existing track

Select a track in the workspace panel, then use the left rail edit button to switch from selection into editing. The active track keeps its profile and summary stats while the vertices become interactive.

![Workspace panel with an imported track and the edit controls available.](./assets/workspace-panel.png)

*The workspace panel shows file, track, and route hierarchy. The active track can then be moved into edit mode.*

## Move, insert, or delete vertices

While editing, you can:

- drag an existing vertex to reposition it,
- click a vertex to select it,
- use the small `+` popup near the selected vertex to insert the next point after it,
- delete a vertex with modifier-click or with `Delete` and `Backspace`.

Desktop and mobile editing behave differently by design. On mobile, Slope Mapper prefers center-crosshair editing so you can pan the map to position a selected point precisely.

![Track edit mode with the line selected for editing.](./assets/edit-mode.png)

*Edit mode exposes the line geometry directly on the map so points can be refined in place.*

## Use selection-based tools

Rectangle selection is useful when you want to operate on a continuous span instead of the entire track. After selecting a span, the relevant tools become active.

Available operations include:

- `Add intermediate points`
- `Simplify`
- `Split`
- `Merge`
- `Convert route to track`

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `N` | Create a new track |
| `E` | Edit the active track |
| `R` | Toggle rectangle selection |
| `Esc` | Finish drawing, stop editing, or clear the current selection |
| `Ctrl/Cmd+P` | Toggle the profile |
| `Ctrl/Cmd+L` | Toggle the workspace panel |
| `Ctrl/Cmd+I` | Open the info editor for the active item |
| `Ctrl/Cmd+Z` | Undo the last geometry change |

## Tips for stable editing

- Keep one track active while editing to avoid applying geometry operations to the wrong item.
- Use undo before leaving edit mode if a move or delete looks wrong.
- Open the profile while editing if you want terrain context for the currently selected line.
