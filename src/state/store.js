export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  let queued = false;
  let pendingKeys = new Set();

  const flush = () => {
    queued = false;
    const keys = pendingKeys;
    pendingKeys = new Set();
    const snapshot = state;
    for (const fn of listeners) fn(snapshot, keys);
  };

  return {
    getState() { return state; },
    setState(patch) {
      state = { ...state, ...patch };
      pendingKeys = new Set([...pendingKeys, ...Object.keys(patch)]);
      if (!queued) {
        queued = true;
        queueMicrotask(flush);
      }
    },
    subscribe(fn, { immediate = false } = {}) {
      listeners.add(fn);
      if (immediate) fn(state, new Set(Object.keys(state)));
      return () => listeners.delete(fn);
    },
  };
}