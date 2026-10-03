// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  downloadKey, isDownloaded, listDownloads, downloadedBytes, formatBytes,
  downloadSurah, deleteDownload, reconcileDownloads, AUDIO_CACHE,
} from '../src/audio/downloads.js';

// happy-dom has no Cache Storage, so a faithful in-memory stand-in: string
// keys to Response clones. It implements exactly the surface downloads.js
// touches (open/match/put/delete/keys), nothing more.
function installCacheStub() {
  const stores = new Map();
  const cacheFor = (name) => {
    if (!stores.has(name)) {
      const items = new Map();
      stores.set(name, {
        async match(url) {
          const res = items.get(String(url));
          return res ? res.clone() : null;
        },
        async put(url, res) { items.set(String(url), res.clone()); },
        async delete(url) { return items.delete(String(url)); },
        async keys() { return [...items.keys()].map((url) => ({ url })); },
      });
    }
    return stores.get(name);
  };
  Object.defineProperty(globalThis, 'caches', {
    value: { open: async (name) => cacheFor(name) },
    configurable: true, writable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  installCacheStub();
});

afterEach(() => {
  delete globalThis.caches;
  vi.restoreAllMocks();
});

const ENTRY = {
  url: 'https://server6.mp3quran.net/akdr/001.mp3',
  surahId: 1, moshafId: 11, surahName: 'الفاتحة', reciterName: 'أحمد',
};

function mp3Response(body = 'audio-bytes') {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'audio/mpeg', 'content-length': String(body.length) },
  });
}

describe('downloadKey', () => {
  it('matches the favorites key shape so badges and hearts agree', () => {
    expect(downloadKey(18, 133)).toBe('18:133');
    expect(downloadKey('18', '133')).toBe('18:133');
  });
});

describe('formatBytes', () => {
  it('formats B, KB and MB with one decimal under 10 units', () => {
    expect(formatBytes(0)).toBe('0B');
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(1536)).toBe('1.5KB');
    expect(formatBytes(1048576)).toBe('1.0MB');
    expect(formatBytes(10485760)).toBe('10MB');
  });

  it('returns 0B for garbage', () => {
    expect(formatBytes(NaN)).toBe('0B');
    expect(formatBytes(-5)).toBe('0B');
    expect(formatBytes(undefined)).toBe('0B');
  });
});

