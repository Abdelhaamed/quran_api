import { readState, writeState } from '../state/persist.js';

export const AUDIO_CACHE = 'audio-v1';
const KEY = 'downloads';

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
 * onProgress(receivedBytes, totalBytes|null) fires per chunk. Aborting is the
 * caller's job via the signal; a rejection leaves no registry entry and no
 * partial cache entry behind.
 */
export async function downloadSurah({ url, surahId, moshafId, surahName, reciterName }, onProgress, signal) {
  const key = downloadKey(surahId, moshafId);
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('content-length')) || null;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.(received, total);
  }
  const headers = new Headers();
  for (const [k, v] of res.headers) {
    if (k.toLowerCase() === 'content-encoding') continue;
    headers.set(k, v);
  }
  if (total != null) headers.set('content-length', String(received));
  const cache = await caches.open(AUDIO_CACHE);
  await cache.put(url, new Response(new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' }), { headers }));
  const reg = readRegistry();
  reg[key] = { surahId, moshafId, surahName, reciterName, url, size: received, at: Date.now() };
  writeRegistry(reg);
  await requestPersistence();
  return { key, size: received };
}

export async function deleteDownload(surahId, moshafId, url) {
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
