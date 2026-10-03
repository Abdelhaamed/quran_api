import { readState, writeState } from '../state/persist.js';

export const AUDIO_CACHE = 'audio-v1';
const KEY = 'downloads';

// Cache Storage is gated behind secure contexts: it exists on localhost and
// HTTPS, but NOT on plain-HTTP LAN addresses like the phone preview server.
// Without this guard the download streams to 100% and then throws on
// caches.open, blaming the connection for what is actually a missing API.
function assertCacheAvailable() {
  if (typeof caches === 'undefined') {
    const err = new Error('Cache Storage unavailable outside a secure context');
    err.name = 'InsecureContext';
    throw err;
  }
}

// Registry shape: { [downloadKey]: { surahId, moshafId, surahName,
// reciterName, url, size, at } }. Bytes live in Cache Storage under the URL;
// this index is what the UI reads synchronously to paint badges without
// awaiting the cache on every render.
export function downloadKey(surahId, moshafId) {
  return `${Number(surahId)}:${Number(moshafId)}`;
}

function readRegistry() {
  try {
    const all = readState();
    const reg = all[KEY];
    return reg && typeof reg === 'object' ? reg : {};
  } catch {
    return {};
  }
}

function writeRegistry(reg) {
  try {
    writeState({ [KEY]: reg });
  } catch {
    /* persist.js already swallows; belt and braces for a corrupted blob */
  }
}

export function isDownloaded(surahId, moshafId) {
  return Boolean(readRegistry()[downloadKey(surahId, moshafId)]);
}

export function listDownloads() {
  return Object.values(readRegistry());
}

export function downloadedBytes() {
  return listDownloads().reduce((n, d) => n + (Number(d.size) || 0), 0);
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0B';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)}KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)}MB`;
}

// Ask the browser not to evict our caches under storage pressure. Best-effort:
// Android Chrome honours it once the site is installed; iOS may still evict,
// which is documented rather than worked around.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* non-fatal: downloads still work, eviction just stays possible */
  }
}

/**
 * Fetches the full MP3 with progress and stores it in audio-v1. Streaming the
 * body through a reader (rather than cache.add) is what makes the percentage
 * possible. Headers are preserved onto the stored response so the audio
 * element and the SW's RangeRequestsPlugin see the same content-type and
 * length they would from the network.
 *
 * Resumes across dropped connections: on a network failure the loop re-issues
 * the request with `Range: bytes=N-` and appends, so a 40MB surah on a flaky
 * phone connection does not restart from zero every time a tower hands off.
 * The server answers Accept-Ranges: bytes, so 206 is the expected resume
 * status. A 200 to a ranged request means the server restarted the file, in
 * which case the partial chunks are discarded and the download restarts clean.
 *
 * onProgress(receivedBytes, totalBytes|null) fires per chunk. Aborting is the
 * caller's job via the signal; an abort (or an exhausted budget) leaves no
 * registry entry and no partial cache entry behind.
 */
export async function downloadSurah({ url, surahId, moshafId, surahName, reciterName }, onProgress, signal, { maxAttempts = 3 } = {}) {
  assertCacheAvailable();
  const key = downloadKey(surahId, moshafId);
  let chunks = [];
  let received = 0;
  let total = null;
  let contentType = 'audio/mpeg';
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      const headers = received > 0 ? { Range: `bytes=${received}-` } : {};
      const res = await fetch(url, { signal, headers });
      if (res.status === 206 && received > 0) {
        // Resumed: content-length is the REMAINING bytes, the total comes
        // from content-range (`bytes N-M/TOTAL`).
        const cr = res.headers.get('content-range') || '';
        const match = cr.match(/\/(\d+)\s*$/);
        if (match) total = Number(match[1]);
      } else if (res.ok && received === 0) {
        total = Number(res.headers.get('content-length')) || null;
        contentType = res.headers.get('content-type') || contentType;
      } else if (res.ok) {
        // Server ignored the Range and restarted the file: the partial chunks
        // belong to a prefix the new body repeats, so drop them or the stored
        // file would contain the start twice.
        chunks = [];
        received = 0;
        total = Number(res.headers.get('content-length')) || null;
        contentType = res.headers.get('content-type') || contentType;
      } else {
        throw new Error(`download failed: HTTP ${res.status}`);
      }
      if (!res.body) throw new Error('download failed: empty body');
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onProgress?.(received, total);
      }
      // A server that closes the stream early produces no error, just a short
      // file. Storing it would play a truncated surah with a ✓ badge, so a
      // short read against a known total throws into the resume path instead.
      if (total != null && received < total) {
        throw new Error(`download truncated: ${received} of ${total} bytes`);
      }
      lastError = null;
      break;
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      lastError = err;
    }
  }

  if (lastError) throw lastError;

  // The bytes are all here (progress hit 100%), so any failure below is in
  // STORING, not fetching. Each step throws a tagged error naming itself, so
  // the toast can tell "disk full" from "cache broken" instead of blaming the
  // connection for a storage failure.
  let stored = false;
  try {
    const headers = new Headers({ 'content-type': contentType, 'content-length': String(received) });
    const cache = await caches.open(AUDIO_CACHE);
    await cache.put(url, new Response(new Blob(chunks, { type: contentType }), { headers }));
    stored = true;
    const reg = readRegistry();
    reg[key] = { surahId, moshafId, surahName, reciterName, url, size: received, at: Date.now() };
    writeRegistry(reg);
  } catch (err) {
    if (stored) {
      err.stage = 'registry';
    } else {
      err.stage = 'cache-put';
      try {
        const cache = await caches.open(AUDIO_CACHE);
        await cache.delete(url);
      } catch { /* best effort cleanup of a partial entry */ }
    }
    throw err;
  }
  await requestPersistence();
  return { key, size: received };
}

export async function deleteDownload(surahId, moshafId, url) {
  assertCacheAvailable();
  const key = downloadKey(surahId, moshafId);
  try {
    const cache = await caches.open(AUDIO_CACHE);
    await cache.delete(url);
  } catch {
    /* cache already gone or unavailable: registry cleanup still runs */
  }
  const reg = readRegistry();
  delete reg[key];
  writeRegistry(reg);
}

/**
 * Reconciles the registry against the actual cache on boot. Entries whose
 * bytes are gone (user cleared site data, browser evicted) would otherwise
 * show a permanent ✓ for a file that 404s inside the cache.
 */
export async function reconcileDownloads() {
  let cache;
  try {
    cache = await caches.open(AUDIO_CACHE);
  } catch {
    return;
  }
  const keys = new Set((await cache.keys()).map((r) => r.url));
  const reg = readRegistry();
  let changed = false;
  for (const [k, entry] of Object.entries(reg)) {
    if (!entry?.url || !keys.has(entry.url)) {
      delete reg[k];
      changed = true;
    }
  }
  if (changed) writeRegistry(reg);
}
