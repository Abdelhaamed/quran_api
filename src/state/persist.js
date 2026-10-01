const KEY = 'quran.state.v2';
const KEY_CACHE = 'quran.cache.v2';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
    // `!Number.isFinite(at)` rejects an entry written without a usable
    // timestamp: `NaN > TTL` is false, so such an entry would never expire.
    if (!entry || typeof entry !== 'object') return null;
    if (!Number.isFinite(entry.at)) return null;
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
