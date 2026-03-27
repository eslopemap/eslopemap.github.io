import { buildSelectionSpan } from './track-ops.js';

let map = null;
let deps = {};

let rectangleMode = false;
let dragStart = null;
let overlayEl = null;
let hintEl = null;
let pointerHandlersBound = false;
let currentSelection = null;
let currentPreviewText = '';

function ensureOverlay() {
  if (!overlayEl) {
    overlayEl = document.createElement('div');
    overlayEl.className = 'selection-rect-overlay';
    overlayEl.style.display = 'none';
    document.body.appendChild(overlayEl);
  }
  return overlayEl;
}

function ensureHint() {
  if (!hintEl) {
    hintEl = document.createElement('div');
    hintEl.className = 'selection-hint-popup';
    hintEl.style.display = 'none';
    hintEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) deps.onAction?.(btn.dataset.action);
    });
    document.body.appendChild(hintEl);
  }
  return hintEl;
}

function updateOverlay(startX, startY, currentX, currentY) {
  const overlay = ensureOverlay();
  overlay.style.left = Math.min(startX, currentX) + 'px';
  overlay.style.top = Math.min(startY, currentY) + 'px';
  overlay.style.width = Math.abs(currentX - startX) + 'px';
  overlay.style.height = Math.abs(currentY - startY) + 'px';
  overlay.style.display = 'block';
}

function hideOverlay() {
  if (overlayEl) overlayEl.style.display = 'none';
}

function hideHint() {
  if (hintEl) hintEl.style.display = 'none';
}

function renderHint(selectionSpan, anchorClientX, anchorClientY) {
  const hint = ensureHint();
  if (!selectionSpan?.ok) {
    hint.style.display = 'none';
    return;
  }
  const distanceText = selectionSpan.lengthMeters >= 1000
    ? `${(selectionSpan.lengthMeters / 1000).toFixed(2)} km`
    : `${Math.round(selectionSpan.lengthMeters)} m`;
  hint.innerHTML = [
    `<div class="selection-hint-title">${selectionSpan.trackName}</div>`,
    `<div>${selectionSpan.pointCount} pts · ${selectionSpan.rangeLabel} · ${distanceText}</div>`,
    `<div class="selection-hint-actions">`,
    `<button data-action="simplify" title="Simplify">≈</button>`,
    `<button data-action="densify" title="Densify">＋</button>`,
    `<button data-action="split" title="Split">✂</button>`,
    `</div>`,
  ].join('');
  hint.style.left = Math.round(anchorClientX + 12) + 'px';
  hint.style.top = Math.round(anchorClientY + 12) + 'px';
  hint.style.display = 'block';

  requestAnimationFrame(() => {
    const rect = hint.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 12;
    const maxTop = window.innerHeight - rect.height - 12;
    hint.style.left = Math.max(8, Math.min(anchorClientX + 12, maxLeft)) + 'px';
    hint.style.top = Math.max(8, Math.min(anchorClientY + 12, maxTop)) + 'px';
  });
}

function clearSelectionInternal(notify = true) {
  currentSelection = null;
  currentPreviewText = '';
  hideOverlay();
  hideHint();
  if (notify) deps.onSelectionChanged?.(null);
}

function resolveSelectionFromClientRect(x1, y1, x2, y2) {
  const track = deps.getActiveTrack?.();
  if (!track || !Array.isArray(track.coords) || track.coords.length < 1) return null;
  const canvasRect = map.getCanvas().getBoundingClientRect();
  const left = Math.min(x1, x2) - canvasRect.left;
  const top = Math.min(y1, y2) - canvasRect.top;
  const right = Math.max(x1, x2) - canvasRect.left;
  const bottom = Math.max(y1, y2) - canvasRect.top;
  if (Math.abs(right - left) < 6 || Math.abs(bottom - top) < 6) return null;

  const hits = [];
  for (let i = 0; i < track.coords.length; i++) {
    const point = map.project([track.coords[i][0], track.coords[i][1]]);
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
      hits.push(i);
    }
  }
  if (!hits.length) return null;
  const startIdx = Math.min(...hits);
  const endIdx = Math.max(...hits);
  const selectionSpan = buildSelectionSpan(track, startIdx, endIdx);
  if (!selectionSpan.ok) return null;
  return {
    trackId: track.id,
    sourceIndices: hits,
    selectionSpan,
    anchorClientX: x1 + (x2 - x1) / 2,
    anchorClientY: y1 + (y2 - y1) / 2,
  };
}

