# TEST — Test Architecture & Test Plan

## Current state

slope.html is a single-file app (~4000 lines) with no build step and no tests. All HTML, CSS, and JS are inline. Testing has been purely manual browser verification.

## Recommended test architecture

### 1. Unit tests with Vitest (zero-build compatible)

Vitest can run ES module tests directly without bundling. Extract testable logic into importable functions.

**Setup**:
```bash
npm init -y
npm i -D vitest
```

**Strategy**: Extract pure functions into a `slope-lib.js` module imported by both `slope.html` and tests. These functions have no DOM/MapLibre dependencies:

| Function | What it tests |
|---|---|
| `haversineKm(a, b)` | Distance calculation |
| `computeProfile(coords)` | Elevation/slope/distance arrays |
| `trackStats(t)` | Distance, gain, loss, avg/max slope |
| `parseGPX(text, baseName)` | GPX import (tracks, routes, segments, names) |
| `parseGeoJSON(text)` | GeoJSON import (LineString, MultiLineString) |
| `enrichElevation(coords)` | Elevation sampling (mock `elevationAt`) |
| `gpxExport(track)` | GPX export string generation |
| `geojsonExport(track)` | GeoJSON export string generation |
| `representativeTrackSampleSpacingMeters()` | Spacing calculation |
| `interpolateTrackLngLat()` | Along-track interpolation |
| `cssColorToRgb01(color)` | CSS color parsing |
| `parseStepRamp()` / `parseInterpolateStops()` | Ramp expression parsing |
| `rampToLegendCss(mode)` | Legend gradient CSS generation |

**Example test** (`tests/track-stats.test.js`):
```js
import { describe, it, expect } from 'vitest';
import { haversineKm, computeProfile } from '../slope-lib.js';

describe('haversineKm', () => {
  it('returns 0 for same point', () => {
    expect(haversineKm([6.86, 45.83, 0], [6.86, 45.83, 0])).toBe(0);
  });
  it('computes ~111 km for 1° latitude', () => {
    const d = haversineKm([0, 0, 0], [0, 1, 0]);
    expect(d).toBeCloseTo(111.2, 0);
  });
});
```

### 2. Integration tests with Playwright

For UI interactions, map rendering, and end-to-end flows. Playwright can test the actual app served from a local HTTP server.

**Setup**:
```bash
npm i -D @playwright/test
npx playwright install chromium
```

**Serve**: `npx serve .` or `python3 -m http.server 8080`

**Test structure** (`tests/e2e/`):

#### Core map tests
- Map loads and renders tiles
- Settings panel toggles open/close
- Basemap switching works
- Mode switching (slope/aspect/color-relief/none)
- URL hash persistence (zoom, center, mode)

#### Track editor tests — Desktop
| Test case | Steps | Expected |
|---|---|---|
| Create new track | Click ✏ → click 3 points → dblclick | Track with 3 pts appears in list |
| Edit existing track | Click ✎ → drag vertex | Vertex moves, stats update |
| Select vs Edit | Click track name vs ✎ | Name: wider line only. ✎: vertices visible |
| Smart hover-insert | Hover near line → click+drag | New vertex inserted at click point |
| Delete vertex | Shift+click vertex | Vertex removed |
| Undo (Ctrl+Z) | Add points → Ctrl+Z | Last point removed |
| Undo button (🗑️) | Add points → click 🗑️ | Last point removed |
| Vertex selection | Click vertex (no drag) | Blue highlight, + popup appears |
| Insert-after mode | Select vertex → click + → click map | New point inserted after selected |
| Double-click to finish | Start editing → dblclick | Edit mode exits |
| Escape to finish | Start editing → Escape | Edit mode exits |
| Delete track | Click × → confirm | Track removed |
| Export GPX | Click Export GPX | File downloaded, valid GPX |
| Export GeoJSON | Click Export GeoJSON | Valid GeoJSON Feature |

#### Track editor tests — Mobile (emulated)
| Test case | Steps | Expected |
|---|---|---|
| Mobile-friendly default | Enter edit mode | Crosshair visible, 📱 active |
| Tap inserts at center | Tap anywhere | Point added at crosshair center |
| Insert preview | Pan map | Dashed line from last point to center |
| Tap vertex → move | Tap vertex → pan | Toast shows, vertex moves with center |
| Touch end confirms | Tap vertex → pan → lift | Move confirmed, vertex stays |
| Toggle mobile mode off | Click 📱 | Desktop behavior on mobile |
| Long-press drag (non-mobile) | Toggle 📱 off → long-press vertex | Vertex drags directly |

#### Track import tests
| Test case | Steps | Expected |
|---|---|---|
| GPX drag & drop | Drop .gpx file | Track(s) appear, names match |
| GPX with routes | Drop .gpx with `<rte>` | Route imported as track |
| GeoJSON import | Drop .geojson | LineString becomes track |
| Multi-segment GPX | Drop multi-trkseg GPX | Multiple tracks created |

#### Profile tests
| Test case | Steps | Expected |
|---|---|---|
| Profile auto-opens | Select track with ≥2 pts | Profile panel visible |
| Profile hover linkage | Hover chart | Map marker follows, tooltip shows |
| Profile close/reopen | Close → click "Show Profile" | Profile reopens |

### 3. Visual regression tests

Use Playwright screenshots for visual regression on:
- Slope/aspect/color-relief rendering
- Legend appearance per mode
- Track display (line color, vertex visibility)
- Profile chart appearance

### 4. Accessibility & PWA tests

- Lighthouse CI for PWA compliance
- Manifest validation
- Offline readiness (when implemented)

## Test execution

```bash
# Unit tests
npx vitest run

# E2E tests (requires local server)
npx playwright test

# Watch mode for development
npx vitest --watch
```

## Recommended file structure

```
slope.html
slope-lib.js          ← extracted pure functions (future)
tests/
  unit/
    haversine.test.js
    track-stats.test.js
    gpx-parser.test.js
    geojson-parser.test.js
    color-ramp.test.js
  e2e/
    map-basic.spec.js
    track-desktop.spec.js
    track-mobile.spec.js
    track-import.spec.js
    profile.spec.js
    settings.spec.js
vitest.config.js
playwright.config.js
package.json
```

## Priority order

1. **GPX/GeoJSON parsing** — pure functions, easy to extract, high value (data integrity)
2. **Track stats** — pure math, critical for display accuracy
3. **Desktop track editing E2E** — most complex interaction flow
4. **Mobile track editing E2E** — hardest to test manually
5. **Visual regression** — catches rendering regressions across changes
