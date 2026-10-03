/**
 * Playback startup latency lives almost entirely in the network, not in JS.
 * Measured cold (fresh profile, tap → playing ≈ 1.8s):
 *   tap → src set ......... ~70ms   (our code; already fine)
 *   src set → loadstart ... ~265ms  (fetch setup: DNS + TLS + request)
 *   loadstart → canplay ... ~1.5s   (buffering first decodable bytes)
 *
 * Two things we control, both shifting work earlier so the tap path is shorter:
 *
 * 1. PRECONNECT on reciter select. The moshaf server origin
 *    (https://serverN.mp3quran.net) is known the moment a riwaya is chosen,
 *    usually seconds before any tap. Opening DNS+TLS then removes it from the
 *    critical path. One link element, href updated per selection.
 *
 * 2. PRELOAD-NEXT once playback starts. Quran listening is sequential — the
 *    next queue item is highly likely to play. A `<link rel="preload"
 *    as="audio">` warms the browser HTTP cache, so a later tap, auto-advance,
 *    or replay finds the head bytes locally instead of fetching them. Skipped
 *    under Data Saver, where speculative bytes cost the user money.
 */
const PRECONNECT_ID = 'quran-preconnect';
const PRELOAD_ID = 'quran-preload-next';

function upsertLink(id, attrs) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('link');
    el.id = id;
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function serverOrigin(server) {
  try {
    return new URL(server).origin;
  } catch {
    return null;
  }
}

export function preconnectServer(server) {
  const origin = serverOrigin(server);
  if (!origin) return;
  upsertLink(PRECONNECT_ID, { rel: 'preconnect', href: origin, crossorigin: '' });
  const dns = upsertLink(`${PRECONNECT_ID}-dns`, { rel: 'dns-prefetch', href: origin });
  dns.removeAttribute('crossorigin');
}

export function preloadNext(url) {
  // Data Saver means bytes cost money: never speculate on the user's bill.
  try {
    if (navigator.connection?.saveData) return;
  } catch {
    /* connection API absent: proceed */
  }
  if (!url) return;
  const el = upsertLink(PRELOAD_ID, { rel: 'preload', as: 'audio', href: url });
  el.removeAttribute('crossorigin');
}

export function clearPreload() {
  document.getElementById(PRELOAD_ID)?.remove();
}
