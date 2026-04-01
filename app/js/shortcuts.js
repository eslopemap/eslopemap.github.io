// Central keyboard shortcut registry with focus guards.
// Shortcuts do not fire inside inputs, textareas, or contenteditable elements.

const _shortcuts = [];

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function normalizeKey(e) {
  return {
    key: e.key,
    code: e.code,
    ctrl: e.ctrlKey || e.metaKey,  // Cmd on macOS = Ctrl
    shift: e.shiftKey,
    alt: e.altKey,
  };
}

/**
 * Register a keyboard shortcut.
 * @param {object} spec - { key, ctrl, shift, alt, handler, allowInInputs }
 *   key: string — the KeyboardEvent.key value (case-insensitive match)
 *   ctrl: boolean — require Ctrl/Cmd
 *   shift: boolean — require Shift
 *   handler: (event) => void
 *   allowInInputs: boolean — if true, fires even inside input fields
 */
export function registerShortcut(spec) {
  _shortcuts.push({
    key: spec.key.toLowerCase(),
    ctrl: spec.ctrl || false,
    shift: spec.shift || false,
    alt: spec.alt || false,
    handler: spec.handler,
    allowInInputs: spec.allowInInputs || false,
  });
}

export function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const n = normalizeKey(e);
    const inEditable = isEditable(e.target);

    for (const s of _shortcuts) {
      if (s.key !== n.key.toLowerCase()) continue;
      if (s.ctrl !== n.ctrl) continue;
      if (s.shift !== n.shift) continue;
      if (s.alt !== n.alt) continue;
      if (inEditable && !s.allowInInputs) continue;

      e.preventDefault();
      e.stopPropagation();
      s.handler(e);
      return;
    }
  });
}
