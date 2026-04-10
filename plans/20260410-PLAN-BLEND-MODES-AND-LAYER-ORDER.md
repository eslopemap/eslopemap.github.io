# Blend Modes and Full Layer Ordering Plan

## Goals

1. Decide when raster overlays should use `blend: 'multiply'` versus `blend: 'normal'`.
2. Define a minimal first implementation for surfacing multiply-blended layers in the debug panel with a small `×` marker.
3. Outline how to make the Layer Order panel represent the true effective stack, including system layers, and allow moving everything around.
4. Avoid premature code changes until the intended product behavior is explicit.

## Questions to Answer First

### Blend-mode product questions

- **Which overlays are semantically “ink on paper”?**
  - Typical examples: slope shading, hillshade-like masks, transparent analytical rasters, scanned overlays with meaningful dark features and transparent/light background.
  - These are often good candidates for `multiply`.

- **Which overlays are semantically “final colors” that should stay visually faithful?**
  - Typical examples: orthophotos, cartographic rasters with carefully authored colors, scanned maps meant to be read as-is, categorical hazard layers with exact color meaning.
  - These often need `normal`.

- **Do you want blend mode to be a catalog-authored default, or a user tweak?**
  - Catalog default means the author says: “this layer is usually best in multiply.”
  - User tweak means every layer starts the same and the user decides later.
  - Hybrid is likely best: catalog default + per-layer override in `layerSettings`.

- **Should multiply apply only to overlays, or also to stacked basemaps?**
  - My recommendation: start with overlays only.
  - Basemap blending is more complex because the primary basemap model already has its own opacity semantics and style-backed basemaps add edge cases.

- **Should system layers also expose blend mode?**
  - `_analysis`: probably yes eventually, because it behaves like an overlay.
  - `_hillshade`: maybe, but only if the visual result is intentional and tested.
  - `_contours`: likely no need at first; line/symbol/system-vector layers are less compelling for raster blend-mode UX.

### Layer ordering product questions

- **Do you want one unified stack that reflects the actual visual order of everything on the map?**
  - My recommendation: yes.
  - If the UI says “Layer order”, it should match the effective rendering order, not just a subset.

- **Can system layers move below basemaps?**
  - Likely no for some of them.
  - Example: `_analysis` probably should not go below an opaque basemap or it disappears.
  - You may need constraints rather than absolute free ordering.

- **Should the panel show layers that are currently invisible due to opacity/hidden state?**
  - My recommendation: yes, if active.
  - A hidden-but-active layer should remain in the order model.

- **Should non-active catalog layers appear in the order panel?**
  - My recommendation: no.
  - The panel should list only layers currently participating in the map state.

- **Should the order panel be authoritative for both z-order and visibility?**
  - My recommendation: yes.
  - Add Layer activates a layer; Layer Order owns visibility, opacity, blend, and order.

## Recommendation on `multiply` vs `normal`

### Use `multiply` when

- The raster is mostly light/white background with darker information drawn on top.
- You want the underlying basemap relief, labels, or terrain to remain readable.
- The raster is an analytical emphasis layer rather than a standalone map.
- The layer’s colors are intended to darken/ink the base rather than replace it.

Likely good candidates in your app:

- **Slope overlays** such as `pubmap-eslo-walps`
- Potentially some scanned slope steepness rasters
- Some hillshade-like or monochrome analytical overlays

### Use `normal` when

- The raster is intended to be read as its own final image.
- Exact colors matter and should not be altered by the basemap underneath.
- The layer includes large dark fills or saturated colors that become muddy under multiply.
- The raster is actually acting like a basemap, not an annotation/analysis overlay.

Likely good candidates in your app:

- **Bugianen** basemap
- Orthophotos
- Fully authored topo/cartographic basemaps
- Any raster where legend colors must remain exact

### Practical recommendation

Do **not** use `multiply` everywhere.

Instead:

- Add an optional catalog-level default, e.g. `blend: 'multiply' | 'normal'`
- Use it only for overlays where the authored intent is clear
- Keep `normal` as the safe default
- Persist user overrides in `state.layerSettings[catalogId].blend`

That gives you sensible defaults without forcing a global visual rule that will definitely be wrong for some layers.

## Proposed Blend-mode Model

### Catalog

Each relevant catalog entry, or each map layer inside an entry, may define a default blend intent.

Two possible shapes:

