// Track editing: vertex interaction, insert popup/preview, hover-insert,
// mobile editing, keyboard shortcuts, draw/undo button handlers.
//
// Split from tracks.js — this module handles all *interactive* editing logic,
// while tracks.js keeps data model, CRUD, rendering, stats, and panel UI.

import { showCursorTooltipAt, hideCursorTooltip } from './ui.js';

let map, state;
let updateProfileFn = () => {};

// ---- References to tracks.js functions (wired at init) ----
let tracksFns = {};

// ---- Editing state ----
let editingTrackId = null;
let editingIsNewTrack = false;
let dragVertexInfo = null;
let mobileSelectedVertex = null;
let suppressMobileTouchEnd = false;
let suppressNextMapClick = false;
let hoverInsertInfo = null;
let selectedVertexIndex = null;
let insertAfterIdx = null;
let insertPopupMarker = null;
let insertPreviewLngLat = null;

const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
let mobileFriendlyMode = isMobile;

// DOM refs (resolved at init)
let drawBtn, undoBtn, mobileHint, drawCrosshair, toastEl;

// ---- Undo stack ----
// Stores snapshots of {trackId, coords (deep copy), selectedVertexIndex, insertAfterIdx}
const undoStack = [];
const MAX_UNDO = 50;

function pushUndo(trackId) {
  const t = tracksFns.findTrack(trackId);
  if (!t) return;
  undoStack.push({
    trackId,
    coords: t.coords.map(c => c.slice()),
    selectedVertexIndex,
    insertAfterIdx,
  });
  if (undoStack.length > MAX_UNDO) undoStack.splice(0, undoStack.length - MAX_UNDO);
}

function popUndo() {
  if (!undoStack.length) return false;
  const snap = undoStack.pop();
  const t = tracksFns.findTrack(snap.trackId);
  if (!t) return false;
  t.coords = snap.coords;
  selectedVertexIndex = snap.selectedVertexIndex;
  insertAfterIdx = snap.insertAfterIdx;
  tracksFns.onTrackCoordsChanged(t);
  syncUndoBtn();
  return true;
}

function clearUndoStack() {
  undoStack.length = 0;
}



let toastTimer = 0;
function showToast(msg, durationMs) {
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), durationMs || 2500);
}

// ---- Helpers ----

const HOVER_INSERT_SOURCE_ID = 'hover-insert-point';
const HOVER_INSERT_LAYER_ID = 'hover-insert-point-layer';

export function isTrackEditing(tId) {
  return tId != null && tId === editingTrackId;
}

function elevationAt(lngLat) {
  return tracksFns.elevationAt(lngLat);
}

// ---- Insert popup ----

function updateInsertPopup() {
  const t = editingTrackId ? tracksFns.findTrack(editingTrackId) : null;
  if (!t || selectedVertexIndex == null || selectedVertexIndex >= t.coords.length) {
    removeInsertPopup();
    return;
  }
  const coord = t.coords[selectedVertexIndex];
  const lngLat = [coord[0], coord[1]];
  if (!insertPopupMarker) {
    const el = document.createElement('div');
    el.className = 'vertex-insert-popup';
    el.innerHTML = '<button class="insert-popup-btn" title="Insert points after this vertex">+</button>';
    el.querySelector('.insert-popup-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (insertAfterIdx != null) {
        insertAfterIdx = null;
      } else if (selectedVertexIndex != null) {
        // Cancel mobile vertex drag and restore vertex position
        if (mobileSelectedVertex) {
          const vtxIdx = selectedVertexIndex;
          mobileSelectedVertex = null;
          mobileHint.classList.remove('visible');
          map.dragPan.enable();
          popUndo();  // restore vertex to original position before drag
          selectedVertexIndex = vtxIdx;
          insertAfterIdx = vtxIdx;
        } else {
          insertAfterIdx = selectedVertexIndex;
        }
      }
      syncUndoBtn();
    });
    insertPopupMarker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [8, 0] })
      .setLngLat(lngLat)
      .addTo(map);
  } else {
    insertPopupMarker.setLngLat(lngLat);
  }
  const btn = insertPopupMarker.getElement().querySelector('.insert-popup-btn');
  if (btn) btn.classList.toggle('active', insertAfterIdx != null);
}

function removeInsertPopup() {
  if (insertPopupMarker) {
    insertPopupMarker.remove();
    insertPopupMarker = null;
  }
}

// ---- Hover insert marker ----

