export function deriveInitialState({
  persistedSettings,
  urlOverrides,
  defaultView,
  hasUrlState,
}) {
  const persisted = persistedSettings ?? null;
  const overrides = urlOverrides ?? {};
  const fallbackView = defaultView ?? {
    center: [6.8652, 45.8326],
    zoom: 12,
    basemap: null,
    mode: 'slope+relief',
    slopeOpacity: 0.45,
    terrain3d: false,
    terrainExaggeration: 1.4,
    testMode: false,
    bearing: 0,
    pitch: 0,
  };

  const hasPersistedView = Array.isArray(persisted?.viewCenter)
    && persisted.viewCenter.length === 2
    && Number.isFinite(persisted?.viewZoom);

  const initialView = {
    center: hasPersistedView ? persisted.viewCenter : fallbackView.center,
    zoom: Number.isFinite(persisted?.viewZoom) ? persisted.viewZoom : fallbackView.zoom,
    basemap: persisted?.basemap ?? fallbackView.basemap,
    mode: persisted?.mode ?? fallbackView.mode,
    slopeOpacity: persisted?.slopeOpacity ?? fallbackView.slopeOpacity,
    terrain3d: persisted?.terrain3d ?? fallbackView.terrain3d,
    terrainExaggeration: persisted?.terrainExaggeration ?? fallbackView.terrainExaggeration,
    testMode: false,
    bearing: Number.isFinite(persisted?.viewBearing) ? persisted.viewBearing : fallbackView.bearing,
    pitch: Number.isFinite(persisted?.viewPitch) ? persisted.viewPitch : fallbackView.pitch,
    ...overrides,
  };

  return {
    initialView,
    hasPersistedView,
    isTestMode: Boolean(initialView.testMode),
    shouldAttemptInitialGeolocate: !Boolean(initialView.testMode) && !hasUrlState && !hasPersistedView,
  };
}

export function applyUrlOverrides(state, overrides, currentView) {
  const patch = overrides ?? {};
  const activeView = currentView ?? {
    center: state.viewCenter,
    zoom: state.viewZoom,
    bearing: state.viewBearing,
    pitch: state.viewPitch,
  };

  const nextView = {
    center: patch.center ?? activeView.center,
    zoom: patch.zoom ?? activeView.zoom,
    bearing: patch.bearing ?? activeView.bearing,
    pitch: patch.pitch ?? activeView.pitch,
  };

  if (patch.basemap) {
    state.basemap = patch.basemap;
    state.basemapStack = [patch.basemap];
  }
  if ('mode' in patch) state.mode = patch.mode;
  if ('slopeOpacity' in patch) state.slopeOpacity = patch.slopeOpacity;
  if ('terrain3d' in patch) state.terrain3d = patch.terrain3d;
  if ('terrainExaggeration' in patch) state.terrainExaggeration = patch.terrainExaggeration;

  state.viewCenter = nextView.center;
  state.viewZoom = nextView.zoom;
  state.viewBearing = nextView.bearing;
  state.viewPitch = nextView.pitch;

  return {
    nextView,
    isTestMode: Boolean(patch.testMode),
  };
}
