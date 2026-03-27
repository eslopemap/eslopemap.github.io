// GPX workspace tree renderer, context menu, and Info editor.
// Renders a hierarchical tree in the track panel area, with disclosure, context menus, and Info editing.

import {
  createWorkspaceModel, createFileNode, createTrackNode, createSegmentNode,
  createRouteNode, createWaypointNode, createFolderNode,
  walkNodes, findNodeById, findParentOf, buildTreeFromLegacy,
} from './gpx-model.js';
import { saveWorkspace, loadWorkspace } from './persist.js';

let workspace = createWorkspaceModel();
let treeState = {
  expandedNodeIds: new Set(),
  selectedNodeId: null,
  contextMenu: null,    // { nodeId, x, y }
  infoEditor: null,     // { nodeId }
};

let _deps = {};   // injected from tracks.js
let _trackListEl = null;
let _contextMenuEl = null;
let _infoOverlayEl = null;
let _scheduleSave = null;

// Node type icons
const NODE_ICONS = {
  folder: '📁',
  file: '📄',
  track: '🛤️',
  segment: '┗',
  route: '🧭',
  waypoint: '📍',
};

// ---- Public API ----

export function initGpxTree(deps) {
  _deps = deps;
  _trackListEl = document.getElementById('track-list');
  _scheduleSave = deps.scheduleSave;

  // Create context menu element
  _contextMenuEl = document.createElement('div');
  _contextMenuEl.id = 'tree-context-menu';
  _contextMenuEl.className = 'tree-context-menu';
  document.body.appendChild(_contextMenuEl);

  // Create Info editor overlay
  _infoOverlayEl = document.createElement('div');
  _infoOverlayEl.id = 'info-editor-overlay';
  _infoOverlayEl.className = 'info-editor-overlay';
  document.body.appendChild(_infoOverlayEl);

  // Close context menu on outside click
  document.addEventListener('click', (e) => {
    if (_contextMenuEl.classList.contains('visible') && !_contextMenuEl.contains(e.target)) {
      closeContextMenu();
    }
  });
  document.addEventListener('contextmenu', (e) => {
    if (_contextMenuEl.classList.contains('visible') && !_contextMenuEl.contains(e.target)) {
      closeContextMenu();
    }
  });

  // Build initial tree from legacy tracks
  rebuildTree();
}

export function getWorkspace() { return workspace; }

export function rebuildTree() {
  const tracks = _deps.getTracks();
  const waypoints = _deps.getWaypoints();
  workspace = buildTreeFromLegacy(tracks, waypoints);

  // Restore persisted workspace metadata if available
  const saved = loadWorkspace();
  if (saved?.children) {
    mergePersistedMetadata(workspace.children, saved.children);
  }

  // Auto-expand all
  walkNodes(workspace.children, n => {
    if (n.children) treeState.expandedNodeIds.add(n.id);
  });
}

function mergePersistedMetadata(liveNodes, savedNodes) {
  // Match saved nodes by position/type and restore metadata fields
  for (let i = 0; i < liveNodes.length && i < savedNodes.length; i++) {
    const live = liveNodes[i];
    const saved = savedNodes[i];
    if (live.type !== saved.type) continue;
    // Restore editable metadata
    if (saved.desc) live.desc = saved.desc;
    if (saved.cmt) live.cmt = saved.cmt;
    if (saved.trkType) live.trkType = saved.trkType;
    if (saved.rteType) live.rteType = saved.rteType;
    if (saved.wptType) live.wptType = saved.wptType;
    if (saved.sym) live.sym = saved.sym;
    // Recurse into children
    if (live.children && saved.children) {
      mergePersistedMetadata(live.children, saved.children);
    }
  }
}

export function renderGpxTree() {
  if (!_trackListEl) return;
  _trackListEl.innerHTML = '';
  renderNodeList(workspace.children, _trackListEl, 0);
}

export function syncTreeSelection() {
  const items = _trackListEl?.querySelectorAll('.tree-row');
  if (!items) return;
  items.forEach(row => {
    const nodeId = row.dataset.nodeId;
    row.classList.toggle('selected', nodeId === treeState.selectedNodeId);
  });
}

