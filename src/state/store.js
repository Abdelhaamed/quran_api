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
      let ready = true;
      if (immediate) {
        // Registration is gated on the immediate call succeeding. A callback
        // that throws here is not yet able to render, and registering it anyway
        // would re-invoke that throw on every subsequent flush — a repeating
        // failure rather than a single skipped first render. The unsubscribe
        // function is still returned below, so this is the only thing standing
        // between a one-off throw and a listener that fails forever.
        try {
          fn(state, new Set(Object.keys(state)));
        } catch (err) {
          console.error('store immediate subscribe failed', err);
          ready = false;
        }
      }
      if (ready) listeners.add(fn);
      // Returned either way: deleting an unregistered listener is a no-op, so
      // the caller always gets a safe teardown handle.
      return () => listeners.delete(fn);
    },
  };
}
