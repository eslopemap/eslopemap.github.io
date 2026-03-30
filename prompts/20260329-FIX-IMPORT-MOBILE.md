* the import logic is broken : when I import a gpx file with multiple tracks and segments, right now it is split into files in the track list, whereas the structure built should mirror the file, enough to round-trip on export. unit-test the round trip of multi-track + multi-segment, for a simple enough well-crafted gpx, the round-trip import>export should be semantically identical.
* in track panel, track list has wrong css ? when i scroll the track list, its content goes behind the panel header and it should not. this should be unit-tested againsta regressions.
* mobile editing: 
  - there was supposed to be a way to move a point. selecting the point works (as the '+' icon appears for insert-in-the-middle), but touch-dragging the display does not move the point accordingly .
  - we have this thing where I tap and a new point is added at the location in the middle of the screen. it works for normal insert (at the end) but not for insert-in-the-middle functionality. there the point is consistently added with an offset


* "The issue is clear: .track-panel-header is sticky but has background: transparent (inherited from parent). When content scrolls underneath, it shows through. The fix is to give it a background that matches the panel surface" -> no because there is a transparency + blur, so doing it twice is visually inconsistent. find a better technical solution.
* fill in the "Implementation report" section in the 20260329-FIX-IMPORT-MOBILE.md with important decisions made in this thread

then move on to those:
* selecting a file does not visually select all tracks (and segments?)
* clicking file/track/segment should always center it
* 'new track' button on the left is a dupe of the one in the top-right track-tool-row, double-check and remove it. same for undo

* on a close topic, there is the rectangle select and rectangel delete, provide product manager advice on how to unify the functionality

yes. use a red recycle bin icon, and make sure it is pushed to undo stack. it would be nice to have good  coverage of undo-stack, unit-tested if possible. also map it to the backspace key. then move this button to the top-right track-tool-row and remove the old edit-only rectangel delete button

then move on to:
* move 'mobile on desktop' localhost test mode to the advanced settings
* 'zoom to all' in the kebab menu does not encompass all tracks, only first one.
* implement keyboard nabigation in the track list (up down, right left to collapse, backspace to delete with ability to undo)

as usual make focused commits


# Implementation report

## Import round-trip fix
- **Removed `buildTreeFromLegacy`** from gpx-model.js — it was the only tree-building path and produced one file node per track, splitting multi-track GPX files into separate file entries.
- **New `onFileBatchImported(fileName, createdTracks, waypoints)`** in gpx-tree.js creates a single file node per imported GPX file, with track/segment/route children mirroring the original GPX structure. This is called from io.js after all tracks from a file are created with `skipTreeHook: true`.
- **`buildWorkspaceFromTracks`** (private to gpx-tree.js) replaces the old function for persistence restore and orphan handling in `restoreWorkspace`.
- **Export path already worked** — `buildPayloadFromNode` traverses file → track → segments and produces multi-segment `<trk>` elements. The fix was purely on the import/tree-building side.
- **Exported `buildGpxDocument` and `buildPayloadFromNode`** from io.js for unit testing. 4 round-trip tests verify multi-track/segment structure, timestamps, ordering, and XML escaping.

## CSS scroll fix
- moved `max-height: 50vh; overflow-y: auto` from `#track-panel` down to `#track-list`. This keeps the header outside the scroll container entirely — no sticky positioning needed, no background/blur duplication.

## Mobile editing fixes
- **Vertex drag cancelled immediately**: `map.on('touchend')` fired right after the click that set `mobileSelectedVertex`, calling `cancelMobileMove()`. Fixed by adding a `suppressMobileTouchEnd` flag set on selection, cleared on the next touchend.
- **Insert-in-middle offset**: When tapping a vertex in mobileFriendlyMode, the vertex enters drag-to-move mode and its position follows `map.getCenter()`. If the user then taps "+" for insert-after, the vertex has been moved from its original position, causing geometry distortion. Fixed by calling `popUndo()` in the "+" handler to restore original vertex position before entering insert mode.
- **Vertex selection redesign**: In mobileFriendlyMode, tapping the same vertex now deselects it. Tapping a different vertex switches selection.

## Tree interaction improvements
- **File/track node click centers map**: Added `collectDescendantTrackIds(node)` helper and `fitToTrackIds(ids)` in tracks.js. Clicking any tree node fits the map to the combined bounds of all its descendant tracks.
- **Visual selection propagation**: `syncTreeSelection()` now collects all descendant node IDs of the selected node and adds a `child-selected` CSS class (lighter highlight) to their tree rows.

## Duplicate button removal
- Removed `rail-new-btn` (+) and `rail-undo-btn` (↩) from the left edit rail — they were pure delegators to `draw-btn` and `undo-btn` in the track-tool-row. Updated keyboard shortcut 'N' to target `draw-btn` directly.

## PM advice: Rectangle Select vs Rectangle Delete unification

Currently there are two separate rectangle-drag features:
1. **Rectangle Delete** (in track-edit.js, `rect-delete-btn` ⬚): available during editing, draws a rectangle and deletes all track points inside it. Immediate destructive action.
2. **Rectangle Selection** (in selection-tools.js, `selection-mode-btn` ▣): available when a track is active, selects a span of points and shows a popup with simplify/densify/split actions.

**Recommendation: merge into a single "Rectangle Select" tool** that selects points, then offers actions including delete. Rationale:
- Two visually identical interactions (draw a rectangle on the map) with different outcomes is confusing.
- Rectangle Delete is destructive without preview — users don't see what they're about to delete.
- The selection popup already supports contextual actions and can easily add "Delete" as one of them.
- One button instead of two reduces toolbar clutter and cognitive load.

**Proposed unified flow:**
1. Single "Rectangle Select" mode (R shortcut, one button).
2. Drag a rectangle → points inside are highlighted.
3. Popup shows: point count, distance, and action buttons: **✂ Split**, **≈ Simplify**, **＋ Densify**, **🗑 Delete**.
4. Delete action shows a brief "X points will be deleted" confirmation on mobile, immediate on desktop (matching current rect-delete behavior).
5. Pressing Escape or clicking outside clears the selection.

This eliminates the `rect-delete-btn` entirely, keeps the `selection-mode-btn`, and adds delete as a selection action in `selection-tools.js`.