export function openNodeContextMenu(nodeId, x, y) {
  const node = findNodeById(workspace.children, nodeId);
  if (!node) return;

  treeState.contextMenu = { nodeId, x, y };
  _contextMenuEl.innerHTML = '';

  const items = getContextMenuItems(node);
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'ctx-separator';
      _contextMenuEl.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'ctx-item';
    btn.textContent = item.label;
    if (item.disabled) btn.disabled = true;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeContextMenu();
      item.action();
    });
    _contextMenuEl.appendChild(btn);
  }

  // Position
  _contextMenuEl.style.left = x + 'px';
  _contextMenuEl.style.top = y + 'px';
  _contextMenuEl.classList.add('visible');

  // Adjust if off-screen
  requestAnimationFrame(() => {
    const rect = _contextMenuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      _contextMenuEl.style.left = Math.max(0, x - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      _contextMenuEl.style.top = Math.max(0, y - rect.height) + 'px';
    }
  });
}

export function openInfoEditor(nodeId) {
  const node = findNodeById(workspace.children, nodeId);
  if (!node) return;
  treeState.infoEditor = { nodeId };
  renderInfoEditor(node);
}

export function closeInfoEditor() {
  treeState.infoEditor = null;
  _infoOverlayEl.classList.remove('visible');
  _infoOverlayEl.innerHTML = '';
}

// ---- Context menu helpers ----

function closeContextMenu() {
  treeState.contextMenu = null;
  _contextMenuEl.classList.remove('visible');
}

function getContextMenuItems(node) {
  const items = [];

  // Info (all except segment)
  if (node.type !== 'segment') {
    items.push({ label: 'ℹ Info…', action: () => openInfoEditor(node.id) });
  }

  // Type-specific actions
  if (node.type === 'track' || node.type === 'segment' || node.type === 'route') {
    const legacyId = node._legacyTrackId || (node._legacyTrackIds?.[0]);
    if (legacyId) {
      items.push({ separator: true });
      items.push({
        label: '✎ Edit',
        action: () => _deps.enterEditForTrack(legacyId),
      });
      items.push({
        label: '📈 Profile',
        action: () => _deps.showProfileForTrack(legacyId),
      });
      items.push({
        label: '🔎 Zoom to',
        action: () => _deps.fitToTrackById(legacyId),
      });
    }
  }

  if (node.type === 'file' || node.type === 'folder') {
    items.push({ separator: true });
    items.push({
      label: '🔎 Zoom to all',
      action: () => {
        // Zoom to all tracks in this node
        const ids = collectLegacyTrackIds(node);
        if (ids.length) _deps.fitToTrackById(ids[0]);
      },
    });
  }

  // Delete
  if (node.type !== 'segment') {
    items.push({ separator: true });
    items.push({
      label: '🗑 Delete',
      action: () => deleteNode(node),
    });
  }

  return items;
}

function collectLegacyTrackIds(node) {
  const ids = [];
  if (node._legacyTrackId) ids.push(node._legacyTrackId);
  if (node._legacyTrackIds) ids.push(...node._legacyTrackIds);
  if (node.children) {
    for (const c of node.children) ids.push(...collectLegacyTrackIds(c));
  }
  return ids;
}

function deleteNode(node) {
  const ids = collectLegacyTrackIds(node);
  const name = node.name || node.type;
  if (!confirm(`Delete "${name}"${ids.length > 1 ? ` (${ids.length} tracks)` : ''}?`)) return;
  for (const id of ids) _deps.deleteTrackById(id);
  // Remove from workspace
  removeNodeFromTree(workspace.children, node.id);
  scheduleWorkspaceSave();
  renderGpxTree();
}

function removeNodeFromTree(nodes, id) {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) { nodes.splice(i, 1); return true; }
    if (nodes[i].children && removeNodeFromTree(nodes[i].children, id)) return true;
  }
  return false;
}

// ---- Info editor ----

const INFO_FIELDS = {
  folder: ['name'],
  file: ['name', 'desc'],
  track: ['name', 'desc', 'cmt', 'trkType'],
  route: ['name', 'desc', 'cmt', 'rteType'],
  waypoint: ['name', 'desc', 'cmt', 'sym', 'wptType'],
};

const FIELD_LABELS = {
  name: 'Name',
  desc: 'Description',
  cmt: 'Comment',
  trkType: 'Type',
  rteType: 'Type',
  wptType: 'Type',
  sym: 'Symbol',
};

