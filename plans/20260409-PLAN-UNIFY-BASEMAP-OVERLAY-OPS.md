# Plan: Unify basemap stack and overlay operations

**Date:** 2026-04-09  
**Status:** Proposed  
**Scope:** Future refactor of JS layer state, map application helpers, persistence, bookmarks, and UI wiring.

## Problem Statement

The app still models map layers through two parallel concepts:
- `state.basemapStack` for background layers
- `state.activeOverlays` for foreground layers

and two parallel write paths:
- `setBasemapStack(map, state, ids)`
- `setOverlay(map, state, id, visible)`

This split now carries real cost:
- different persistence shapes for conceptually similar layer activation state,
- duplicate UI update logic,
- extra migration complexity in bookmarks and startup,
- harder reasoning about ordering, opacity, hidden state, and future custom tile roles.

The next step should treat user-visible map layers as a single ordered operational model while preserving the current rendering constraints (basemaps below DEM analysis, overlays above it, and at most one `styleUrl`-backed full-style basemap active at once).

## Goals

- Define one canonical app-level model for active catalog-backed layers.
- Replace separate basemap/overlay mutation APIs with one generalized operation path.
- Preserve current rendering semantics for DEM/system layers.
- Keep persistence and bookmark restore backward compatible.
- Reduce UI duplication between basemap and overlay controls.

## Non-Goals

- Replace the current UI in the same refactor.
- Remove special handling for DEM/system layers yet.
- Eliminate the `styleUrl` / `map.setStyle()` constraint.

## Current Constraints

### 1. Basemaps and overlays do not behave identically at render time
- Basemaps are inserted below `dem-loader`.
- Overlays are reordered by `applyLayerOrder` above DEM/system layers.
- `styleUrl` basemaps can trigger full style reload and rehydration.

### 2. State is already partly unified, but not operationally unified
- `layerOrder` already spans overlays plus virtual system entries.
- `layerSettings` already stores opacity/hidden state for both categories.
- `basemapStack` still remains a separate activation source of truth.

### 3. Persistence and bookmark compatibility matter
- Older saved settings may still contain legacy basemap/bookmark payloads.
- Existing test fixtures and hashes use `basemap=...` as the public URL surface.

## Recommended Target Model

Represent active catalog layers through a single ordered collection, with role metadata derived from catalog entry + runtime placement rules.

### Proposed state shape

Keep these concepts:
- `layerOrder`: ordered visible stack for all active entries and virtual system layers
- `layerSettings[id]`: visibility/opacity/blend metadata

Introduce a single activation list for catalog entries, for example:
- `activeLayers: ['osm', 'openskimap', 'custom-pmtiles']`

or make `layerOrder` itself the sole ordered source of truth for active catalog entries and virtual entries.

Recommendation:
- **Short term:** add `activeLayers` as a canonical list for catalog entries only.
- **Medium term:** derive `basemapStack` and `activeOverlays` as compatibility projections until callers are migrated.
- **Long term:** remove `basemapStack` / `activeOverlays` after persistence + UI migration is complete.

## API Direction

Replace category-specific mutation helpers with a unified operation layer.

### Proposed API surface

- `setActiveLayers(map, state, ids, options?)`
- `setLayerActive(map, state, id, visible, options?)`
- `moveActiveLayer(map, state, id, targetIndex)`
- `applyActiveLayers(map, state)`

Compatibility wrappers can remain temporarily:
- `setBasemapStack(...)` → maps to unified API
- `setOverlay(...)` → maps to unified API

## Migration Phases

## Phase 1 — Canonical model definition

**Files:** `app/js/state.js`, `app/js/layer-engine.js`, `app/js/layer-registry.js`

- Define the target canonical layer activation state.
- Document invariants in code structure and tests:
  - bottom-most active basemap acts as the primary basemap,
  - overlays remain above DEM analysis layers,
  - only one full-style basemap may be active.
- Add pure helpers to derive:
  - basemap subset,
  - overlay subset,
  - primary basemap id.

## Phase 2 — Unified application path

**Files:** `app/js/layer-engine.js`

- Implement a single apply path that:
  - ensures sources/layers exist,
  - applies style reload when required,
  - toggles visibility,
  - replays opacity and hidden state,
  - reorders visible layers consistently.
- Make existing `setBasemapStack` and `setOverlay` thin wrappers.

## Phase 3 — Persistence and bookmark convergence

**Files:** `app/js/persist.js`, `app/js/startup-state.js`, `app/js/layer-engine.js`

- Persist the canonical active-layer model.
- Keep read-time migration from:
  - `basemapStack`
  - `activeOverlays`
  - legacy bookmark payloads
- Update bookmark create/apply to round-trip only the canonical structure plus virtual system layers.

## Phase 4 — UI integration

**Files:** `app/js/main.js`, `app/index.html`, `app/css/main.css`

- Route basemap and overlay UI actions through unified operations.
- Reduce duplicated render/update code between basemap controls and overlay controls.
- Keep current UI affordances if needed, but make them views over the same state.

## Phase 5 — Cleanup

**Files:** `app/js/state.js`, `app/js/main.js`, `tests/**`

- Remove compatibility projections after callers are migrated.
- Drop dead wrapper-specific tests.
- Keep explicit migration tests for old persisted payloads.

## Required Tests

### Unit
- canonical-layer derivation helpers
- unified apply path for raster and style-backed entries
- persistence migration from `basemapStack` / `activeOverlays`
- bookmark migration and round-trip

### Playwright
- activate/deactivate a layer through both basemap and overlay UI entry points
- reorder mixed active layers and verify render order
- restore bookmarks with mixed basemap/overlay stacks

### Tauri WebDriver
- custom local tile sources still work when activated through the unified layer path
- DEM-only desktop flows still keep `basemap=none` semantics

## Risks

- **Style reload regressions**
  - Unified logic must not break `styleUrl` basemap rehydration.
- **Ordering drift**
  - Mixed active-layer ordering must remain deterministic around `dem-loader` and virtual system layers.
- **Persistence churn**
  - Existing saved settings/bookmarks must continue to load without user intervention.

## Recommendation

Do this as a dedicated refactor after the current stabilization work lands.

The safest approach is:
1. introduce the canonical model first,
2. keep wrappers for one transition phase,
3. migrate persistence/bookmarks,
4. then migrate the UI,
5. finally remove compatibility fields.
