// Tests for the undo-stack logic used in track-edit.js
// We replicate the core undo functions here since track-edit.js
// has DOM/map dependencies that prevent direct import in Node.

const MAX_UNDO = 50;

function createUndoStack() {
  const stack = [];
  let selectedVertexIndex = null;
  let insertAfterIdx = null;

  function pushUndo(trackId, findTrack) {
    const t = findTrack(trackId);
    if (!t) return;
    stack.push({
      trackId,
      coords: t.coords.map(c => c.slice()),
      selectedVertexIndex,
      insertAfterIdx,
    });
    if (stack.length > MAX_UNDO) stack.splice(0, stack.length - MAX_UNDO);
  }

  function popUndo(findTrack, onTrackCoordsChanged) {
    if (!stack.length) return false;
    const snap = stack.pop();
    const t = findTrack(snap.trackId);
    if (!t) return false;
    t.coords = snap.coords;
    selectedVertexIndex = snap.selectedVertexIndex;
    insertAfterIdx = snap.insertAfterIdx;
    onTrackCoordsChanged(t);
    return true;
  }

  function clearUndoStack() {
    stack.length = 0;
  }

  return {
    stack,
    pushUndo,
    popUndo,
    clearUndoStack,
    get selectedVertexIndex() { return selectedVertexIndex; },
    set selectedVertexIndex(v) { selectedVertexIndex = v; },
    get insertAfterIdx() { return insertAfterIdx; },
    set insertAfterIdx(v) { insertAfterIdx = v; },
  };
}

describe('undo stack', () => {
  let undo, tracks, changedTracks;

  function findTrack(id) { return tracks.find(t => t.id === id); }
  function onTrackCoordsChanged(t) { changedTracks.push(t.id); }

  beforeEach(() => {
    undo = createUndoStack();
    tracks = [
      { id: 'trk-1', coords: [[1,2,100],[3,4,200],[5,6,300]] },
      { id: 'trk-2', coords: [[10,20,1000]] },
    ];
    changedTracks = [];
  });

  it('pushes and pops a snapshot, restoring coords', () => {
    undo.pushUndo('trk-1', findTrack);
    expect(undo.stack.length).toBe(1);

    // Mutate the track
    tracks[0].coords.splice(1, 1);
    expect(tracks[0].coords.length).toBe(2);

    // Pop restores original
    const ok = undo.popUndo(findTrack, onTrackCoordsChanged);
    expect(ok).toBe(true);
    expect(tracks[0].coords).toEqual([[1,2,100],[3,4,200],[5,6,300]]);
    expect(changedTracks).toEqual(['trk-1']);
    expect(undo.stack.length).toBe(0);
  });

  it('restores selectedVertexIndex and insertAfterIdx', () => {
    undo.selectedVertexIndex = 2;
    undo.insertAfterIdx = 1;
    undo.pushUndo('trk-1', findTrack);

    undo.selectedVertexIndex = null;
    undo.insertAfterIdx = null;

    undo.popUndo(findTrack, onTrackCoordsChanged);
    expect(undo.selectedVertexIndex).toBe(2);
    expect(undo.insertAfterIdx).toBe(1);
  });

  it('stores deep copies, not references', () => {
    undo.pushUndo('trk-1', findTrack);
    tracks[0].coords[0][0] = 999;
    undo.popUndo(findTrack, onTrackCoordsChanged);
    expect(tracks[0].coords[0][0]).toBe(1);
  });

  it('returns false when popping empty stack', () => {
    expect(undo.popUndo(findTrack, onTrackCoordsChanged)).toBe(false);
  });

  it('returns false when popping for deleted track', () => {
    undo.pushUndo('trk-1', findTrack);
    tracks.length = 0;
    expect(undo.popUndo(findTrack, onTrackCoordsChanged)).toBe(false);
  });

  it('caps stack at MAX_UNDO entries', () => {
    for (let i = 0; i < 60; i++) {
      undo.pushUndo('trk-1', findTrack);
    }
    expect(undo.stack.length).toBe(MAX_UNDO);
  });

  it('supports multiple undos in LIFO order', () => {
    undo.pushUndo('trk-1', findTrack);
    tracks[0].coords.push([7,8,400]);

    undo.pushUndo('trk-1', findTrack);
    tracks[0].coords.push([9,10,500]);

    expect(tracks[0].coords.length).toBe(5);

    undo.popUndo(findTrack, onTrackCoordsChanged);
    expect(tracks[0].coords.length).toBe(4);

    undo.popUndo(findTrack, onTrackCoordsChanged);
    expect(tracks[0].coords.length).toBe(3);
  });

  it('clearUndoStack empties the stack', () => {
    undo.pushUndo('trk-1', findTrack);
    undo.pushUndo('trk-2', findTrack);
    expect(undo.stack.length).toBe(2);
    undo.clearUndoStack();
    expect(undo.stack.length).toBe(0);
  });

  it('works across different tracks', () => {
    undo.pushUndo('trk-1', findTrack);
    undo.pushUndo('trk-2', findTrack);

    tracks[0].coords = [];
    tracks[1].coords = [];

    undo.popUndo(findTrack, onTrackCoordsChanged);
    expect(tracks[1].coords).toEqual([[10,20,1000]]);

    undo.popUndo(findTrack, onTrackCoordsChanged);
    expect(tracks[0].coords).toEqual([[1,2,100],[3,4,200],[5,6,300]]);
  });
});
