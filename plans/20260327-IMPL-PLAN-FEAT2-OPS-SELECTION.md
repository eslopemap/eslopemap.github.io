# Implementation Plan — FEAT2 Operations, Simplify, Selection

## Goal

Deliver the Phase 2 operation layer described in [20260326-FEAT.md](/Users/eoubrayrie/code/MAPS/slopedothtml/prompts/20260326-FEAT.md):

- route to track conversion
- simplify with terrain/elevation guardrails
- split / merge
- densify (`Add intermediate points`)
- rectangle selection with action-bar reuse

This plan assumes the FEAT1 tree/action foundation already exists.

## Scope

In scope:

- build normalized track tool contract
- implement selection span resolution
- add operation execution and previews
- integrate rectangle selection with existing action bar
- wire profile filtering to the selected span

Out of scope:

- advanced pause cleanup execution
- export compatibility profile completion
- final profile metrics block and pause-aware derived curves from Phase 3

## Core design rule

All geometry tools must work through one unified interface.

Reference shape:

```text
tool(track, selectionSpan, startIdx, endIdx, options)
```

Definitions:

- `track`: source track object
- `selectionSpan`: derived summary of the current working span
- `startIdx`, `endIdx`: inclusive source indices
- `options`: tool-specific settings

This same contract must support:

- full track
- one segment
- selected continuous subrange
- rectangle-derived enclosing span

## Files to add

- `js/track-ops.js`
- `js/selection-tools.js`

## Files to modify

- `index.html`
- `css/main.css`
- `js/main.js`
- `js/tracks.js`
- `js/track-edit.js`
- `js/profile.js`
- `js/utils.js`
- `slope.md`

## Work breakdown

### 1. Create normalized operation layer

Create `js/track-ops.js`.

Responsibilities:

- define operation entry points
- validate target span
- compute previews
- return mutations in a normalized form
- keep actual geometry logic separate from UI widgets

Recommended exports:

- `buildSelectionSpan(track, startIdx, endIdx)`
- `convertRouteToTrack(...)`
- `simplifyTrackSpan(...)`
- `splitTrackSpan(...)`
- `mergeTrackSpans(...)`
- `densifyTrackSpan(...)`
- `describeOperationConsequence(...)`

### 2. Implement simplify with guardrails

Default algorithm:

- Visvalingam-Whyatt

Advanced option:

- Douglas-Peucker

Required guardrails:

- preserve first and last point
- preserve protected local elevation extrema
- enforce post-simplification max gap: no adjacent surviving points farther apart than `15 * horizontalTolerance`
- preserve segment boundaries
- never simplify across pause-created segment boundaries

Implementation recommendation:

- precompute `protectedPointFlags` for extrema veto
- during candidate deletion, compute the retained-neighbor spacing and veto if it exceeds the max-gap threshold
- keep Douglas-Peucker behind advanced mode and document that its guardrail mapping is approximate compared with the default algorithm

Preview requirements:

- before/after point count
- maximum retained gap after simplification
- count of protected extrema retained

### 3. Implement route to track

Rules:

- preserve metadata fields available in route
- convert one route to one track with one segment
- keep original route by default
- support `convert and replace`

Need consequence messaging for popup/hints:

- `create sibling track from route`
- `replace route with track`

### 4. Implement split / merge

Split variants in FEAT2:

- split at current selected point
- split at current selected span boundaries
- split selected span into separate track versus separate segment

Merge variants in FEAT2:

- merge selected sibling tracks as segments
- merge selected sibling segments into one segment

Validation:

- same-file restriction in V1
- endpoint gap warning
- explicit reverse action only, never silent reversal

### 5. Implement densify

User-facing label:

- `Add intermediate points`

Rules:

- max 5 m horizontal gap
- preserve endpoints
- linear interpolation for elevation and time when available
- operate through the same tool contract on either full track or selected span

### 6. Implement rectangle selection

Create `js/selection-tools.js`.

Responsibilities:

- enter and exit rectangle mode
- capture drag rectangle on desktop and touch
- resolve hit points to source indices
- compute smallest enclosing continuous span
- publish selection context to the action bar and profile

Do not build a second toolbar.

Required UI behavior:

- reuse existing action bar
- eligible actions turn bright blue in selection context
- unrelated actions dim or disable
- anchored hint popup stays informational only
- `Esc` clears selection context

Anchored hint popup contents:

- selected point count
- source track or segment label
- span range or distance
- consequence preview for hovered/focused action

### 7. Wire profile filtering

Modify `js/profile.js`.

Requirements:

- when rectangle selection exists, profile shows smallest enclosing continuous span
- clear visual label that profile is filtered
- one-click reset to full track
- use the same `selectionSpan` object as the operation layer

At FEAT2 stage, it is enough to filter the visible profile data and legend context. The richer stats block can remain Phase 3 if not already implemented.

### 8. Hook actions into bar and context menu

Modify `js/main.js`, `js/tracks.js`, and any FEAT1 action shell.

Action sources:

- tree context menu
- action bar buttons
- shortcuts
- rectangle selection context

All sources should dispatch into the same operation layer.

### 9. Update docs

Modify `slope.md`.

Document:

- route to track
- simplify modes and guardrails
- densify
- split / merge
- rectangle selection and selection-context action bar

## Suggested implementation order

1. `track-ops.js` contract and helper span builder
2. densify
3. route to track
4. simplify preview + execution
5. split / merge basics
6. `selection-tools.js`
7. action-bar reuse wiring
8. profile filtering
9. docs update

## Testing checklist

Manual:

- simplify with low and high tolerances on noisy GPS traces
- verify protected summits/valleys are retained
- verify no surviving gap exceeds `15 * horizontalTolerance`
- densify creates no segment gap above 5 m
- rectangle selection highlights action bar and does not create second toolbar
- profile switches to enclosing span and resets cleanly
- split from selection span behaves predictably when selection is discontinuous

E2E candidates:

- rectangle selection enables action-bar selection context
- simplify reduces point count but preserves first and last points
- `Add intermediate points` reduces maximum gap below threshold
- route converts to sibling track

Unit-test candidates:

- `buildSelectionSpan()`
- simplify guardrail vetoes
- max-gap enforcement
- densify interpolation
- selected-span consequence descriptions

## Risks

- trying to combine full-track, segment, and selected-span editing without a clean normalized contract will produce duplicated code paths fast
- simplify guardrails can interact in non-obvious ways; preview and post-condition checks are mandatory
- rectangle selection on touch can conflict with map pan, so a dedicated explicit mode is still required even if the action bar is reused

## Commit slices

Recommended commit sequence once code work starts:

1. `Add normalized track operation layer`
2. `Implement route conversion and densify operations`
3. `Add guarded track simplification`
4. `Implement split merge operations for selected spans`
5. `Add rectangle selection with action-bar reuse`
6. `Filter profile by active selection span`
7. `Update slope.md for track operations and selection workflow`