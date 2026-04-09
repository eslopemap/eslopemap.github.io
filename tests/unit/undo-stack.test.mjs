import { createUndoStack, MAX_UNDO } from '../../app/js/undo-stack.js';

describe('undo stack', () => {
  let undo;
  let tracks;
  let changedTracks;
  let selectedVertexIndex;
  let insertAfterIdx;

  function findTrack(id) { return tracks.find(t => t.id === id); }
  function onTrackCoordsChanged(t) { changedTracks.push(t.id); }

  beforeEach(() => {
    tracks = [
      { id: 'trk-1', coords: [[1,2,100],[3,4,200],[5,6,300]] },
      { id: 'trk-2', coords: [[10,20,1000]] },
    ];
    changedTracks = [];
    selectedVertexIndex = null;
    insertAfterIdx = null;
    undo = createUndoStack({
      findTrack,
      onSnapshotApplied: onTrackCoordsChanged,
      getSelectedVertexIndex: () => selectedVertexIndex,
      setSelectedVertexIndex: (value) => { selectedVertexIndex = value; },
      getInsertAfterIdx: () => insertAfterIdx,
      setInsertAfterIdx: (value) => { insertAfterIdx = value; },
    });
  });

  it('pushes and pops a snapshot, restoring coords', () => {
    undo.push('trk-1');
    expect(undo.undoStack.length).toBe(1);

    // Mutate the track
    tracks[0].coords.splice(1, 1);
    expect(tracks[0].coords.length).toBe(2);

    // Pop restores original
    const ok = undo.undo();
    expect(ok).toBe(true);
    expect(tracks[0].coords).toEqual([[1,2,100],[3,4,200],[5,6,300]]);
    expect(changedTracks).toEqual(['trk-1']);
    expect(undo.undoStack.length).toBe(0);
    expect(undo.redoStack.length).toBe(1);
  });

  it('restores selectedVertexIndex and insertAfterIdx', () => {
    selectedVertexIndex = 2;
    insertAfterIdx = 1;
    undo.push('trk-1');

    selectedVertexIndex = null;
    insertAfterIdx = null;

    undo.undo();
    expect(selectedVertexIndex).toBe(2);
    expect(insertAfterIdx).toBe(1);
  });

  it('stores deep copies, not references', () => {
    undo.push('trk-1');
    tracks[0].coords[0][0] = 999;
    undo.undo();
    expect(tracks[0].coords[0][0]).toBe(1);
  });

  it('returns false when popping empty stack', () => {
    expect(undo.undo()).toBe(false);
  });

  it('returns false when popping for deleted track', () => {
    undo.push('trk-1');
    tracks.length = 0;
    expect(undo.undo()).toBe(false);
  });

  it('caps stack at MAX_UNDO entries', () => {
    for (let i = 0; i < 60; i++) {
      undo.push('trk-1');
    }
    expect(undo.undoStack.length).toBe(MAX_UNDO);
  });

  it('supports multiple undos in LIFO order', () => {
    undo.push('trk-1');
    tracks[0].coords.push([7,8,400]);

    undo.push('trk-1');
    tracks[0].coords.push([9,10,500]);

    expect(tracks[0].coords.length).toBe(5);

    undo.undo();
    expect(tracks[0].coords.length).toBe(4);

    undo.undo();
    expect(tracks[0].coords.length).toBe(3);
  });

  it('clearUndoStack empties the stack', () => {
    undo.push('trk-1');
    undo.push('trk-2');
    expect(undo.undoStack.length).toBe(2);
    undo.clear();
    expect(undo.undoStack.length).toBe(0);
    expect(undo.redoStack.length).toBe(0);
  });

  it('works across different tracks', () => {
    undo.push('trk-1');
    undo.push('trk-2');

    tracks[0].coords = [];
    tracks[1].coords = [];

    undo.undo();
    expect(tracks[1].coords).toEqual([[10,20,1000]]);

    undo.undo();
    expect(tracks[0].coords).toEqual([[1,2,100],[3,4,200],[5,6,300]]);
  });

  it('redo reapplies the most recently undone snapshot', () => {
    undo.push('trk-1');
    tracks[0].coords.push([7,8,400]);

    expect(undo.undo()).toBe(true);
    expect(tracks[0].coords).toEqual([[1,2,100],[3,4,200],[5,6,300]]);

    expect(undo.redo()).toBe(true);
    expect(tracks[0].coords).toEqual([[1,2,100],[3,4,200],[5,6,300],[7,8,400]]);
  });

  it('clears redo history after a fresh edit following undo', () => {
    undo.push('trk-1');
    tracks[0].coords.push([7,8,400]);
    expect(undo.undo()).toBe(true);
    expect(undo.redoStack.length).toBe(1);

    undo.push('trk-1');
    tracks[0].coords.push([11,12,600]);

    expect(undo.redoStack.length).toBe(0);
    expect(undo.redo()).toBe(false);
    expect(tracks[0].coords).toEqual([[1,2,100],[3,4,200],[5,6,300],[11,12,600]]);
  });

  it('stops repeated redo cleanly at the stack boundary', () => {
    undo.push('trk-1');
    tracks[0].coords.push([7,8,400]);
    expect(undo.undo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(undo.redo()).toBe(false);
  });
});