function clearHoverInsertMarker() {
  hoverInsertInfo = null;
  const src = map.getSource(HOVER_INSERT_SOURCE_ID);
  if (src) src.setData({type: 'FeatureCollection', features: []});
}

function showHoverInsertMarker(lngLat) {
  const src = map.getSource(HOVER_INSERT_SOURCE_ID);
  if (src) {
    src.setData({type: 'FeatureCollection', features: [{
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [lngLat.lng, lngLat.lat]},
      properties: {}
    }]});
  }
}

// ---- Insert preview ----

function updateInsertPreview() {
  const src = map.getSource('insert-preview-line');
  if (!src) return;
  const t = editingTrackId ? tracksFns.findTrack(editingTrackId) : null;
  if (!t || !t.coords.length) { src.setData({type: 'FeatureCollection', features: []}); return; }

  let target = insertPreviewLngLat;
  if (mobileFriendlyMode && editingTrackId) {
    const center = map.getCenter();
    target = { lng: center.lng, lat: center.lat };
  }
  if (!target) { src.setData({type: 'FeatureCollection', features: []}); return; }

  const features = [];
  const tCoord = [target.lng, target.lat];

  if (insertAfterIdx != null && insertAfterIdx < t.coords.length) {
    const prev = t.coords[insertAfterIdx];
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[prev[0], prev[1]], tCoord] },
      properties: {}
    });
    if (insertAfterIdx + 1 < t.coords.length) {
      const next = t.coords[insertAfterIdx + 1];
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [tCoord, [next[0], next[1]]] },
        properties: {}
      });
    }
  } else if (t.coords.length > 0) {
    const last = t.coords[t.coords.length - 1];
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[last[0], last[1]], tCoord] },
      properties: {}
    });
  }
  src.setData({ type: 'FeatureCollection', features });
}

// ---- Closest point on track ----

function findClosestPointOnTrack(t, mousePoint) {
  if (!t || t.coords.length < 2) return null;
  let bestDist = Infinity;
  let bestLngLat = null;
  let bestSegment = -1;
  for (let i = 0; i < t.coords.length - 1; i++) {
    const a = map.project([t.coords[i][0], t.coords[i][1]]);
    const b = map.project([t.coords[i+1][0], t.coords[i+1][1]]);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let tp = 0;
    if (len2 > 0) {
      tp = ((mousePoint.x - a.x) * dx + (mousePoint.y - a.y) * dy) / len2;
      tp = Math.max(0, Math.min(1, tp));
    }
    if (tp < 0.1 || tp > 0.9) continue;
    const px = a.x + tp * dx, py = a.y + tp * dy;
    const dist = Math.sqrt((mousePoint.x - px) ** 2 + (mousePoint.y - py) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestLngLat = map.unproject([px, py]);
      bestSegment = i;
    }
  }
  if (bestDist < 20 && bestSegment >= 0) {
    return { lngLat: bestLngLat, insertAfter: bestSegment, distance: bestDist };
  }
  return null;
}

// ---- Vertex hit testing ----

function hitTestVertex(point) {
  const tId = editingTrackId;
  if (!tId) return null;
  const t = tracksFns.findTrack(tId);
  if (!t) return null;
  const layerId = tracksFns.trackPtsLayerId(t);
  if (!map.getLayer(layerId)) return null;
  const r = 12;
  const features = map.queryRenderedFeatures(
    [[point.x - r, point.y - r], [point.x + r, point.y + r]],
    { layers: [layerId] }
  );
  if (!features.length) return null;
  const real = features.find(f => f.properties.idx != null);
  if (real) return { trackId: t.id, index: real.properties.idx };
  return null;
}

// ---- Undo/UI sync ----

function syncUndoBtn() {
  if (!tracksFns.getActiveTrack) return; // not yet wired
  const t = tracksFns.getActiveTrack();
  const show = t && t.coords.length > 0 && isTrackEditing(t.id);
  undoBtn.style.display = show ? '' : 'none';
  undoBtn.disabled = undoStack.length === 0;

  tracksFns.updateVertexHighlight(editingTrackId, selectedVertexIndex);
  updateInsertPopup();
  updateInsertPreview();
}

