import {
  buildTreeFromLegacy,
  findNodeById,
  findParentOf,
  resolveActionTargets,
  resolveDescendantsByType,
} from '../../js/gpx-model.js';

describe('gpx-model', () => {
  it('builds file and track nodes for ungrouped tracks', () => {
    const workspace = buildTreeFromLegacy([
      { id: 'trk-1', name: 'Solo Track' },
    ], []);

    expect(workspace.children).toHaveLength(1);

    const fileNode = workspace.children[0];
    expect(fileNode.type).toBe('file');
    expect(fileNode.name).toBe('Solo Track');
    expect(fileNode.children).toHaveLength(1);

    const trackNode = fileNode.children[0];
    expect(trackNode.type).toBe('track');
    expect(trackNode.name).toBe('Solo Track');
    expect(trackNode._legacyTrackIds).toEqual(['trk-1']);
  });

  it('groups segmented tracks under one file and track node', () => {
    const workspace = buildTreeFromLegacy([
      { id: 'seg-1', name: 'Stage', groupId: 'grp-1', groupName: 'Traverse' },
      { id: 'seg-2', name: 'Stage', groupId: 'grp-1', groupName: 'Traverse' },
    ], []);

    expect(workspace.children).toHaveLength(1);

    const [fileNode] = workspace.children;
    const [trackNode] = fileNode.children;
    expect(fileNode.name).toBe('Traverse');
    expect(trackNode.name).toBe('Traverse');
    expect(trackNode._legacyTrackIds).toEqual(['seg-1', 'seg-2']);
    expect(trackNode.children).toHaveLength(2);
    expect(trackNode.children.map(child => child.type)).toEqual(['segment', 'segment']);
    expect(trackNode.children.map(child => child._legacyTrackId)).toEqual(['seg-1', 'seg-2']);
  });

  it('attaches waypoints to the workspace root with persisted waypoint ids', () => {
    const workspace = buildTreeFromLegacy([], [
      {
        id: 'wpt-1',
        name: 'Cabin',
        desc: 'Shelter',
        comment: 'Open in summer',
        sym: 'Lodge',
        coords: [6.8, 45.9, 1200],
      },
    ]);

    expect(workspace.children).toHaveLength(1);
    const waypointNode = workspace.children[0];
    expect(waypointNode.type).toBe('waypoint');
    expect(waypointNode.name).toBe('Cabin');
    expect(waypointNode.desc).toBe('Shelter');
    expect(waypointNode.cmt).toBe('Open in summer');
    expect(waypointNode.sym).toBe('Lodge');
    expect(waypointNode._waypointId).toBe('wpt-1');
  });

  it('supports lookup and descendant resolution helpers', () => {
    const workspace = buildTreeFromLegacy([
      { id: 'seg-1', name: 'Stage', groupId: 'grp-1', groupName: 'Traverse' },
      { id: 'seg-2', name: 'Stage', groupId: 'grp-1', groupName: 'Traverse' },
    ], []);

    const [fileNode] = workspace.children;
    const [trackNode] = fileNode.children;
    const [segmentNode] = trackNode.children;

    expect(findNodeById(workspace.children, trackNode.id)).toBe(trackNode);
    expect(findParentOf(workspace.children, trackNode.id)).toBe(fileNode);
    expect(findParentOf(workspace.children, segmentNode.id)).toBe(trackNode);
    expect(resolveDescendantsByType(fileNode, 'segment')).toEqual(trackNode.children);
  });

  it('resolves selected action targets from workspace ids', () => {
    const workspace = buildTreeFromLegacy([
      { id: 'trk-1', name: 'Solo Track' },
    ], []);
    const selectedId = workspace.children[0].children[0].id;

    const result = resolveActionTargets(workspace, [selectedId, 'missing-id'], 'trk-1');

    expect(result.selectedNodeIds).toEqual([selectedId, 'missing-id']);
    expect(result.activeTrackId).toBe('trk-1');
    expect(result.selectionSpan).toBeNull();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe(selectedId);
  });
});
