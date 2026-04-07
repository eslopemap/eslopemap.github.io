# Report: Coverage, CI/CD, and Basemap Stack UI — 2026-04-07

## Summary

This session addressed coverage gaps, pruned low-value tests, set up comprehensive CI/CD coverage pipelines, pushed to GitHub (triggering CI + Release), and implemented Phase 2+4 of the unified basemap UI.

## Changes

### 1. Pruned Low-Value Unit Tests
- **Deleted** `state.test.mjs` — trivial Proxy + constant existence assertions
- **Trimmed** `dem.test.mjs` from 7 → 2 tests (null guard + bilinear interpolation)
- **Trimmed** `constants.test.mjs` from 14 → 3 tests (error paths + CSS output)
- **Kept** `shortcuts.test.mjs` (7 tests) — tests real logic (focus guards, modifier keys)
- Result: 80 meaningful tests across 11 files

### 2. E2E JS Coverage (Playwright + V8)
- Integrated V8 JS coverage collection into `mapPage` fixture in `tests/e2e/helpers.js`
- Gated behind `E2E_COVERAGE=1` — zero runtime cost when disabled
- `scripts/merge-e2e-coverage.mjs` — zero-dependency script that:
  - Reads raw V8 coverage JSONs from `coverage/e2e-v8/`
  - Resolves nested V8 ranges (most-specific-range-wins algorithm)
  - Produces `coverage/e2e-summary.txt` with per-file line coverage
- **Baseline**: 28.6% of app/js/ covered by e2e (2364/8261 lines across 21 files)
- Key uncovered areas: `track-ops.js` (0.2%), `io.js` (5.6%), `dem.js` (9.2%)

### 3. Rust Backend Coverage
- CI now uses `cargo-llvm-cov` via `taiki-e/install-action@cargo-llvm-cov`
- Outputs text summary in CI; HTML report available locally

### 4. CI Consolidation
- **Merged** redundant `js-unit` + `js-coverage` into single `js-tests` job
- Three CI jobs: `js-tests`, `rust-tests`, `e2e`
- E2E coverage summary uploaded as artifact on every run

### 5. Phase 2: Multi-Basemap State Model
- `state.js`: Added `basemapStack[]` and `basemapOpacities{}` to defaults
- `layer-engine.js`: New `setBasemapStack()` — shows multiple basemaps with independent opacity
  - `setBasemap()` is now a thin backward-compat wrapper
  - Bookmarks save/restore `basemapStack` and per-basemap opacities
  - `migrateSettings()` handles `basemap → basemapStack` migration
- `persist.js`: Added `basemapStack`, `basemapOpacities` to SETTING_KEYS
- `main.js`: Sync `basemapStack` in URL hash, test mode, and popstate

### 6. Phase 4: Basemap Stack UI
- Replaced static `<select id="basemap">` with dynamic stack panel:
  - Each basemap row: label + opacity slider + remove button
  - "Add basemap…" dropdown shows available basemaps not in stack
  - Per-basemap opacity drives `basemapOpacities` state
  - Bookmark apply refreshes the stack UI
- Hidden `<select id="basemap">` preserved for backward compat / test mode
- CSS: `.basemap-stack-*` styles matching existing `layer-order-*` pattern

### 7. Push & Release
- Pushed all changes to `origin/main`
- Created and pushed `v0.1.0` tag to trigger Release workflow
- CI + Release workflows visible on GitHub Actions

## Test Results

| Suite | Count | Status |
|-------|-------|--------|
| JS unit (Vitest) | 80 | ✅ All pass |
| Playwright e2e | 51 | ✅ All pass |
| Rust (cargo test) | 33 | ✅ All pass (local) |

## Files Changed

- `tests/unit/state.test.mjs` — deleted
- `tests/unit/dem.test.mjs` — trimmed to 2 tests
- `tests/unit/constants.test.mjs` — trimmed to 3 tests
- `tests/e2e/helpers.js` — V8 coverage integration
- `scripts/merge-e2e-coverage.mjs` — new: coverage merge script
- `.github/workflows/ci.yml` — consolidated, coverage for all tiers
- `app/js/state.js` — basemapStack, basemapOpacities
- `app/js/layer-engine.js` — setBasemapStack, migration
- `app/js/persist.js` — new setting keys
- `app/js/main.js` — stack UI, add-basemap, backward compat
- `app/index.html` — basemap stack panel HTML
- `app/css/main.css` — basemap stack styles
- `tests/README.md` — updated coverage docs
- `package.json` — test:e2e:coverage script

## Next Steps

- [ ] Monitor CI/CD runs on GitHub — fix any CI failures
- [ ] Phase 3: Desktop tile source discovery (scan local `.mbtiles`/`.pmtiles`)
- [ ] Improve e2e coverage for low-coverage modules (track-ops, io, dem)
- [ ] Add Tauri integration tests (desktop-specific IPC commands)
