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
    // Each listener is isolated: one view throwing must not starve the views
    // registered after it, nor let the error escape as an uncaught exception
    // from inside the microtask.
    for (const fn of listeners) {
      try {
        fn(snapshot, keys);
      } catch (err) {
        console.error('store listener failed', err);
      }
    }
  };

  return {
    getState() { return state; },
    setState(patch) {
      // Compared with Object.is, not ===, so a NaN -> NaN write counts as
      // unchanged too. Only genuinely changed keys are announced: a view that
      // writes a value it already has should not cause a render.
      const changed = Object.keys(patch).filter((k) => !Object.is(state[k], patch[k]));
      if (!changed.length) return;
      state = { ...state, ...patch };
      pendingKeys = new Set([...pendingKeys, ...changed]);
      if (!queued) {
        queued = true;
        queueMicrotask(flush);
      }
    },
    subscribe(fn, { immediate = false } = {}) {
      if (immediate) {
        // Notify first: if fn throws, the listener was never registered, so
        // subscribe still returns a working unsubscribe.
        try {
          fn(state, new Set(Object.keys(state)));
        } catch (err) {
          console.error('store immediate subscribe failed', err);
        }
      }
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
