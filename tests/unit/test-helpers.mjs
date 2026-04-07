export function installLocalStorageMock() {
  const store = new Map();

  const localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorage,
    configurable: true,
    writable: true,
  });

  return {
    localStorage,
    store,
    cleanup() {
      delete globalThis.localStorage;
    },
  };
}