function deleteCurrentVertex() {
  const t = tracksFns.getActiveTrack();
  if (!t || !t.coords.length) return;

  pushUndo(t.id);

  // Determine which index to delete:
  // 1. Selected vertex, 2. Insertion point, 3. Last point
  let delIdx;
  if (selectedVertexIndex != null && selectedVertexIndex < t.coords.length) {
    delIdx = selectedVertexIndex;
  } else if (insertAfterIdx != null && insertAfterIdx < t.coords.length) {
    delIdx = insertAfterIdx;
  } else {
    delIdx = t.coords.length - 1;
  }

  t.coords.splice(delIdx, 1);

  // Adjust selectedVertexIndex
  if (selectedVertexIndex != null) {
    if (delIdx < selectedVertexIndex) selectedVertexIndex--;
    else if (delIdx === selectedVertexIndex) {
      selectedVertexIndex = t.coords.length > 0
        ? Math.min(selectedVertexIndex, t.coords.length - 1)
        : null;
    }
  }
  // Adjust insertAfterIdx
  if (insertAfterIdx != null) {
    if (delIdx <= insertAfterIdx) {
      insertAfterIdx = Math.max(0, insertAfterIdx - 1);
    }
    if (t.coords.length === 0) insertAfterIdx = null;
  }

  tracksFns.onTrackCoordsChanged(t);
  if (t.coords.length === 0) tracksFns.deleteTrack(t.id);
  syncUndoBtn();
}

// ---- Edit mode ----

function setDefaultMapCursor() {
  if (!editingTrackId) map.getCanvas().style.cursor = 'cell';
}

export function enterEditMode(tId) {
  if (editingTrackId && editingTrackId !== tId) exitEditMode();
  editingTrackId = tId;
  selectedVertexIndex = null;
  insertAfterIdx = null;
  clearUndoStack();
  map.getCanvas().style.cursor = 'crosshair';
  drawBtn.classList.add('active');
  tracksFns.updateVertexHighlight(editingTrackId, selectedVertexIndex);
  tracksFns.renderTrackList();
  syncUndoBtn();
  if (mobileFriendlyMode) {
    drawCrosshair.classList.add('visible', 'editing');
    showToast('Tap anywhere to add a point at center', 3000);
  }
}

export function exitEditMode() {
  const wasNewTrack = editingIsNewTrack;
  editingIsNewTrack = false;
  selectedVertexIndex = null;
  insertAfterIdx = null;
  clearUndoStack();
  removeInsertPopup();
  drawBtn.classList.remove('active');
  setDefaultMapCursor();
  drawCrosshair.classList.remove('editing');
  if (!isMobile) drawCrosshair.classList.remove('visible');
  if (mobileSelectedVertex) cancelMobileMove();
  const t = editingTrackId ? tracksFns.findTrack(editingTrackId) : null;
  if (wasNewTrack && t && t.coords.length < 2) {
    tracksFns.removeIncompleteNewTrack(t);
  } else if (t) {
    updateProfileFn();
    if (wasNewTrack) {
      requestAnimationFrame(() => {
        tracksFns.openInfoForTrack?.(t.id, { preferFile: true });
      });
    }
  }
  editingTrackId = null;
  clearHoverInsertMarker();
  tracksFns.updateVertexHighlight(editingTrackId, selectedVertexIndex);
  tracksFns.renderTrackList();
  syncUndoBtn();
}

export function startNewTrack() {
  if (editingTrackId) exitEditMode();
  editingIsNewTrack = true;
  const defaultName = 'Track ' + (tracksFns.getTrackCount() + 1);
  const t = tracksFns.createNewTrack(defaultName);
  enterEditMode(t.id);
}

function cancelMobileMove() {
  mobileSelectedVertex = null;
  suppressMobileTouchEnd = false;
  mobileHint.classList.remove('visible');
  map.dragPan.enable();
  const t = tracksFns.getActiveTrack();
  if (t) { tracksFns.renderTrackList(); updateProfileFn(); syncUndoBtn(); }
}

// ---- Public API ----

export function getEditState() {
  return {
    get editingTrackId() { return editingTrackId; },
    get editingIsNewTrack() { return editingIsNewTrack; },
    get selectedVertexIndex() { return selectedVertexIndex; },
    get insertAfterIdx() { return insertAfterIdx; },
    get mobileFriendlyMode() { return mobileFriendlyMode; },
    isTrackEditing,
    enterEditMode,
    exitEditMode,
    startNewTrack,
    syncUndoBtn,
  };
}

// Exported for unit testing only
export const _testUndo = { pushUndo, popUndo, clearUndoStack, get undoStack() { return undoStack; } };

// ---- Init: wire up all editing event listeners ----

