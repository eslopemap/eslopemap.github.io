import { describe, it, expect } from 'vitest';
import { deriveInitialState, applyUrlOverrides } from '../../app/js/startup-state.js';

describe('startup-state helpers', () => {
  it('deriveInitialState merges persisted settings with explicit URL overrides', () => {
    const result = deriveInitialState({
      persistedSettings: {
        basemapStack: ['osm'],
        mode: 'slope',
        slopeOpacity: 0.3,
        terrain3d: false,
        terrainExaggeration: 1.6,
        viewCenter: [6.8, 45.9],
        viewZoom: 10.5,
        viewBearing: 12,
        viewPitch: 20,
      },
      urlOverrides: {
        mode: 'color-relief',
        terrain3d: true,
        pitch: 35,
      },
      defaultView: {
        center: [0, 0],
        zoom: 1,
        basemapStack: ['otm'],
        mode: 'slope+relief',
        slopeOpacity: 0.45,
        terrain3d: false,
        terrainExaggeration: 1.4,
        testMode: false,
        bearing: 0,
        pitch: 0,
      },
      hasUrlState: true,
    });

    expect(result.initialView).toEqual({
      center: [6.8, 45.9],
      zoom: 10.5,
      basemapStack: ['osm'],
      activeOverlays: [],
      mode: 'color-relief',
      slopeOpacity: 0.3,
      terrain3d: true,
      terrainExaggeration: 1.6,
      showHillshade: undefined,
      showContours: undefined,
      testMode: false,
      bearing: 12,
      pitch: 35,
    });
    expect(result.hasPersistedView).toBe(true);
    expect(result.isTestMode).toBe(false);
    expect(result.shouldAttemptInitialGeolocate).toBe(false);
  });

  it('deriveInitialState requests initial geolocation only with no url state, no test mode, and no persisted view', () => {
    const result = deriveInitialState({
      persistedSettings: { basemapStack: ['osm'] },
      urlOverrides: {},
      defaultView: {
        center: [6.8652, 45.8326],
        zoom: 12,
        basemapStack: ['osm'],
        mode: 'slope+relief',
        slopeOpacity: 0.45,
        terrain3d: false,
        terrainExaggeration: 1.4,
        testMode: false,
        bearing: 0,
        pitch: 0,
      },
      hasUrlState: false,
    });

    expect(result.hasPersistedView).toBe(false);
    expect(result.shouldAttemptInitialGeolocate).toBe(true);
  });

  it('applyUrlOverrides updates state fields and returns the next view payload', () => {
    const state = {
      basemapStack: ['osm'],
      mode: 'slope',
      slopeOpacity: 0.4,
      terrain3d: false,
      terrainExaggeration: 1.5,
      viewCenter: [6.8, 45.9],
      viewZoom: 10,
      viewBearing: 0,
      viewPitch: 0,
    };

    const result = applyUrlOverrides(state, {
      basemapStack: ['none'],
      mode: 'aspect',
      slopeOpacity: 0.7,
      terrain3d: true,
      terrainExaggeration: 2,
      center: [7.1, 46.2],
      zoom: 13,
      bearing: 22,
      pitch: 40,
      testMode: true,
    }, {
      center: [6.8, 45.9],
      zoom: 10,
      bearing: 0,
      pitch: 0,
    });

    expect(state).toMatchObject({
      basemapStack: ['none'],
      mode: 'aspect',
      slopeOpacity: 0.7,
      terrain3d: true,
      terrainExaggeration: 2,
      viewCenter: [7.1, 46.2],
      viewZoom: 13,
      viewBearing: 22,
      viewPitch: 40,
    });
    expect(result).toEqual({
      nextView: {
        center: [7.1, 46.2],
        zoom: 13,
        bearing: 22,
        pitch: 40,
      },
      isTestMode: true,
    });
  });

  it('deriveInitialState migrates a legacy persisted basemap into basemapStack', () => {
    const result = deriveInitialState({
      persistedSettings: { basemap: 'osm' },
      urlOverrides: {},
      defaultView: {
        center: [0, 0],
        zoom: 1,
        basemapStack: ['otm'],
        mode: 'slope+relief',
        slopeOpacity: 0.45,
        terrain3d: false,
        terrainExaggeration: 1.4,
        testMode: false,
        bearing: 0,
        pitch: 0,
      },
      hasUrlState: false,
    });

    expect(result.initialView.basemapStack).toEqual(['osm']);
  });
});