function renderInfoEditor(node) {
  const fields = INFO_FIELDS[node.type] || ['name'];
  _infoOverlayEl.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'info-editor-panel';

  const title = document.createElement('h3');
  title.textContent = `${NODE_ICONS[node.type] || ''} ${node.type.charAt(0).toUpperCase() + node.type.slice(1)} Info`;
  panel.appendChild(title);

  const inputs = {};
  for (const field of fields) {
    const row = document.createElement('div');
    row.className = 'info-field-row';
    const label = document.createElement('label');
    label.textContent = FIELD_LABELS[field] || field;
    label.setAttribute('for', `info-${field}`);
    row.appendChild(label);

    if (field === 'desc' || field === 'cmt') {
      const textarea = document.createElement('textarea');
      textarea.id = `info-${field}`;
      textarea.value = node[field] || '';
      textarea.rows = 3;
      row.appendChild(textarea);
      inputs[field] = textarea;
    } else {
      const input = document.createElement('input');
      input.id = `info-${field}`;
      input.type = 'text';
      input.value = node[field] || '';
      row.appendChild(input);
      inputs[field] = input;
    }
    panel.appendChild(row);
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'info-btn-row';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'info-save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    applyInfoEdits(node, inputs);
    closeInfoEditor();
  });
  btnRow.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'info-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => closeInfoEditor());
  btnRow.appendChild(cancelBtn);

  panel.appendChild(btnRow);
  _infoOverlayEl.appendChild(panel);
  _infoOverlayEl.classList.add('visible');

  // Focus first input
  const firstInput = panel.querySelector('input, textarea');
  if (firstInput) {
    firstInput.focus();
    if (firstInput.tagName === 'INPUT') firstInput.select();
  }

  // Esc to close
  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      closeInfoEditor();
      document.removeEventListener('keydown', handleKeydown);
    }
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      applyInfoEdits(node, inputs);
      closeInfoEditor();
      document.removeEventListener('keydown', handleKeydown);
    }
    e.stopPropagation();
  };
  document.addEventListener('keydown', handleKeydown);
}

function applyInfoEdits(node, inputs) {
  let nameChanged = false;
  for (const [field, el] of Object.entries(inputs)) {
    const val = el.value.trim();
    if (field === 'name' && val && val !== node.name) {
      nameChanged = true;
      node.name = val;
      // Sync back to legacy track
      syncNameToLegacy(node, val);
    } else {
      node[field] = val;
    }
  }
  scheduleWorkspaceSave();
  if (nameChanged) _deps.renderTrackList();
  renderGpxTree();
}

function syncNameToLegacy(node, name) {
  if (node._legacyTrackId) {
    _deps.renameTrackById(node._legacyTrackId, name);
  }
  if (node._legacyTrackIds?.length) {
    // Rename the group/file
    for (const id of node._legacyTrackIds) {
      _deps.renameGroupByTrackId(id, name);
    }
  }
}

// ---- Tree rendering ----

function renderNodeList(nodes, container, depth) {
  for (const node of nodes) {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.nodeId = node.id;
    row.style.paddingLeft = (8 + depth * 16) + 'px';

    // Determine if this node maps to the active track
    const activeTrackId = _deps.getActiveTrackId?.();
    const isActive = (node._legacyTrackId === activeTrackId) ||
      (node._legacyTrackIds?.includes(activeTrackId));
    if (isActive) row.classList.add('active');

    if (treeState.selectedNodeId === node.id) row.classList.add('selected');

    // Disclosure toggle
    const hasChildren = node.children?.length > 0;
    const expanded = treeState.expandedNodeIds.has(node.id);

    if (hasChildren) {
      const toggle = document.createElement('span');
      toggle.className = 'tree-toggle';
      toggle.textContent = expanded ? '▾' : '▸';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (expanded) treeState.expandedNodeIds.delete(node.id);
        else treeState.expandedNodeIds.add(node.id);
        renderGpxTree();
      });
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'tree-toggle-spacer';
      row.appendChild(spacer);
    }

    // Icon
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = NODE_ICONS[node.type] || '';
    row.appendChild(icon);

    // Name + stats
    const nameEl = document.createElement('span');
    nameEl.className = 'tree-name';

    if (node.type === 'segment') {
      const legacyTrack = node._legacyTrackId ? _deps.findTrack(node._legacyTrackId) : null;
      nameEl.textContent = legacyTrack?.segmentLabel || 'Segment';
      appendStatsSpan(nameEl, legacyTrack);
    } else if (node.type === 'waypoint') {
      nameEl.textContent = node.name || 'Waypoint';
    } else if (node.type === 'track') {
      nameEl.textContent = node.name || 'Track';
      // Aggregate stats for multi-segment tracks
      if (node._legacyTrackIds?.length > 1) {
        appendAggregateStats(nameEl, node._legacyTrackIds);
      } else if (node._legacyTrackIds?.length === 1) {
        const t = _deps.findTrack(node._legacyTrackIds[0]);
        appendStatsSpan(nameEl, t);
      }
    } else {
      nameEl.textContent = node.name || node.type;
    }
    row.appendChild(nameEl);

    // Kebab menu button
    if (node.type !== 'segment') {
      const kebab = document.createElement('button');
      kebab.className = 'tree-kebab';
      kebab.textContent = '⋮';
      kebab.title = 'Actions';
      kebab.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = kebab.getBoundingClientRect();
        openNodeContextMenu(node.id, rect.left, rect.bottom + 2);
      });
      row.appendChild(kebab);
    }

    // Click to select/activate
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('tree-kebab') || e.target.classList.contains('tree-toggle')) return;
      treeState.selectedNodeId = node.id;
      // Activate the legacy track if applicable
      const legacyId = node._legacyTrackId || node._legacyTrackIds?.[0];
      if (legacyId) _deps.setActiveTrack(legacyId);
      syncTreeSelection();
    });

    // Right-click context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openNodeContextMenu(node.id, e.clientX, e.clientY);
    });

    // Long-press for mobile context menu
    let longPressTimer = null;
    row.addEventListener('touchstart', (e) => {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        const touch = e.touches[0];
        openNodeContextMenu(node.id, touch.clientX, touch.clientY);
      }, 600);
    }, { passive: true });
    row.addEventListener('touchend', () => { if (longPressTimer) clearTimeout(longPressTimer); });
    row.addEventListener('touchmove', () => { if (longPressTimer) clearTimeout(longPressTimer); });

    container.appendChild(row);

    // Render children
    if (hasChildren && expanded) {
      renderNodeList(node.children, container, depth + 1);
    }
  }
}