#### Option A — entry-level default

Use when all map layers inside the entry should share the same blend mode.

- **Pros**: simpler UI and persistence
- **Cons**: less precise for mixed multi-layer entries

#### Option B — layer-level default

Use when a single catalog entry contains layers that should blend differently.

- **Pros**: most accurate
- **Cons**: more complicated state/UI model

### Recommendation

Start with **entry-level blend defaults**.

Reason:

- your current Layer Order panel operates at catalog-entry granularity
- most raster overlays in question are single-layer entries
- it keeps persistence and UI comprehensible

## Candidate Initial Defaults

These are hypotheses, not implementation decisions yet:

- **`pubmap-eslo-walps`**: likely `multiply`
- **`ign-slopes`**: maybe `multiply`, if you want the basemap to stay readable under slope colors
- **`swisstopo-slope`**: maybe `multiply`, same reason
- **`ign-ski` / `swisstopo-ski`**: probably `normal` unless visual tests show multiply improves readability
- **`openskimap`**: not relevant in the same way because it is vector, not raster
- **basemaps**: keep `normal`

## The Right Product Questions for You

Before implementing blend defaults broadly, I would ask you:

1. **Which exact overlays should visually behave like annotations over a basemap rather than standalone maps?**
2. **For slope layers, is preserving underlying topo/labels more important than preserving the slope raster’s exact colors?**
3. **Do you want blend mode to be visible and editable in the Layer Order UI from day one, or only reflected in rendering at first?**
4. **Should bookmarks preserve user-chosen blend overrides?**
5. **Should Add Layer immediately use the catalog default blend, or should all new layers start in `normal` until the user changes them?**
6. **For system layers, do you want `_analysis` and `_hillshade` to participate in the same blend-mode model as overlays, or remain special-case?**

## Minimal First Implementation for Debug Panel `×`

You requested only this tiny code change for now.

### Desired behavior

In the settings debug panel listing map layers:

- show a small `×` marker for any layer whose effective blend mode is multiply
- no marker for normal layers

### Likely rule

For each rendered MapLibre layer row in the debug output:

- inspect either:
  - authored `paint['blend-mode']`, or
  - effective runtime blend setting after layer settings are applied
- append `×` in the textual metadata area

### Important implementation question

What should count as multiply?

- **Option 1**: only explicit `paint['blend-mode'] === 'multiply'`
- **Option 2**: also count layers whose catalog default resolves to multiply even if not user-overridden

Recommendation:

- Use **effective runtime value** if available.
- Fall back to authored paint when needed.

### Why this is safe as a first step

- tiny UI signal
- no change to state model required if blend is already in paint
- useful for debugging actual rendered behavior

## Full Layer Order for All Layers — Problem Statement

Today the Layer Order panel mixes two concepts:

- a user-facing logical list of active catalog entries
- a partial approximation of actual rendered order

System layers are still special-cased and not truly reorderable in the same model.

That leads to several issues:

- the panel is not a faithful view of the actual stack
- moving overlays does not fully express rendering precedence against system layers
- per-layer controls and actual map order can diverge conceptually

## Recommended Direction: One Unified Visual Stack

### Principle

The Layer Order panel should represent the **effective visual stack** of active layers, bottom to top.

That includes:

- active basemaps
- active overlays
- active/relevant system layers

### Represented items

Each row should be a “layer-order item” with at least:

- `catalogId`
- `kind`: `basemap | overlay | system`
- `visible`
- `opacity`
- `blend`
- `movable`
- optional constraints metadata

### Why not just use raw MapLibre layer IDs?

Because the current UX is at catalog-entry level, not per-MapLibre-layer level.

A good compromise is:

- **UI ordering unit** = catalog/system entry
- **rendering application** = move all MapLibre layers belonging to that entry together

That keeps the panel understandable while still matching real rendered order.

## Constraints for Full Reordering

Not every theoretical order should be allowed.

### Likely hard constraints

- `dem-loader` and app infrastructure layers remain internal and not user-draggable
- some analysis/system layers may need to stay above terrain/basemaps to remain visible
- text/label behavior may become confusing if certain layers move below opaque rasters

### Recommended approach

Use **constrained free ordering**:

- user can reorder all user-facing entries
- internal layers stay outside the model
- if needed, define per-entry constraints like:
  - `minGroup`
  - `maxGroup`
  - `mustStayAbove`
  - `mustStayBelow`

