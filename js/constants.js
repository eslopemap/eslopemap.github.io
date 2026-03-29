// Pure constants and config — no DOM, no map, no state dependencies.

import { cssColorToRgb01 } from './utils.js';
export const MAX_STEP_STOPS = 16;
export const DEM_TERRAIN_SOURCE_ID = 'dem-terrain';
export const DEM_HD_SOURCE_ID = 'dem-hd';
export const DEM_MAX_Z = 14;  // could go up to 15
export const SLOPE_RELIEF_CROSSFADE_Z = 11;

export const TRACK_COLORS = ['#e040fb','#ff5252','#00e676','#ffab00','#2979ff','#00e5ff','#ff6e40','#d500f9'];

export const ANALYSIS_COLOR = {
  slope: [
    'step', ['slope'],
    "#ffffff", // white
    20, "#c0ffff", // light sky blue
    24, "#57ffff", // bright cyan
    28, "#00d3db", // aqua blue
    31, "#fffa32", // sunshine yellow
    34, "#ffc256", // macaroni
    37, "#fd7100", // orange
    40, "#ff0000", // cherry red
    43, "#e958ff", // heliotrope
    47, "#a650ff", // lighter purple
    52, "#5e1eff", // purplish blue
    57, "#0000ff", // rich blue
    65, "#aaaaaa", // cool grey
    // 90, "#111111", // dummy
  ],
  aspect: [
    'step', ['aspect'],
    '#ff0000',
    45, '#ffff00',
    135, '#00ff00',
    225, '#00ffff',
    315, '#0000ff'
  ],
  'color-relief': [
    'interpolate', ['linear'], ['elevation'],
    -250, '#315C8D',
    -0.1, '#A9D4E8',
    0, '#A9D4E8',
    0.1, '#A9D4E8',
    50, '#809E47',
    100, '#B3C57D',
    250, '#D1D98C',
    500, '#C8B75F',
    750, '#A38766',
    1000, '#836A4E',
    1500, '#705B43',
    2000, '#604E39',
    2500, '#C2AB94',
    3000, '#D9CCBF',
    4000, '#ECE6DF',
    5000, '#F6F2EF',
    6000, '#FFFFFF',
    8000, '#F5FDFF'
  ]
};

export const ANALYSIS_RANGE = {
  slope: [0, 90],
  aspect: [0, 360],
  'color-relief': [-250, 8000]
};

export function parseStepRamp(expression, expectedInput) {
  if (!Array.isArray(expression) || expression[0] !== 'step') {
    throw new Error('Color expression must be a step expression');
  }

  const input = expression[1];
  if (!Array.isArray(input) || input[0] !== expectedInput) {
    throw new Error(`Step input must be ["${expectedInput}"]`);
  }

  const defaultColor = expression[2];
  const stepCount = Math.floor((expression.length - 3) / 2);
  if (stepCount > MAX_STEP_STOPS) {
    throw new Error(`Too many step stops. Max supported is ${MAX_STEP_STOPS}`);
  }

  const values = new Float32Array(MAX_STEP_STOPS);
  const colors = new Float32Array((MAX_STEP_STOPS + 1) * 3);

  const c0 = cssColorToRgb01(defaultColor);
  colors[0] = c0[0];
  colors[1] = c0[1];
  colors[2] = c0[2];

  for (let i = 0; i < stepCount; i++) {
    values[i] = Number(expression[3 + i * 2]);
    const c = cssColorToRgb01(expression[4 + i * 2]);
    colors[(i + 1) * 3 + 0] = c[0];
    colors[(i + 1) * 3 + 1] = c[1];
    colors[(i + 1) * 3 + 2] = c[2];
  }

  return {stepCount, values, colors};
}

export function parseInterpolateStops(expression, expectedInput) {
  if (!Array.isArray(expression) || expression[0] !== 'interpolate') {
    throw new Error('Color expression must be an interpolate expression');
  }

  const input = expression[2];
  if (!Array.isArray(input) || input[0] !== expectedInput) {
    throw new Error(`Interpolate input must be ["${expectedInput}"]`);
  }

  const stops = [];
  for (let i = 3; i < expression.length; i += 2) {
    stops.push({
      value: Number(expression[i]),
      color: String(expression[i + 1])
    });
  }
  return stops;
}

export const PARSED_RAMPS = {
  slope: parseStepRamp(ANALYSIS_COLOR.slope, 'slope'),
  aspect: parseStepRamp(ANALYSIS_COLOR.aspect, 'aspect')
};

export const COLOR_RELIEF_STOPS = parseInterpolateStops(ANALYSIS_COLOR['color-relief'], 'elevation');

export function rampToLegendCss(mode) {
  const ramp = PARSED_RAMPS[mode];
  const range = ANALYSIS_RANGE[mode];
  const min = range[0];
  const max = range[1];
  const parts = [];

  function pct(value) {
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  }
  function rgb(i) {
    const r = Math.round(ramp.colors[i * 3 + 0] * 255);
    const g = Math.round(ramp.colors[i * 3 + 1] * 255);
    const b = Math.round(ramp.colors[i * 3 + 2] * 255);
    return `rgb(${r}, ${g}, ${b})`;
  }

  for (let i = 0; i <= ramp.stepCount; i++) {
    const startPct = (i === 0) ? 0 : pct(ramp.values[i - 1]);
    const endPct = (i < ramp.stepCount) ? pct(ramp.values[i]) : 100;
    parts.push(`${rgb(i)} ${startPct.toFixed(2)}% ${endPct.toFixed(2)}%`);
  }

  return `linear-gradient(to right, ${parts.join(', ')})`;
}

export function interpolateStopsToLegendCss(stops) {
  const parts = stops.map(({value, color}, index) => {
    const position = Math.max(0, Math.min(100, ((value - stops[0].value) / (stops[stops.length - 1].value - stops[0].value)) * 100));
    return `${color} ${position.toFixed(2)}%`;
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

export const BASEMAP_LAYER_GROUPS = {
  'none': [],
  'osm': ['basemap-osm'],
  'otm': ['basemap-otm'],
  'ign-plan': ['basemap-ign'],
  'swisstopo-vector': [
    'basemap-swiss-landcover',
    'basemap-swiss-water',
    'basemap-swiss-transport',
    'basemap-swiss-boundary',
    'basemap-swiss-label'
  ],
  'kartverket': ['basemap-kartverket']
};

export const BASEMAP_DEFAULT_VIEW = {
  'kartverket': {center: [13.0, 67], zoom: 6, bounds: [3, 57, 32, 72]},
  'ign-plan': {center: [2.35, 46.8], zoom: 6, bounds: [-5.5, 41, 10, 51.5]},
  'swisstopo-vector': {center: [8.23, 46.82], zoom: 8, bounds: [5.9, 45.8, 10.5, 47.8]}
};

export const OPENSKIMAP_LAYER_IDS = [
  'basemap-ski-areas',
  'basemap-ski-runs',
  'basemap-ski-lifts',
  'basemap-ski-spots'
];

export const ALL_BASEMAP_LAYER_IDS = [...new Set(Object.values(BASEMAP_LAYER_GROUPS).flat())];