function completeDrag(endClientX, endClientY) {
  if (!dragStart) return;
  const selection = resolveSelectionFromClientRect(dragStart.clientX, dragStart.clientY, endClientX, endClientY);
  dragStart = null;
  hideOverlay();
  map.dragPan.enable();
  currentSelection = selection;
  if (!selection) {
    clearSelectionInternal(true);
    return;
  }
  renderHint(selection.selectionSpan, selection.anchorClientX, selection.anchorClientY);
  deps.onSelectionChanged?.(selection.selectionSpan);
}

function handleMouseDown(event) {
  if (!rectangleMode || deps.isSelectionBlocked?.()) return;
  if (event.button !== 0) return;
  dragStart = { clientX: event.clientX, clientY: event.clientY };
  updateOverlay(event.clientX, event.clientY, event.clientX, event.clientY);
  map.dragPan.disable();
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleMouseMove(event) {
  if (!dragStart) return;
  updateOverlay(dragStart.clientX, dragStart.clientY, event.clientX, event.clientY);
  event.preventDefault();
}

function handleMouseUp(event) {
  if (!dragStart) return;
  completeDrag(event.clientX, event.clientY);
  event.preventDefault();
}

function handleTouchStart(event) {
  if (!rectangleMode || deps.isSelectionBlocked?.()) return;
  if (event.touches.length !== 1) return;
  const touch = event.touches[0];
  dragStart = { clientX: touch.clientX, clientY: touch.clientY };
  updateOverlay(touch.clientX, touch.clientY, touch.clientX, touch.clientY);
  map.dragPan.disable();
}

function handleTouchMove(event) {
  if (!dragStart || event.touches.length !== 1) return;
  const touch = event.touches[0];
  updateOverlay(dragStart.clientX, dragStart.clientY, touch.clientX, touch.clientY);
  event.preventDefault();
}

function handleTouchEnd(event) {
  if (!dragStart) return;
  const touch = event.changedTouches[0];
  completeDrag(touch.clientX, touch.clientY);
}

function bindPointerHandlers() {
  if (pointerHandlersBound) return;
  pointerHandlersBound = true;
  const canvas = map.getCanvas();
  canvas.addEventListener('mousedown', handleMouseDown, { capture: true });
  window.addEventListener('mousemove', handleMouseMove, { passive: false });
  window.addEventListener('mouseup', handleMouseUp, { passive: false });
  canvas.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: true });
}

function syncCursor() {
  if (!map) return;
  if (rectangleMode && !deps.isSelectionBlocked?.()) {
    map.getCanvas().style.cursor = 'crosshair';
  } else if (!deps.keepSelectionCursor?.()) {
    map.getCanvas().style.cursor = '';
  }
}

export function initSelectionTools(mapRef, injectedDeps) {
  map = mapRef;
  deps = injectedDeps || {};
  ensureOverlay();
  ensureHint();
  bindPointerHandlers();

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (currentSelection) {
      clearSelectionInternal(true);
      event.preventDefault();
      return;
    }
    if (rectangleMode) {
      setRectangleMode(false);
      event.preventDefault();
    }
  });

  map.on('move', () => {
    if (currentSelection?.selectionSpan?.ok) {
      renderHint(currentSelection.selectionSpan, currentSelection.anchorClientX, currentSelection.anchorClientY);
    }
  });
}

export function setRectangleMode(active) {
  rectangleMode = Boolean(active);
  if (!rectangleMode) {
    dragStart = null;
    hideOverlay();
    map?.dragPan.enable();
  }
  syncCursor();
  deps.onModeChanged?.(rectangleMode);
}

export function toggleRectangleMode() {
  setRectangleMode(!rectangleMode);
  return rectangleMode;
}

export function isRectangleModeActive() {
  return rectangleMode;
}

export function clearSelection() {
  clearSelectionInternal(true);
}

export function getSelectionState() {
  return {
    rectangleMode,
    selectionSpan: currentSelection?.selectionSpan || null,
  };
}

export function setActionPreview(text) {
  currentPreviewText = text || '';
  if (currentSelection?.selectionSpan?.ok) {
    renderHint(currentSelection.selectionSpan, currentSelection.anchorClientX, currentSelection.anchorClientY);
  }
}