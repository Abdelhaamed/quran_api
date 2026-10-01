const KEY = 'quran.state.v2';
const KEY_CACHE = 'quran.cache.v2';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/* localStorage is absent in workers and Node, and may be full or blocked by
   privacy settings, so every access here is defensive: a throw during bootstrap
   would leave a blank page rather than a degraded one. */

export function readState() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function writeState(patch) {
  try {
    const next = { ...readState(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota exceeded or storage disabled: keep going, session stays in memory */
  }
}

export function readCache(key) {
  try {
    const entry = JSON.parse(localStorage.getItem(KEY_CACHE) || '{}')[key];
    if (!entry) return null;
    if (Date.now() - entry.at > CACHE_TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function writeCache(key, data) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY_CACHE) || '{}');
    all[key] = { at: Date.now(), data };
    localStorage.setItem(KEY_CACHE, JSON.stringify(all));
  } catch {
    /* 243 KB of JSON is well under quota, but never let a write throw */
  }
}