Start simpler if possible:

- allow all user-facing entries to move freely
- keep internal implementation layers excluded
- observe whether any layer becomes nonsensical when moved
- add constraints only where necessary

## Proposed Data Model for Unified Ordering

### State

Keep `state.layerOrder`, but redefine it more clearly:

- ordered list of all **active user-facing entries**, bottom to top
- includes system entries when active/relevant

Example:

```js
[
  'pubmap-bugianen',
  '_hillshade',
  'pubmap-eslo-walps',
  '_analysis',
  '_contours'
]
```

### Visibility rules

- inactive entries are absent from `state.layerOrder`
- hidden-but-active entries remain present in `state.layerOrder`
- visibility is controlled separately through state flags / `layerSettings.hidden`

### System-layer inclusion policy

Decide whether system layers are:

- always present in `layerOrder`, or
- present only when active/visible/relevant

Recommendation:

- `_hillshade`: present only when enabled
- `_analysis`: present when current mode renders it
- `_contours`: present when enabled

This makes the panel better reflect what the user actually sees.

## Rendering Strategy for Unified Ordering

### Step 1 — build ordered entry list

Create one derived ordered list of active user-facing entries.

### Step 2 — expand each entry to runtime MapLibre layer IDs

For each catalog/system entry:

- resolve all corresponding runtime layer IDs
- preserve intra-entry local order

### Step 3 — move the resulting groups in map order

Apply `map.moveLayer()` group-by-group below the correct anchor.

### Important note

System layers will need the same abstraction treatment as catalog entries:

- `_analysis` maps to one or more runtime layer IDs
- `_hillshade` maps to `dem-loader` or its effective user-facing layer
- `_contours` maps to contour line + label layers

Right now these are special-cased; for full reordering they should be represented as first-class reorderable groups.

## Implementation Outline

### Phase 1 — clarify semantics only

- Define which layers are reorderable user-facing groups
- Define which system layers participate
- Define whether blend is per-entry or per-runtime-layer

### Phase 2 — blend defaults

- Add optional catalog default blend metadata
- Add effective blend resolution order:
  1. `state.layerSettings[catalogId].blend`
  2. catalog default blend
  3. `'normal'`
- Apply blend consistently when entries are activated/restored

### Phase 3 — debug panel marker

- Update debug panel rendering to append `×` for effective multiply blend
- Ensure it reflects effective runtime state, not only catalog source data

### Phase 4 — unify system-layer ordering model

- Represent system layers as reorderable entry groups
- Provide `getRuntimeLayerIdsForEntry(catalogId)` for both catalog and system items
- Make `applyLayerOrder()` work on this unified abstraction

### Phase 5 — UI upgrade

- Render all active user-facing entries in one panel
- Allow drag-and-drop for system layers too
- Keep hidden layers in list
- Show blend and opacity controls consistently

### Phase 6 — persistence and bookmarks

- Persist blend overrides in `layerSettings`
- Persist unified `layerOrder`
- Ensure bookmarks restore system-layer order as well as overlay/basemap order

## Risks and Edge Cases

- **Multiply on colorful rasters can become muddy**
  - reason not to make it global

- **Some system layers may become invisible if moved below opaque basemaps**
  - may require constraints or warnings

- **Entry-level blend may be insufficient for multi-layer vector or mixed entries**
  - acceptable initial tradeoff

- **Debug panel can lie if it reads authored style instead of effective runtime state**
  - prefer effective resolved value where possible

## Recommended Next Decisions

I would make these decisions before coding:

1. **Initial list of raster overlays that should default to `multiply`**
2. **Whether `_analysis` and `_hillshade` should be reorderable user-facing entries**
3. **Whether system layers appear only when active or always**
4. **Whether user blend overrides belong in bookmarks immediately**
5. **Whether ordering constraints are needed from day one or can wait**

## My Recommendation Summary

- **Do not use `multiply` everywhere**.
- Use it as a **catalog-authored default** for selected raster overlays only.
- Keep **`normal`** for basemaps, orthos, and color-faithful cartographic rasters.
- Add the debug-panel `×` marker first as a tiny visibility aid.
- Move toward a **single unified active layer stack** in the Layer Order panel.
- Treat system layers as **first-class reorderable groups**, but be ready to add a few constraints if some combinations produce nonsense.
