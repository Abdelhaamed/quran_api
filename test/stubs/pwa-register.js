// Test-only stand-in for the `virtual:pwa-register` module, which exists
// solely inside Vite's dev server and production build. Vitest resolves
// modules through Node, where the virtual id is unresolvable, so without this
// alias every test importing src/main.js (which registers the service worker)
// fails at import time. The stub records its options and returns a no-op
// updater; service-worker behaviour itself is verified against dist/, not here.
export function registerSW(options = {}) {
  const calls = [];
  const updateSW = (reload) => {
    calls.push({ reload: !!reload });
  };
  updateSW.options = options;
  updateSW.calls = calls;
  return updateSW;
}
