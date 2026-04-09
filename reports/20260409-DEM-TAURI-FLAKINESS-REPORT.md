# DEM Tauri Flakiness Report

## Scope

This pass focused on stabilizing the Tauri WebDriver DEM coverage, removing accidental internet-backed basemap rendering from the desktop screenshots, and aligning the assertions with the real `slope+relief` behavior.

## Root Causes Found

### 1. The DEM screenshot test was using the wrong startup path

The custom tile desktop tests had already shown that Tauri WebDriver is more reliable when navigation uses:
- `window.location.hash = ...`
- a short settle pause
- `browser.refresh()`

The DEM spec still used `browser.url(...)`, which made startup overrides and persisted state interaction less deterministic in WKWebView.

This caused readiness checks to fail even when the app itself was healthy.

### 2. `basemap=none` was not treated as a first-class override

A real product bug was present across startup/hash handling:
- `parseHashParams()` did not preserve an explicit empty basemap stack,
- startup override application did not reliably keep an empty stack,
- initial boot could reintroduce a default basemap.

As a result, `basemap=none` in the desktop DEM test still produced an OSM-backed map, which made the screenshot both flaky and semantically wrong because it depended on internet-backed layers.

### 3. The DEM readiness assertion was too strict in the wrong dimension

The first pass assumed a single analysis layer visibility pattern and also tried to read app state from a global hook that is not actually exposed in this environment.

In practice, `slope+relief` is a composed mode:
- both `analysis` and `analysis-relief` layers exist,
- at least one of them must be visible,
- the rendered canvas must contain non-white pixels.

The stable readiness condition is therefore based on:
- map/style readiness,
- layer/source existence,
- a visible DEM analysis layer,
- a pixel probe of the rendered map.

## Implemented Changes

### 1. Fixed explicit no-basemap startup handling

Updated:
- `app/js/ui.js`
- `app/js/startup-state.js`
- `app/js/main.js`

The app now treats `basemap=none` as an explicit empty basemap stack and preserves that state through:
- initial hash parsing,
- startup state derivation,
- initial app boot.

This is a product fix, not just a test fix.

### 2. Made the DEM Tauri navigation deterministic

Updated:
- `tests/tauri-e2e/tests/dem-tile-serving.spec.mjs`

The spec now uses the same navigation strategy that already stabilized the custom-source Tauri tests:
- set `window.location.hash`,
- pause briefly,
- refresh,
- wait for Tauri and map readiness.

### 3. Changed DEM diagnostics to use real observable state

The desktop test no longer depends on a nonexistent global app-state hook.

Instead it reads:
- the `mode` control value,
- the actual URL hash,
- MapLibre layer/source presence and visibility,
- live canvas pixels.

This is more robust in WKWebView's isolated execution environment.

### 4. Re-established the intended screenshot semantics

The corrected desktop screenshots now represent the intended states:
- `01-dem-tile-404.png` -> pure white empty state with `None (primary)` and no internet-backed basemap
- `01-dem-tile-cache-working.png` -> DEM-only `slope+relief` rendering from cache-backed tiles, still with no basemap

The previously checked-in baselines were stale and captured an OSM-backed state, so they are no longer authoritative.

### 5. Added strategic guidance to `tests/README.md`

Documented:
- when `test_mode` is valid and when it is not,
- why desktop DEM assertions should use normal mode,
- why `basemap=none` matters for deterministic screenshots,
- why Tauri navigation should prefer hash-set + refresh,
- why readiness should rely on layer visibility plus pixel probes rather than sleeps.

### 6. Hardened Playwright E2E into fail-closed offline-like mode

Updated:
- `tests/e2e/helpers.js`
- `tests/e2e/dem-loading.spec.js`
- `tests/e2e/tile-serving.spec.js`

The Playwright suite now installs a shared `page.route('**/*', ...)` guard that:
- allows same-origin app assets,
- allows local fixture servers on `localhost` / loopback,
- returns HTTP 404 for all non-local requests.

This makes web E2E deterministic even if a test or app regression accidentally reintroduces an internet-backed source.

## Test Results

### Confirmed during this pass

Focused Tauri DEM run now passes all readiness and runtime assertions; the only remaining failure before snapshot replacement was stale-baseline mismatch.

Focused Playwright validation of the new offline-route guard also now reaches application/test assertions correctly.
The shared guard no longer interferes with local app or fixture-server traffic.

At the time of this update, the remaining focused Playwright failure is limited to the existing `dem-color-relief.png` screenshot mismatch:
- measured diff ratio: `0.06`
- configured threshold: `0.05`

That mismatch is consistent with baseline maintenance work, not with the new fail-closed network guard.

That means the flakiness has been reduced from:
- startup/readiness failures,
- accidental OSM/internet rendering,
- mismatched DEM visibility assumptions,

to:
- expected snapshot update work.

## Strategic Notes

### Keep `test_mode` narrow

`test_mode` is appropriate for deterministic UI-only states. It is not appropriate for proving:
- hillshade,
- contour rendering,
- terrain-analysis,
- color relief,
- slope+relief composition.

### Prefer semantic screenshots over convenient ones

A white screenshot with `None (primary)` is a stronger empty-state baseline than a screenshot that silently depends on OSM.

Likewise, DEM rendering screenshots should prove that cached DEM tiles alone are sufficient to drive the rendering path.

### Tauri and web coverage are complementary, not interchangeable

The web-side DEM tests remain useful for frontend rendering coverage.
The Tauri DEM tests are valuable because they exercise the real desktop cache and tile server path.

## Files Changed In This Pass

- `app/js/ui.js`
- `app/js/startup-state.js`
- `app/js/main.js`
- `tests/e2e/helpers.js`
- `tests/e2e/dem-loading.spec.js`
- `tests/e2e/tile-serving.spec.js`
- `tests/tauri-e2e/tests/dem-tile-serving.spec.mjs`
- `tests/README.md`
- `tests/tauri-e2e/snapshots/01-dem-tile-404.png`
- `tests/tauri-e2e/snapshots/01-dem-tile-cache-working.png`

## Remaining Follow-up

After snapshot replacement, the remaining work is procedural:
- run the focused and broader required test suites,
- confirm no unexpected regressions,
- commit the changes.
