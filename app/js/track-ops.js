import { haversineKm } from './utils.js';

function cloneCoord(coord) {
  return Array.isArray(coord) ? coord.slice() : coord;
}

function cloneCoords(coords) {
  return (coords || []).map(cloneCoord);
}

function distanceMeters(a, b) {
  return haversineKm(a, b) * 1000;
}

function meanLatitude(coords) {
  if (!coords.length) return 0;
  return coords.reduce((sum, coord) => sum + coord[1], 0) / coords.length;
}

function toMetersXY(coord, refLat) {
  const metersPerLat = 111320;
  const metersPerLon = Math.cos(refLat * Math.PI / 180) * metersPerLat;
  return {
    x: coord[0] * metersPerLon,
    y: coord[1] * metersPerLat,
  };
}

function triangleAreaMeters(a, b, c, refLat) {
  const pa = toMetersXY(a, refLat);
  const pb = toMetersXY(b, refLat);
  const pc = toMetersXY(c, refLat);
  return Math.abs(
    pa.x * (pb.y - pc.y) +
    pb.x * (pc.y - pa.y) +
    pc.x * (pa.y - pb.y)
  ) / 2;
}

function perpendicularDistanceMeters(point, lineStart, lineEnd, refLat) {
  const p = toMetersXY(point, refLat);
  const a = toMetersXY(lineStart, refLat);
  const b = toMetersXY(lineEnd, refLat);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const projX = a.x + clamped * dx;
  const projY = a.y + clamped * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function isFiniteElevation(coord) {
  return Number.isFinite(coord?.[2]);
}

function buildProtectedPointFlags(coords) {
  const flags = new Array(coords.length).fill(false);
  if (!coords.length) return flags;
  flags[0] = true;
  flags[coords.length - 1] = true;
  for (let i = 1; i < coords.length - 1; i++) {
    const prev = coords[i - 1];
    const cur = coords[i];
    const next = coords[i + 1];
    if (!isFiniteElevation(prev) || !isFiniteElevation(cur) || !isFiniteElevation(next)) continue;
    const prevEle = prev[2];
    const curEle = cur[2];
    const nextEle = next[2];
    const isPeak = curEle > prevEle && curEle > nextEle;
    const isValley = curEle < prevEle && curEle < nextEle;
    if (isPeak || isValley) flags[i] = true;
  }
  return flags;
}

function buildKeptIndices(keepFlags) {
  const kept = [];
  for (let i = 0; i < keepFlags.length; i++) {
    if (keepFlags[i]) kept.push(i);
  }
  return kept;
}

function computeMaxGapMeters(coords, keepFlags = null) {
  const points = keepFlags ? buildKeptIndices(keepFlags).map(index => coords[index]) : coords;
  let maxGapMeters = 0;
  for (let i = 1; i < points.length; i++) {
    maxGapMeters = Math.max(maxGapMeters, distanceMeters(points[i - 1], points[i]));
  }
  return maxGapMeters;
}

function enforceMaxGap(coords, keepFlags, maxGapMeters) {
  if (!Number.isFinite(maxGapMeters) || maxGapMeters <= 0) return;
  let changed = true;
  while (changed) {
    changed = false;
    const keptIndices = buildKeptIndices(keepFlags);
    for (let i = 1; i < keptIndices.length; i++) {
      const prevIdx = keptIndices[i - 1];
      const nextIdx = keptIndices[i];
      if (distanceMeters(coords[prevIdx], coords[nextIdx]) <= maxGapMeters) continue;
      const midIdx = Math.floor((prevIdx + nextIdx) / 2);
      let insertIdx = -1;
      for (let candidate = midIdx; candidate > prevIdx; candidate--) {
        if (!keepFlags[candidate]) {
          insertIdx = candidate;
          break;
        }
      }
      if (insertIdx < 0) {
        for (let candidate = midIdx + 1; candidate < nextIdx; candidate++) {
          if (!keepFlags[candidate]) {
            insertIdx = candidate;
            break;
          }
        }
      }
      if (insertIdx > prevIdx && insertIdx < nextIdx) {
        keepFlags[insertIdx] = true;
        changed = true;
        break;
      }
    }
  }
}

function mergeCoordsWithReplacement(trackCoords, startIdx, endIdx, replacementCoords) {
  return [
    ...trackCoords.slice(0, startIdx).map(cloneCoord),
    ...replacementCoords.map(cloneCoord),
    ...trackCoords.slice(endIdx + 1).map(cloneCoord),
  ];
}

function interpolateCoord(a, b, t) {
  const coord = [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  if (Number.isFinite(a[2]) && Number.isFinite(b[2])) {
    coord[2] = a[2] + (b[2] - a[2]) * t;
  } else if (Number.isFinite(a[2])) {
    coord[2] = a[2];
  } else if (Number.isFinite(b[2])) {
    coord[2] = b[2];
  } else {
    coord[2] = null;
  }
  if (Number.isFinite(a[3]) && Number.isFinite(b[3])) {
    coord[3] = Math.round(a[3] + (b[3] - a[3]) * t);
  }
  return coord;
}

function validateTrackSpan(track, startIdx, endIdx) {
  const coords = track?.coords || [];
  if (!coords.length) return 'Track has no points';
  if (!Number.isInteger(startIdx) || !Number.isInteger(endIdx)) return 'Selection indices are invalid';
  if (startIdx < 0 || endIdx < 0 || startIdx >= coords.length || endIdx >= coords.length) {
    return 'Selection indices are out of range';
  }
  if (startIdx > endIdx) return 'Selection indices are reversed';
  return null;
}

function describeSpanRange(selectionSpan) {
  if (!selectionSpan) return '';
  if (selectionSpan.pointCount <= 1) return `point ${selectionSpan.startIdx + 1}`;
  return `points ${selectionSpan.startIdx + 1}-${selectionSpan.endIdx + 1}`;
}

function applyDouglasPeuckerRecursive(coords, keepFlags, protectedFlags, startIdx, endIdx, toleranceMeters, refLat) {
  if (endIdx - startIdx <= 1) return;
  let maxDistance = -1;
  let maxIdx = -1;
  for (let i = startIdx + 1; i < endIdx; i++) {
    if (protectedFlags[i]) {
      keepFlags[i] = true;
      applyDouglasPeuckerRecursive(coords, keepFlags, protectedFlags, startIdx, i, toleranceMeters, refLat);
      applyDouglasPeuckerRecursive(coords, keepFlags, protectedFlags, i, endIdx, toleranceMeters, refLat);
      return;
    }
    const dist = perpendicularDistanceMeters(coords[i], coords[startIdx], coords[endIdx], refLat);
    if (dist > maxDistance) {
      maxDistance = dist;
      maxIdx = i;
    }
  }
  if (maxIdx >= 0 && maxDistance > toleranceMeters) {
    keepFlags[maxIdx] = true;
    applyDouglasPeuckerRecursive(coords, keepFlags, protectedFlags, startIdx, maxIdx, toleranceMeters, refLat);
    applyDouglasPeuckerRecursive(coords, keepFlags, protectedFlags, maxIdx, endIdx, toleranceMeters, refLat);
  }
}

export function buildSelectionSpan(track, startIdx, endIdx) {
  const validationError = validateTrackSpan(track, startIdx, endIdx);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const coords = track.coords.slice(startIdx, endIdx + 1).map(cloneCoord);
  let lengthMeters = 0;
  let maxGapMeters = 0;
  for (let i = 1; i < coords.length; i++) {
    const gap = distanceMeters(coords[i - 1], coords[i]);
    lengthMeters += gap;
    maxGapMeters = Math.max(maxGapMeters, gap);
  }
  const protectedFlags = buildProtectedPointFlags(coords);
  const protectedExtremaCount = Math.max(0, protectedFlags.filter(Boolean).length - (coords.length ? 2 : 0));
  const sourceIndices = Array.from({ length: coords.length }, (_unused, offset) => startIdx + offset);

  return {
    ok: true,
    trackId: track.id,
    sourceKind: track.sourceKind || 'track',
    trackName: track.segmentLabel || track.name || 'Track',
    startIdx,
    endIdx,
    coords,
    sourceIndices,
    pointCount: coords.length,
    lengthMeters,
    maxGapMeters,
    protectedExtremaCount,
    isFullTrack: startIdx === 0 && endIdx === track.coords.length - 1,
    rangeLabel: describeSpanRange({ startIdx, endIdx, pointCount: coords.length }),
  };
}

export function densifyTrackSpan(track, selectionSpan, startIdx, endIdx, options = {}) {
  const span = selectionSpan?.ok ? selectionSpan : buildSelectionSpan(track, startIdx, endIdx);
  if (!span.ok) return span;

  const maxGapMeters = Number.isFinite(options.maxGapMeters) ? options.maxGapMeters : 5;
  const densified = [];
  let insertedPointCount = 0;
  for (let i = 0; i < span.coords.length; i++) {
    const coord = span.coords[i];
    densified.push(cloneCoord(coord));
    if (i === span.coords.length - 1) continue;
    const next = span.coords[i + 1];
    const gapMeters = distanceMeters(coord, next);
    const insertCount = Math.max(0, Math.ceil(gapMeters / maxGapMeters) - 1);
    for (let insertIdx = 1; insertIdx <= insertCount; insertIdx++) {
      densified.push(interpolateCoord(coord, next, insertIdx / (insertCount + 1)));
      insertedPointCount++;
    }
  }

  return {
    ok: true,
    kind: 'densify',
    startIdx: span.startIdx,
    endIdx: span.endIdx,
    replacementCoords: densified,
    updatedCoords: mergeCoordsWithReplacement(track.coords, span.startIdx, span.endIdx, densified),
    preview: {
      beforePointCount: span.pointCount,
      afterPointCount: densified.length,
      insertedPointCount,
      maxGapMeters: computeMaxGapMeters(densified),
    },
  };
}

export function simplifyTrackSpan(track, selectionSpan, startIdx, endIdx, options = {}) {
  const span = selectionSpan?.ok ? selectionSpan : buildSelectionSpan(track, startIdx, endIdx);
  if (!span.ok) return span;
  if (span.pointCount < 3) {
    return { ok: false, error: 'Need at least 3 points to simplify' };
  }

  const toleranceMeters = Math.max(0.5, Number(options.horizontalTolerance || options.tolerance || 10));
  const maxGapMeters = toleranceMeters * 15;
  const method = options.method === 'douglas-peucker' ? 'douglas-peucker' : 'visvalingam';
  const protectedFlags = buildProtectedPointFlags(span.coords);
  const refLat = meanLatitude(span.coords);
  const keepFlags = new Array(span.coords.length).fill(method === 'douglas-peucker' ? false : true);
  keepFlags[0] = true;
  keepFlags[span.coords.length - 1] = true;

  if (method === 'douglas-peucker') {
    applyDouglasPeuckerRecursive(span.coords, keepFlags, protectedFlags, 0, span.coords.length - 1, toleranceMeters, refLat);
    for (let i = 0; i < protectedFlags.length; i++) {
      if (protectedFlags[i]) keepFlags[i] = true;
    }
  } else {
    const thresholdArea = toleranceMeters * toleranceMeters;
    while (true) {
      let bestIndex = -1;
      let bestArea = Infinity;
      const keptIndices = buildKeptIndices(keepFlags);
      for (let keptPos = 1; keptPos < keptIndices.length - 1; keptPos++) {
        const idx = keptIndices[keptPos];
        if (protectedFlags[idx]) continue;
        const prevIdx = keptIndices[keptPos - 1];
        const nextIdx = keptIndices[keptPos + 1];
        if (distanceMeters(span.coords[prevIdx], span.coords[nextIdx]) > maxGapMeters) continue;
        const area = triangleAreaMeters(span.coords[prevIdx], span.coords[idx], span.coords[nextIdx], refLat);
        if (area < bestArea) {
          bestArea = area;
          bestIndex = idx;
        }
      }
      if (bestIndex < 0 || bestArea > thresholdArea) break;
      keepFlags[bestIndex] = false;
    }
  }

  enforceMaxGap(span.coords, keepFlags, maxGapMeters);
  for (let i = 0; i < protectedFlags.length; i++) {
    if (protectedFlags[i]) keepFlags[i] = true;
  }

  const simplified = buildKeptIndices(keepFlags).map(index => cloneCoord(span.coords[index]));
  return {
    ok: true,
    kind: 'simplify',
    startIdx: span.startIdx,
    endIdx: span.endIdx,
    replacementCoords: simplified,
    updatedCoords: mergeCoordsWithReplacement(track.coords, span.startIdx, span.endIdx, simplified),
    preview: {
      beforePointCount: span.pointCount,
      afterPointCount: simplified.length,
      maxRetainedGapMeters: computeMaxGapMeters(span.coords, keepFlags),
      protectedExtremaRetained: buildKeptIndices(keepFlags).filter(index => protectedFlags[index]).length,
      protectedExtremaAvailable: protectedFlags.filter(Boolean).length,
      method,
    },
  };
}

export function splitTrackSpan(track, selectionSpan, startIdx, endIdx, options = {}) {
  const span = selectionSpan?.ok ? selectionSpan : buildSelectionSpan(track, startIdx, endIdx);
  if (!span.ok) return span;
  if (!span.isFullTrack && span.pointCount < 1) return { ok: false, error: 'Selection is empty' };
  const mode = options.mode || (span.pointCount === 1 ? 'at-point' : 'extract-track');
  const coords = track.coords;

  if (mode === 'at-point') {
    const idx = span.startIdx;
    if (idx <= 0 || idx >= coords.length - 1) {
      return { ok: false, error: 'Pick an interior point to split the track' };
    }
    return {
      ok: true,
      kind: 'split',
      mode,
      fragments: [
        { role: 'before', coords: cloneCoords(coords.slice(0, idx + 1)) },
        { role: 'after', coords: cloneCoords(coords.slice(idx)) },
      ],
    };
  }

  if (span.isFullTrack) {
    return { ok: false, error: 'Cannot extract the full track as a split operation' };
  }

  const fragments = [];
  if (span.startIdx > 0) {
    fragments.push({ role: 'before', coords: cloneCoords(coords.slice(0, span.startIdx + 1)) });
  }
  fragments.push({ role: mode === 'extract-segment' ? 'segment' : 'selected', coords: cloneCoords(coords.slice(span.startIdx, span.endIdx + 1)) });
  if (span.endIdx < coords.length - 1) {
    fragments.push({ role: 'after', coords: cloneCoords(coords.slice(span.endIdx)) });
  }

  return {
    ok: true,
    kind: 'split',
    mode,
    fragments,
  };
}

export function mergeTrackSpans(tracks, options = {}) {
  const items = (tracks || []).filter(track => Array.isArray(track?.coords) && track.coords.length >= 1);
  if (items.length < 2) {
    return { ok: false, error: 'Select at least two tracks to merge' };
  }
  const reverseMask = Array.isArray(options.reverseMask) ? options.reverseMask : [];
  const normalizedTracks = items.map((track, index) => ({
    track,
    coords: cloneCoords(reverseMask[index] ? track.coords.slice().reverse() : track.coords),
  }));

  let mergedCoords = [];
  const endpointGapWarnings = [];
  for (let i = 0; i < normalizedTracks.length; i++) {
    const current = normalizedTracks[i];
    if (!mergedCoords.length) {
      mergedCoords = current.coords;
      continue;
    }
    const prev = mergedCoords[mergedCoords.length - 1];
    const next = current.coords[0];
    const gapMeters = distanceMeters(prev, next);
    if (gapMeters > 20) {
      endpointGapWarnings.push(`Gap ${gapMeters.toFixed(0)} m between ${normalizedTracks[i - 1].track.name} and ${current.track.name}`);
    }
    if (prev[0] === next[0] && prev[1] === next[1]) {
      mergedCoords.push(...current.coords.slice(1).map(cloneCoord));
    } else {
      mergedCoords.push(...current.coords.map(cloneCoord));
    }
  }

  return {
    ok: true,
    kind: 'merge',
    mode: options.mode || 'single-segment',
    mergedCoords,
    preview: {
      inputTrackCount: items.length,
      mergedPointCount: mergedCoords.length,
      endpointGapWarnings,
    },
  };
}

export function convertRouteToTrack(track, selectionSpan, startIdx, endIdx, options = {}) {
  const span = selectionSpan?.ok ? selectionSpan : buildSelectionSpan(track, startIdx, endIdx);
  if (!span.ok) return span;
  if ((track.sourceKind || 'track') !== 'route') {
    return { ok: false, error: 'Selected item is not a route' };
  }
  if (!span.isFullTrack) {
    return { ok: false, error: 'Route conversion applies to the full route only' };
  }
  const replace = options.replace === true;
  return {
    ok: true,
    kind: 'route-to-track',
    replace,
    createdTrack: {
      name: track.name,
      coords: cloneCoords(track.coords),
      color: track.color,
      desc: track.desc || '',
      cmt: track.cmt || '',
      trkType: track.rteType || track.trkType || '',
      sourceKind: 'track',
    },
    preview: {
      consequence: replace ? 'replace route with track' : 'create sibling track from route',
    },
  };
}

/**
 * Lightweight Douglas-Peucker simplification for merged-source display.
 * Returns a new array of [lng, lat] pairs (no elevation) suitable for a
 * LineString in the merged GeoJSON source. Tracks with <= minPoints are
 * returned as-is (just stripped to 2D). Does NOT modify the original coords.
 */
export function simplifyForDisplay(coords, thresholdMeters = 5, minPoints = 500) {
  if (!coords || coords.length < 2) return coords ? coords.map(c => [c[0], c[1]]) : [];
  if (coords.length <= minPoints) return coords.map(c => [c[0], c[1]]);
  const refLat = meanLatitude(coords);
  const keepFlags = new Array(coords.length).fill(false);
  keepFlags[0] = true;
  keepFlags[coords.length - 1] = true;
  dpRecurse(coords, keepFlags, 0, coords.length - 1, thresholdMeters, refLat);
  const result = [];
  for (let i = 0; i < coords.length; i++) {
    if (keepFlags[i]) result.push([coords[i][0], coords[i][1]]);
  }
  return result;
}

function dpRecurse(coords, keepFlags, start, end, toleranceMeters, refLat) {
  if (end - start <= 1) return;
  let maxDist = -1, maxIdx = -1;
  for (let i = start + 1; i < end; i++) {
    const dist = perpendicularDistanceMeters(coords[i], coords[start], coords[end], refLat);
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  if (maxIdx >= 0 && maxDist > toleranceMeters) {
    keepFlags[maxIdx] = true;
    dpRecurse(coords, keepFlags, start, maxIdx, toleranceMeters, refLat);
    dpRecurse(coords, keepFlags, maxIdx, end, toleranceMeters, refLat);
  }
}

export function describeOperationConsequence(kind, payload = {}) {
  switch (kind) {
    case 'rectangle-selection':
      return payload.selectionSpan?.ok
        ? `Selected ${payload.selectionSpan.pointCount} points from ${payload.selectionSpan.trackName}`
        : 'Drag to select a continuous working span';
    case 'simplify':
      return payload.selectionSpan?.ok
        ? `Simplify ${payload.selectionSpan.rangeLabel} with elevation extrema and max-gap guardrails`
        : 'Simplify the active track';
    case 'densify':
      return payload.selectionSpan?.ok
        ? `Add intermediate points inside ${payload.selectionSpan.rangeLabel} so no gap exceeds 5 m`
        : 'Add intermediate points across the active track';
    case 'split':
      return payload.selectionSpan?.ok
        ? `Split around ${payload.selectionSpan.rangeLabel}`
        : 'Split the active track';
    case 'merge':
      return payload.trackCount > 1
        ? `Merge ${payload.trackCount} tracks${payload.mode === 'segments' ? ' as segments' : ' into one segment'}`
        : 'Merge selected sibling tracks';
    case 'route-to-track':
      return payload.replace ? 'Replace route with track' : 'Create sibling track from route';
    default:
      return '';
  }
}