// GPX workspace tree model.
// Defines node shapes, stable IDs, traversal helpers, and action-target resolution.

let _idCounter = 0;
function uid(prefix) {
  return `${prefix}-${Date.now()}-${(++_idCounter).toString(36)}`;
}

// ---- Node constructors ----

export function createWorkspaceModel() {
  return { children: [] };
}

export function createFolderNode(name) {
  return { id: uid('folder'), type: 'folder', name, children: [], expanded: true };
}

export function createFileNode(name, opts) {
  return {
    id: uid('file'), type: 'file', name,
    desc: opts?.desc || '',
    children: [],
    expanded: true,
  };
}

export function createTrackNode(name, opts) {
  return {
    id: uid('trk'), type: 'track', name,
    desc: opts?.desc || '', cmt: opts?.cmt || '', trkType: opts?.trkType || '',
    children: [],   // segment children
    expanded: true,
    // back-ref to legacy track objects for map rendering
    _legacyTrackIds: opts?._legacyTrackIds || [],
  };
}

export function createSegmentNode(opts) {
  return {
    id: uid('seg'), type: 'segment',
    // segments have no name in GPX 1.1
    _legacyTrackId: opts?._legacyTrackId || null,
  };
}

export function createRouteNode(name, opts) {
  return {
    id: uid('rte'), type: 'route', name,
    desc: opts?.desc || '', cmt: opts?.cmt || '', rteType: opts?.rteType || '',
    _legacyTrackId: opts?._legacyTrackId || null,
  };
}

export function createWaypointNode(name, opts) {
  return {
    id: uid('wpt'), type: 'waypoint', name,
    desc: opts?.desc || '', cmt: opts?.cmt || '',
    sym: opts?.sym || '', wptType: opts?.wptType || '',
    coords: opts?.coords || null,
    _waypointId: opts?._waypointId || null,
  };
}

// ---- Tree traversal ----

export function walkNodes(roots, fn) {
  for (const node of roots) {
    fn(node);
    if (node.children) walkNodes(node.children, fn);
  }
}

export function findNodeById(roots, id) {
  for (const node of roots) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findParentOf(roots, id) {
  for (const node of roots) {
    if (node.children) {
      for (const child of node.children) {
        if (child.id === id) return node;
      }
      const found = findParentOf(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function getNodeChildren(node) {
  return node?.children || [];
}

// ---- Descendant resolution by type ----

export function resolveDescendantsByType(node, type) {
  const result = [];
  if (!node?.children) return result;
  walkNodes(node.children, n => { if (n.type === type) result.push(n); });
  return result;
}

// ---- Action target resolution (future-compatible shell) ----

export function resolveActionTargets(workspace, selectedNodeIds, activeTrackId) {
  return {
    selectedNodeIds: [...selectedNodeIds],
    activeTrackId,
    selectionSpan: null,    // placeholder for FEAT2
    nodes: selectedNodeIds.map(id => findNodeById(workspace.children, id)).filter(Boolean),
  };
}

// ---- Build tree from legacy tracks/waypoints ----

export function buildTreeFromLegacy(tracks, waypoints) {
  const workspace = createWorkspaceModel();
  const groupMap = new Map();  // groupId → fileNode + trackNode

  for (const t of tracks) {
    if ((t.sourceKind || 'track') === 'route') {
      const fileNode = createFileNode(t.name, { desc: t.desc || '' });
      const routeNode = createRouteNode(t.name, {
        desc: t.desc || '',
        cmt: t.cmt || '',
        rteType: t.rteType || '',
        _legacyTrackId: t.id,
      });
      fileNode.children.push(routeNode);
      workspace.children.push(fileNode);
      continue;
    }
    if (t.groupId) {
      if (!groupMap.has(t.groupId)) {
        const fileNode = createFileNode(t.groupName || t.name);
        const trackNode = createTrackNode(t.groupName || t.name, {
          desc: t.desc || '',
          cmt: t.cmt || '',
          trkType: t.trkType || '',
          _legacyTrackIds: [],
        });
        fileNode.children.push(trackNode);
        workspace.children.push(fileNode);
        groupMap.set(t.groupId, { fileNode, trackNode });
      }
      const { trackNode } = groupMap.get(t.groupId);
      const segNode = createSegmentNode({ _legacyTrackId: t.id });
      trackNode.children.push(segNode);
      trackNode._legacyTrackIds.push(t.id);
    } else {
      const fileNode = createFileNode(t.name, { desc: t.desc || '' });
      const trackNode = createTrackNode(t.name, {
        desc: t.desc || '',
        cmt: t.cmt || '',
        trkType: t.trkType || '',
        _legacyTrackIds: [t.id],
      });
      fileNode.children.push(trackNode);
      workspace.children.push(fileNode);
    }
  }

  // Attach waypoints to workspace root (or could be per-file in future)
  for (const wp of waypoints) {
    workspace.children.push(createWaypointNode(wp.name, {
      desc: wp.desc, cmt: wp.comment, sym: wp.sym,
      coords: wp.coords,
      _waypointId: wp.id,
    }));
  }

  return workspace;
}
