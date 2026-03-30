import {
  createWorkspaceModel,
  createFileNode,
  createTrackNode,
  createSegmentNode,
  createWaypointNode,
  findNodeById,
  findParentOf,
  resolveActionTargets,
  resolveDescendantsByType,
} from '../../js/gpx-model.js';

describe('gpx-model', () => {
  it('supports lookup and descendant resolution helpers', () => {
    const workspace = createWorkspaceModel();
    const fileNode = createFileNode('Traverse');
    const trackNode = createTrackNode('Traverse', { _trackIds: ['seg-1', 'seg-2'] });
    trackNode.children.push(
      createSegmentNode({ _trackId: 'seg-1' }),
      createSegmentNode({ _trackId: 'seg-2' }),
    );
    fileNode.children.push(trackNode);
    workspace.children.push(fileNode);

    const [segmentNode] = trackNode.children;

    expect(findNodeById(workspace.children, trackNode.id)).toBe(trackNode);
    expect(findParentOf(workspace.children, trackNode.id)).toBe(fileNode);
    expect(findParentOf(workspace.children, segmentNode.id)).toBe(trackNode);
    expect(resolveDescendantsByType(fileNode, 'segment')).toEqual(trackNode.children);
  });

  it('resolves selected action targets from workspace ids', () => {
    const workspace = createWorkspaceModel();
    const fileNode = createFileNode('Solo Track');
    const trackNode = createTrackNode('Solo Track', { _trackIds: ['trk-1'] });
    fileNode.children.push(trackNode);
    workspace.children.push(fileNode);
    const selectedId = trackNode.id;

    const result = resolveActionTargets(workspace, [selectedId, 'missing-id'], 'trk-1');

    expect(result.selectedNodeIds).toEqual([selectedId, 'missing-id']);
    expect(result.activeTrackId).toBe('trk-1');
    expect(result.selectionSpan).toBeNull();
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe(selectedId);
  });
});