describe('downloadSurah', () => {
  it('stores the bytes and registers the entry with progress', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mp3Response('x'.repeat(100)));
    const seen = [];
    const { key, size } = await downloadSurah(
      ENTRY, (received, total) => seen.push([received, total]),
    );
    expect(key).toBe('1:11');
    expect(size).toBe(100);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toEqual([100, 100]);
    expect(isDownloaded(1, 11)).toBe(true);

    const cache = await caches.open(AUDIO_CACHE);
    const stored = await cache.match(ENTRY.url);
    expect(stored).not.toBeNull();
    expect(await stored.text()).toBe('x'.repeat(100));
    expect(stored.headers.get('content-type')).toBe('audio/mpeg');
  });

  it('throws on HTTP failure and leaves no trace', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    await expect(downloadSurah(ENTRY)).rejects.toThrow('HTTP 404');
    expect(isDownloaded(1, 11)).toBe(false);
    const cache = await caches.open(AUDIO_CACHE);
    expect(await cache.match(ENTRY.url)).toBeNull();
  });

  it('aborts cleanly without a registry entry', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => new Promise((_, rej) => {
      const e = new DOMException('aborted', 'AbortError');
      setTimeout(() => rej(e), 10);
    }));
    const controller = new AbortController();
    controller.abort();
    await expect(downloadSurah(ENTRY, null, controller.signal)).rejects.toThrow();
    expect(isDownloaded(1, 11)).toBe(false);
  });

  it('resumes a dropped connection with a Range request instead of restarting', async () => {
    // First attempt streams 3 bytes then drops; the second must ask for the
    // rest, not the whole file again. The drop is modelled with pull(), not
    // start(): erroring inside start() discards the queued chunk, which no
    // real network drop does — bytes already read stay read.
    const full = 'x'.repeat(10);
    const seen = [];
    let calls = 0;
    globalThis.fetch = vi.fn().mockImplementation((url, { headers } = {}) => {
      calls += 1;
      seen.push(headers?.Range || '(fresh)');
      if (calls === 1) {
        let pulled = false;
        return Promise.resolve({
          ok: true, status: 200,
          headers: new Headers({ 'content-type': 'audio/mpeg', 'content-length': '10' }),
          body: new ReadableStream({
            start(c) { c.enqueue(new TextEncoder().encode('xxx')); },
            pull(c) { if (!pulled) { pulled = true; c.error(new TypeError('dropped')); } else c.close(); },
          }),
        });
      }
      return Promise.resolve({
        ok: true, status: 206,
        headers: new Headers({
          'content-type': 'audio/mpeg', 'content-length': '7',
          'content-range': 'bytes 3-9/10',
        }),
        body: new ReadableStream({
          start(c) { c.enqueue(new TextEncoder().encode('xxxxxxx')); c.close(); },
        }),
      });
    });
    const { size } = await downloadSurah(ENTRY);
    expect(size).toBe(10);
    expect(seen).toEqual(['(fresh)', 'bytes=3-']);
    expect(calls).toBe(2);
    const cache = await caches.open(AUDIO_CACHE);
    expect(await (await cache.match(ENTRY.url)).text()).toBe(full);
  });

  it('gives up after the attempt budget and leaves no trace', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('down'));
    await expect(downloadSurah(ENTRY, null, null, { maxAttempts: 2 })).rejects.toThrow('down');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(isDownloaded(1, 11)).toBe(false);
  });

  it('restarts clean when the server ignores Range with a 200', async () => {
    let first = true;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      if (first) {
        first = false;
        return Promise.resolve({
          ok: true, status: 200,
          headers: new Headers({ 'content-type': 'audio/mpeg', 'content-length': '10' }),
          body: new ReadableStream({
            start(c) { c.enqueue(new TextEncoder().encode('xxx')); },
            pull(c) { c.error(new TypeError('dropped')); },
          }),
        });
      }
      return Promise.resolve(mp3Response('yyyyyyyyyy'));
    });
    const { size } = await downloadSurah(ENTRY);
    // Not 13: the 3 stale bytes were discarded when the server restarted.
    expect(size).toBe(10);
    const cache = await caches.open(AUDIO_CACHE);
    expect(await (await cache.match(ENTRY.url)).text()).toBe('yyyyyyyyyy');
  });

  it('refuses to store a silently truncated stream', async () => {
    // A server that closes early produces no error, just a short file.
    // Storing it would play a truncated surah under a ✓ badge.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'audio/mpeg', 'content-length': '10' }),
      body: new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode('xxx')); c.close(); },
      }),
    });
    await expect(downloadSurah(ENTRY, null, null, { maxAttempts: 1 }))
      .rejects.toThrow('truncated');
    expect(isDownloaded(1, 11)).toBe(false);
  });
});

describe('deleteDownload', () => {
  it('removes bytes and registry together', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mp3Response());
    await downloadSurah(ENTRY);
    expect(isDownloaded(1, 11)).toBe(true);
    await deleteDownload(1, 11, ENTRY.url);
    expect(isDownloaded(1, 11)).toBe(false);
    const cache = await caches.open(AUDIO_CACHE);
    expect(await cache.match(ENTRY.url)).toBeNull();
  });

  it('tolerates deleting what was never stored', async () => {
    await expect(deleteDownload(99, 99, 'https://x/099.mp3')).resolves.toBeUndefined();
  });
});

describe('downloadedBytes', () => {
  it('sums registered sizes', async () => {
    // A fresh Response per call: reusing one object locks its body stream on
    // the first read, and the second download would fail on a locked stream.
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(mp3Response('x'.repeat(50)))
      .mockResolvedValueOnce(mp3Response('x'.repeat(50)));
    await downloadSurah(ENTRY);
    await downloadSurah({ ...ENTRY, url: 'https://server6.mp3quran.net/akdr/002.mp3', surahId: 2 });
    expect(downloadedBytes()).toBe(100);
    expect(listDownloads()).toHaveLength(2);
  });
});

describe('reconcileDownloads', () => {
  it('drops registry entries whose bytes are gone', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mp3Response());
    await downloadSurah(ENTRY);
    const cache = await caches.open(AUDIO_CACHE);
    await cache.delete(ENTRY.url);
    await reconcileDownloads();
    expect(isDownloaded(1, 11)).toBe(false);
  });

  it('keeps entries whose bytes survive', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mp3Response());
    await downloadSurah(ENTRY);
    await reconcileDownloads();
    expect(isDownloaded(1, 11)).toBe(true);
  });
});
