import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readState, writeState, readCache, writeCache, CACHE_TTL_MS } from '../src/state/persist.js';

const KEY = 'quran.state.v2';
const KEY_CACHE = 'quran.cache.v2';

function fakeStorage({ get, set } = {}) {
  const map = new Map();
  return {
    getItem: get ?? ((k) => (map.has(k) ? map.get(k) : null)),
    setItem: set ?? ((k, v) => map.set(k, v)),
    _map: map,
  };
}

let storage;
beforeEach(() => {
  storage = fakeStorage();
  globalThis.localStorage = storage;
});
afterEach(() => { delete globalThis.localStorage; vi.restoreAllMocks(); });

describe('readState / writeState', () => {
  it('returns an empty object when nothing is stored', () => {
    expect(readState()).toEqual({});
  });

  it('round-trips a patch across calls', () => {
    writeState({ theme: 'dark' });
    writeState({ volume: 0.5 });
    expect(readState()).toEqual({ theme: 'dark', volume: 0.5 });
  });

  it('returns an empty object when the stored value is malformed', () => {
    storage.setItem(KEY, '{not json');
    expect(readState()).toEqual({});
  });

  it('never throws when storage is unavailable', () => {
    globalThis.localStorage = undefined;
    expect(() => writeState({ theme: 'dark' })).not.toThrow();
    expect(readState()).toEqual({});
  });

  it('never throws when the write exceeds quota', () => {
    globalThis.localStorage = fakeStorage({
      set: () => { throw new DOMException('full', 'QuotaExceededError'); },
    });
    expect(() => writeState({ theme: 'dark' })).not.toThrow();
  });
});

describe('readCache / writeCache', () => {
  it('returns null for a missing key', () => {
    expect(readCache('reciters')).toBeNull();
  });

  it('round-trips a value', () => {
    writeCache('reciters', [{ id: 1 }]);
    expect(readCache('reciters')).toEqual([{ id: 1 }]);
  });

  it('expires an entry older than the TTL', () => {
    writeCache('reciters', [{ id: 1 }]);
    const raw = JSON.parse(storage.getItem(KEY_CACHE));
    raw.reciters.at = Date.now() - CACHE_TTL_MS - 1000;
    storage.setItem(KEY_CACHE, JSON.stringify(raw));
    expect(readCache('reciters')).toBeNull();
  });

  it('keeps an entry inside the TTL', () => {
    writeCache('reciters', [{ id: 1 }]);
    const raw = JSON.parse(storage.getItem(KEY_CACHE));
    raw.reciters.at = Date.now() - 1000;
    storage.setItem(KEY_CACHE, JSON.stringify(raw));
    expect(readCache('reciters')).toEqual([{ id: 1 }]);
  });

  it('rejects an entry with no usable timestamp', () => {
    // NaN > TTL is false, so without this guard the entry would never expire.
    storage.setItem(KEY_CACHE, JSON.stringify({ reciters: { data: [1] } }));
    expect(readCache('reciters')).toBeNull();
    storage.setItem(KEY_CACHE, JSON.stringify({ reciters: 'not an object' }));
    expect(readCache('reciters')).toBeNull();
  });

  it('keeps other keys when one expires', () => {
    writeCache('reciters', [{ id: 1 }]);
    writeCache('suwar', [{ id: 1 }]);
    const raw = JSON.parse(storage.getItem(KEY_CACHE));
    raw.reciters.at = Date.now() - CACHE_TTL_MS - 1000;
    storage.setItem(KEY_CACHE, JSON.stringify(raw));
    expect(readCache('reciters')).toBeNull();
    expect(readCache('suwar')).toEqual([{ id: 1 }]);
  });

  it('returns null when the whole blob is malformed', () => {
    storage.setItem(KEY_CACHE, 'not json at all');
    expect(readCache('reciters')).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    globalThis.localStorage = undefined;
    expect(() => writeCache('reciters', [{ id: 1 }])).not.toThrow();
    expect(readCache('reciters')).toBeNull();
  });
});
