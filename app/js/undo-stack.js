export const MAX_UNDO = 50;

export function createUndoStack({
  findTrack,
  onSnapshotApplied,
  getSelectedVertexIndex,
  setSelectedVertexIndex,
  getInsertAfterIdx,
  setInsertAfterIdx,
  maxEntries = MAX_UNDO,
}) {
  const undoStack = [];
  const redoStack = [];

  function trimStack(stack) {
    if (stack.length > maxEntries) {
      stack.splice(0, stack.length - maxEntries);
    }
  }

  function createSnapshot(trackId) {
    const track = findTrack(trackId);
    if (!track) return null;
    return {
      trackId,
      coords: track.coords.map(coord => coord.slice()),
      selectedVertexIndex: getSelectedVertexIndex(),
      insertAfterIdx: getInsertAfterIdx(),
    };
  }

  function applySnapshot(snapshot) {
    const track = findTrack(snapshot.trackId);
    if (!track) return false;
    track.coords = snapshot.coords.map(coord => coord.slice());
    setSelectedVertexIndex(snapshot.selectedVertexIndex);
    setInsertAfterIdx(snapshot.insertAfterIdx);
    onSnapshotApplied?.(track);
    return true;
  }

  function push(trackId) {
    const snapshot = createSnapshot(trackId);
    if (!snapshot) return false;
    undoStack.push(snapshot);
    trimStack(undoStack);
    redoStack.length = 0;
    return true;
  }

  function undo(options = {}) {
    if (!undoStack.length) return false;
    const snapshot = undoStack.pop();
    const current = createSnapshot(options.trackId || snapshot.trackId);
    if (!current) {
      undoStack.push(snapshot);
      trimStack(undoStack);
      return false;
    }
    if (!options.suppressRedo) {
      redoStack.push(current);
      trimStack(redoStack);
    }
    if (!applySnapshot(snapshot)) {
      if (!options.suppressRedo) redoStack.pop();
      undoStack.push(snapshot);
      trimStack(undoStack);
      return false;
    }
    return true;
  }

  function redo(options = {}) {
    if (!redoStack.length) return false;
    const snapshot = redoStack.pop();
    const current = createSnapshot(options.trackId || snapshot.trackId);
    if (!current) {
      redoStack.push(snapshot);
      trimStack(redoStack);
      return false;
    }
    undoStack.push(current);
    trimStack(undoStack);
    if (!applySnapshot(snapshot)) {
      undoStack.pop();
      redoStack.push(snapshot);
      trimStack(redoStack);
      return false;
    }
    return true;
  }

  function clear() {
    undoStack.length = 0;
    redoStack.length = 0;
  }

  return {
    push,
    undo,
    redo,
    clear,
    get undoStack() { return undoStack; },
    get redoStack() { return redoStack; },
  };
}