function appendStatsSpan(nameEl, track) {
  if (!track) return;
  const stats = _deps.trackStats(track);
  if (stats) {
    const sp = document.createElement('span');
    sp.className = 'tree-stats';
    sp.textContent = ` ${stats.dist.toFixed(1)} km · ↑${Math.round(stats.gain)} m · ↓${Math.round(stats.loss)} m`;
    nameEl.appendChild(sp);
  }
}

function appendAggregateStats(nameEl, legacyTrackIds) {
  let totalDist = 0, totalGain = 0, totalLoss = 0;
  for (const id of legacyTrackIds) {
    const t = _deps.findTrack(id);
    if (!t) continue;
    const s = _deps.trackStats(t);
    if (s) { totalDist += s.dist; totalGain += s.gain; totalLoss += s.loss; }
  }
  if (totalDist > 0) {
    const sp = document.createElement('span');
    sp.className = 'tree-stats';
    sp.textContent = ` ${totalDist.toFixed(1)} km · ↑${Math.round(totalGain)} m · ↓${Math.round(totalLoss)} m`;
    nameEl.appendChild(sp);
  }
}

function scheduleWorkspaceSave() {
  saveWorkspace(workspace);
  if (_scheduleSave) _scheduleSave();
}

// ---- Hooks for tracks.js to call ----

export function onTrackCreated(track) {
  // If it's a grouped track, let rebuildTree handle it
  if (track.groupId) { rebuildTree(); renderGpxTree(); return; }
  // Single track — add a file + track node
  const fileNode = createFileNode(track.name);
  const trackNode = createTrackNode(track.name, { _legacyTrackIds: [track.id] });
  fileNode.children.push(trackNode);
  workspace.children.push(fileNode);
  treeState.expandedNodeIds.add(fileNode.id);
  treeState.expandedNodeIds.add(trackNode.id);
  scheduleWorkspaceSave();
  renderGpxTree();
}

export function onTrackDeleted(trackId) {
  // Remove nodes that reference this track
  removeNodesForTrack(workspace.children, trackId);
  scheduleWorkspaceSave();
  renderGpxTree();
}

function removeNodesForTrack(nodes, trackId) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node._legacyTrackId === trackId) { nodes.splice(i, 1); continue; }
    if (node._legacyTrackIds) {
      const idx = node._legacyTrackIds.indexOf(trackId);
      if (idx >= 0) node._legacyTrackIds.splice(idx, 1);
      if (node._legacyTrackIds.length === 0 && node.type === 'track') {
        nodes.splice(i, 1); continue;
      }
    }
    if (node.children) {
      removeNodesForTrack(node.children, trackId);
      // Remove empty file/folder nodes
      if ((node.type === 'file' || node.type === 'folder') && node.children.length === 0) {
        nodes.splice(i, 1);
      }
    }
  }
}

export function onImportComplete() {
  rebuildTree();
  renderGpxTree();
}
