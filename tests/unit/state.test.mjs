// Unit tests for app/js/state.js — reactive Proxy store

import { describe, it, expect, vi } from 'vitest';
import { createStore, STATE_DEFAULTS, TREE_STATE_DEFAULTS } from '../../app/js/state.js';

describe('createStore', () => {
  it('returns an object with the initial properties', () => {
    const store = createStore({ a: 1, b: 'x' });
    expect(store.a).toBe(1);
    expect(store.b).toBe('x');
  });

  it('calls onChange when a property changes', () => {
    const onChange = vi.fn();
    const store = createStore({ count: 0 }, onChange);
    store.count = 5;
    expect(onChange).toHaveBeenCalledWith('count', 5, 0);
  });

  it('does not call onChange when value is identical', () => {
    const onChange = vi.fn();
    const store = createStore({ count: 0 }, onChange);
    store.count = 0;
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports multiple property changes', () => {
    const calls = [];
    const store = createStore({ a: 1, b: 2 }, (k, v, o) => calls.push({ k, v, o }));
    store.a = 10;
    store.b = 20;
    expect(calls).toEqual([
      { k: 'a', v: 10, o: 1 },
      { k: 'b', v: 20, o: 2 },
    ]);
  });

  it('works without onChange callback', () => {
    const store = createStore({ x: 0 });
    store.x = 42;
    expect(store.x).toBe(42);
  });

  it('does not share state between stores', () => {
    const s1 = createStore({ val: 1 });
    const s2 = createStore({ val: 2 });
    s1.val = 99;
    expect(s2.val).toBe(2);
  });

  it('supports adding new properties', () => {
    const onChange = vi.fn();
    const store = createStore({}, onChange);
    store.newProp = 'hello';
    expect(store.newProp).toBe('hello');
    expect(onChange).toHaveBeenCalledWith('newProp', 'hello', undefined);
  });
});

describe('STATE_DEFAULTS', () => {
  it('has expected default mode', () => {
    expect(STATE_DEFAULTS.mode).toBe('slope+relief');
  });

  it('has expected default basemap', () => {
    expect(STATE_DEFAULTS.basemap).toBe('osm');
  });

  it('has numeric opacity defaults', () => {
    expect(typeof STATE_DEFAULTS.basemapOpacity).toBe('number');
    expect(typeof STATE_DEFAULTS.slopeOpacity).toBe('number');
    expect(typeof STATE_DEFAULTS.hillshadeOpacity).toBe('number');
  });

  it('has empty default overlays and layer order', () => {
    expect(STATE_DEFAULTS.activeOverlays).toEqual([]);
    expect(STATE_DEFAULTS.layerOrder).toEqual([]);
  });
});

describe('TREE_STATE_DEFAULTS', () => {
  it('has expected shape', () => {
    expect(TREE_STATE_DEFAULTS.selectedNodeIds).toEqual([]);
    expect(TREE_STATE_DEFAULTS.contextMenuState).toBeNull();
    expect(TREE_STATE_DEFAULTS.expandedNodeIds).toBeInstanceOf(Set);
  });
});