export function initTrackEdit(mapRef, stateRef, updateProfile, fns) {
  map = mapRef;
  state = stateRef;
  updateProfileFn = updateProfile;
  tracksFns = fns;

  drawBtn = document.getElementById('draw-btn');
  undoBtn = document.getElementById('undo-btn');
  mobileHint = document.getElementById('mobile-move-hint');
  toastEl = document.getElementById('toast');
  drawCrosshair = document.getElementById('draw-crosshair');

  // Show mobile-mode checkbox on localhost (non-mobile)
  const mobileModeRow = document.getElementById('mobile-mode-row');
  const mobileModeCheckbox = document.getElementById('mobileModeDesktop');
  if (mobileModeRow && isLocalhost && !isMobile) {
    mobileModeRow.style.display = '';
    mobileModeCheckbox.checked = mobileFriendlyMode;
  }

  // Button handlers
  drawBtn.addEventListener('click', () => {
    if (editingTrackId) exitEditMode();
    else startNewTrack();
  });

  undoBtn.addEventListener('click', () => {
    popUndo();
  });

  mobileModeCheckbox?.addEventListener('change', () => {
    mobileFriendlyMode = mobileModeCheckbox.checked;
    if (mobileFriendlyMode && editingTrackId) {
      drawCrosshair.classList.add('visible', 'editing');
      showToast('Tap anywhere to add a point at center', 3000);
    } else {
      drawCrosshair.classList.remove('editing');
      if (!isMobile) drawCrosshair.classList.remove('visible');
      if (mobileSelectedVertex) cancelMobileMove();
    }
    syncUndoBtn();
  });

  // Map click: add vertex or select vertex
  map.on('click', (e) => {
    if (suppressNextMapClick) {
      suppressNextMapClick = false;
      return;
    }

    if (editingTrackId) {
      // Don't add points while in rectangle selection mode
      if (tracksFns.isRectangleSelectionActive?.()) return;

      const t = tracksFns.findTrack(editingTrackId);
      if (!t) return;

      if (e.originalEvent.shiftKey || e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
        const hit = hitTestVertex(e.point);
        if (hit && hit.index != null) {
          pushUndo(t.id);
          t.coords.splice(hit.index, 1);
          if (selectedVertexIndex != null) {
            if (hit.index < selectedVertexIndex) selectedVertexIndex--;
            else if (hit.index === selectedVertexIndex) selectedVertexIndex = null;
          }
          if (insertAfterIdx != null) {
            if (hit.index <= insertAfterIdx) insertAfterIdx = Math.max(0, insertAfterIdx - 1);
          }
          tracksFns.onTrackCoordsChanged(t);
          if (t.coords.length === 0) tracksFns.deleteTrack(t.id);
        }
        return;
      }

      const hitPt = hitTestVertex(e.point);
      if (hitPt && hitPt.index != null) {
        if (mobileFriendlyMode) {
          if (mobileSelectedVertex && mobileSelectedVertex.index === hitPt.index) {
            // Second tap on same vertex — deselect and stop moving
            cancelMobileMove();
            selectedVertexIndex = null;
            insertAfterIdx = null;
          } else if (mobileSelectedVertex) {
            // Tap on a different vertex while moving — switch to new vertex
            cancelMobileMove();
            pushUndo(hitPt.trackId);
            selectedVertexIndex = hitPt.index;
            mobileSelectedVertex = hitPt;
            suppressMobileTouchEnd = true;
            mobileHint.textContent = 'Pan to move point \u00b7 tap vertex to deselect';
            mobileHint.classList.add('visible');
            map.dragPan.disable();
          } else {
            // First tap — select vertex and enter move mode
            pushUndo(hitPt.trackId);
            selectedVertexIndex = hitPt.index;
            mobileSelectedVertex = hitPt;
            suppressMobileTouchEnd = true;
            mobileHint.textContent = 'Pan to move point \u00b7 tap vertex to deselect';
            mobileHint.classList.add('visible');
            map.dragPan.disable();
            showToast('Pan to move, or tap + to insert after', 2500);
          }
          syncUndoBtn();
          return;
        }
        if (selectedVertexIndex === hitPt.index) {
          selectedVertexIndex = null;
          insertAfterIdx = null;
        } else {
          selectedVertexIndex = hitPt.index;
          if (insertAfterIdx != null) insertAfterIdx = hitPt.index;
        }
        syncUndoBtn();
        return;
      }

      if (mobileFriendlyMode && mobileSelectedVertex) {
        cancelMobileMove();
      }

      let insertLngLat = e.lngLat;
      if (mobileFriendlyMode) {
        insertLngLat = map.getCenter();
      }

      const ele = elevationAt(insertLngLat);
      pushUndo(t.id);
      if (insertAfterIdx != null) {
        t.coords.splice(insertAfterIdx + 1, 0, [insertLngLat.lng, insertLngLat.lat, ele]);
        insertAfterIdx++;
        selectedVertexIndex = insertAfterIdx;
      } else {
        t.coords.push([insertLngLat.lng, insertLngLat.lat, ele]);
      }
      tracksFns.onTrackCoordsChanged(t);
      syncUndoBtn();
      return;
    }
  });
  setDefaultMapCursor();

  map.on('dblclick', (e) => {
    if (editingTrackId) {
      e.preventDefault();
      exitEditMode();
      showToast('Editing stopped', 2000);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editingTrackId) exitEditMode();
    if (e.key === 'Escape' && mobileSelectedVertex) cancelMobileMove();
    if ((e.key === 'Delete' || e.key === 'Backspace') && isTrackEditing(tracksFns.getActiveTrack()?.id)) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      deleteCurrentVertex();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && isTrackEditing(tracksFns.getActiveTrack()?.id)) {
      e.preventDefault();
      popUndo();
    }
  });

  // Desktop: drag vertices + smart hover insert marker
  if (!isMobile) {
    let hoveredVertex = false;
    let dragMoved = false;
    let hoverInsertDrag = false;

    function finishVertexDrag() {
      if (!dragVertexInfo) return;
      const t = tracksFns.findTrack(dragVertexInfo.trackId);
      if (!dragMoved && t) {
        selectedVertexIndex = dragVertexInfo.index;
        if (insertAfterIdx != null) insertAfterIdx = dragVertexInfo.index;
      }
      dragVertexInfo = null;
      hoverInsertDrag = false;
      map.dragPan.enable();
      hoveredVertex = false;
      if (dragMoved) suppressNextMapClick = true;
      dragMoved = false;
      setDefaultMapCursor();
      if (t) {
        tracksFns.onTrackCoordsChanged(t);
        syncUndoBtn();
      }
    }

    map.on('mousedown', (e) => {
      if (!editingTrackId) return;
      // Ignore right-click — let map handle pan/rotate naturally
      if (e.originalEvent.button !== 0) return;

      const hit = hitTestVertex(e.point);
      if (hit && hit.index != null) {
        e.preventDefault();
        e.originalEvent.stopPropagation();
        pushUndo(hit.trackId);
        dragVertexInfo = hit;
        dragMoved = false;
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'grabbing';
        return;
      }

      if (hoverInsertInfo) {
        const hiPt = map.project([hoverInsertInfo.lngLat.lng, hoverInsertInfo.lngLat.lat]);
        const dist = Math.sqrt((e.point.x - hiPt.x) ** 2 + (e.point.y - hiPt.y) ** 2);
        if (dist < 20) {
          const t = tracksFns.findTrack(editingTrackId);
          if (t) {
            pushUndo(t.id);
            const ele = elevationAt(hoverInsertInfo.lngLat);
            t.coords.splice(hoverInsertInfo.insertAfter + 1, 0,
              [hoverInsertInfo.lngLat.lng, hoverInsertInfo.lngLat.lat, ele]);
            tracksFns.invalidateAndRefresh(t);
            e.preventDefault();
            e.originalEvent.stopPropagation();
            dragVertexInfo = { trackId: t.id, index: hoverInsertInfo.insertAfter + 1 };
            hoverInsertDrag = true;
            dragMoved = false;
            clearHoverInsertMarker();
            map.dragPan.disable();
            map.getCanvas().style.cursor = 'grabbing';
            return;
          }
        }
      }
    });

    map.on('mousemove', (e) => {
      if (dragVertexInfo) {
        const t = tracksFns.findTrack(dragVertexInfo.trackId);
        if (!t) return;
        const c = t.coords[dragVertexInfo.index];
        c[0] = e.lngLat.lng;
        c[1] = e.lngLat.lat;
        c[2] = elevationAt(e.lngLat);
        dragMoved = true;
        tracksFns.refreshTrackSource(t);
        return;
      }

      if (editingTrackId) {
        if (!mobileFriendlyMode) {
          insertPreviewLngLat = e.lngLat;
          updateInsertPreview();
        }
        const hit = hitTestVertex(e.point);
        const isRealVertex = Boolean(hit && hit.index != null);
        if (isRealVertex && !hoveredVertex) {
          hoveredVertex = true;
          clearHoverInsertMarker();
          map.getCanvas().style.cursor = 'grab';
        } else if (!isRealVertex && hoveredVertex) {
          hoveredVertex = false;
          map.getCanvas().style.cursor = 'crosshair';
        }

        if (!isRealVertex && !hoveredVertex) {
          const t = tracksFns.findTrack(editingTrackId);
          const closest = findClosestPointOnTrack(t, e.point);
          if (closest) {
            hoverInsertInfo = closest;
            showHoverInsertMarker(closest.lngLat);
            map.getCanvas().style.cursor = 'copy';
          } else {
            if (hoverInsertInfo) {
              clearHoverInsertMarker();
              map.getCanvas().style.cursor = 'crosshair';
            }
          }
        } else if (hoverInsertInfo) {
          clearHoverInsertMarker();
        }
      }
    });

    map.on('mouseup', (e) => {
      finishVertexDrag();
    });

    window.addEventListener('mouseup', (e) => {
      finishVertexDrag();
    });
  }

  // Mobile: vertex interaction
  if (isMobile) {
    let touchLongPressTimer = null;
    let touchStartPt = null;
    let mobileDragVertex = null;

    map.getCanvas().addEventListener('touchstart', (e) => {
      if (!editingTrackId) return;

      if (mobileFriendlyMode) return;
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = map.getCanvas().getBoundingClientRect();
      const pt = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      touchStartPt = pt;
      const hit = hitTestVertex(pt);
      if (hit && hit.index != null) {
        touchLongPressTimer = setTimeout(() => {
          pushUndo(hit.trackId);
          mobileDragVertex = { ...hit, screenX: touch.clientX, screenY: touch.clientY };
          map.dragPan.disable();
          showToast('Drag to move point', 1500);
        }, 400);
      }
    }, { passive: true });

    map.getCanvas().addEventListener('touchmove', (e) => {
      if (touchLongPressTimer && touchStartPt) {
        const touch = e.touches[0];
        const rect = map.getCanvas().getBoundingClientRect();
        const dx = touch.clientX - rect.left - touchStartPt.x;
        const dy = touch.clientY - rect.top - touchStartPt.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          clearTimeout(touchLongPressTimer);
          touchLongPressTimer = null;
        }
      }
      if (mobileDragVertex && e.touches.length === 1) {
        const touch = e.touches[0];
        const rect = map.getCanvas().getBoundingClientRect();
        const pt = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
        const lngLat = map.unproject([pt.x, pt.y]);
        const t = tracksFns.findTrack(mobileDragVertex.trackId);
        if (t) {
          const c = t.coords[mobileDragVertex.index];
          c[0] = lngLat.lng;
          c[1] = lngLat.lat;
          c[2] = elevationAt(lngLat);
          tracksFns.invalidateAndRefresh(t);
        }
        e.preventDefault();
      }
    }, { passive: false });

    map.getCanvas().addEventListener('touchend', (e) => {
      if (touchLongPressTimer) {
        clearTimeout(touchLongPressTimer);
        touchLongPressTimer = null;
      }
      if (mobileDragVertex) {
        const t = tracksFns.findTrack(mobileDragVertex.trackId);
        mobileDragVertex = null;
        map.dragPan.enable();
        if (t) {
          tracksFns.onTrackCoordsChanged(t);
          syncUndoBtn();
        }
      }
      touchStartPt = null;
    }, { passive: true });

    map.on('move', () => {
      if (!mobileSelectedVertex) return;
      const t = tracksFns.findTrack(mobileSelectedVertex.trackId);
      if (!t) return;
      const center = map.getCenter();
      const c = t.coords[mobileSelectedVertex.index];
      c[0] = center.lng;
      c[1] = center.lat;
      c[2] = elevationAt(center);
      tracksFns.invalidateAndRefresh(t);
    });

    map.on('touchend', () => {
      if (!mobileSelectedVertex) return;
      if (suppressMobileTouchEnd) {
        suppressMobileTouchEnd = false;
        return;
      }
      cancelMobileMove();
    });
  }

  // Suppress context menu during track editing so right-click = pan
  map.getCanvas().addEventListener('contextmenu', (e) => {
    if (editingTrackId) e.preventDefault();
  });

  // Update insert preview on map move (for mobile-friendly crosshair mode)
  map.on('move', () => {
    if (mobileFriendlyMode && editingTrackId) {
      updateInsertPreview();
    }
  });
}
