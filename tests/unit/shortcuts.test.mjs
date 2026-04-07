// Unit tests for app/js/shortcuts.js — keyboard shortcut registry

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need a fresh module each test because _shortcuts accumulates
let registerShortcut, initShortcuts;
let listeners;

function installDocumentMock() {
  listeners = {};
  globalThis.document = {
    addEventListener(type, handler) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    },
    _fire(type, event) {
      for (const h of listeners[type] || []) h(event);
    },
  };
}

function makeKeyEvent(overrides = {}) {
  return {
    key: overrides.key ?? 'a',
    code: overrides.code ?? 'KeyA',
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
    target: overrides.target ?? { tagName: 'DIV', isContentEditable: false },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe('registerShortcut + initShortcuts', () => {
  beforeEach(async () => {
    vi.resetModules();
    installDocumentMock();
    const mod = await import('../../app/js/shortcuts.js');
    registerShortcut = mod.registerShortcut;
    initShortcuts = mod.initShortcuts;
    initShortcuts();
  });

  afterEach(() => {
    delete globalThis.document;
    vi.restoreAllMocks();
  });

  it('fires handler on matching key', () => {
    const handler = vi.fn();
    registerShortcut({ key: 'e', handler });
    const event = makeKeyEvent({ key: 'e' });
    document._fire('keydown', event);
    expect(handler).toHaveBeenCalledWith(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does not fire on mismatched key', () => {
    const handler = vi.fn();
    registerShortcut({ key: 'x', handler });
    const event = makeKeyEvent({ key: 'y' });
    document._fire('keydown', event);
    expect(handler).not.toHaveBeenCalled();
  });

  it('requires ctrl when specified', () => {
    const handler = vi.fn();
    registerShortcut({ key: 'z', ctrl: true, handler });
    // without ctrl
    document._fire('keydown', makeKeyEvent({ key: 'z', ctrlKey: false }));
    expect(handler).not.toHaveBeenCalled();
    // with ctrl
    const e = makeKeyEvent({ key: 'z', ctrlKey: true });
    document._fire('keydown', e);
    expect(handler).toHaveBeenCalledWith(e);
  });

  it('treats metaKey as ctrl (macOS Cmd)', () => {
    const handler = vi.fn();
    registerShortcut({ key: 'z', ctrl: true, handler });
    const e = makeKeyEvent({ key: 'z', metaKey: true });
    document._fire('keydown', e);
    expect(handler).toHaveBeenCalledWith(e);
  });

  it('blocks shortcuts inside INPUT elements by default', () => {
    const handler = vi.fn();
    registerShortcut({ key: 'e', handler });
    const e = makeKeyEvent({ key: 'e', target: { tagName: 'INPUT', isContentEditable: false } });
    document._fire('keydown', e);
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows shortcuts inside INPUT when allowInInputs is true', () => {
    const handler = vi.fn();
    registerShortcut({ key: 'escape', allowInInputs: true, handler });
    const e = makeKeyEvent({ key: 'escape', target: { tagName: 'INPUT', isContentEditable: false } });
    document._fire('keydown', e);
    expect(handler).toHaveBeenCalled();
  });

  it('blocks shortcuts inside contenteditable elements', () => {
    const handler = vi.fn();
    registerShortcut({ key: 'a', handler });
    const e = makeKeyEvent({ key: 'a', target: { tagName: 'DIV', isContentEditable: true } });
    document._fire('keydown', e);
    expect(handler).not.toHaveBeenCalled();
  });
});
