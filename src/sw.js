import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { RangeRequestsPlugin } from 'workbox-range-requests';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Injected at build time with the precache manifest. Everything else below is
// an explicit route — there is no navigateFallback, because the plugin's
// default would register a NavigationRoute ahead of runtimeCaching and shadow
// the pages route.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Pages: NetworkFirst with a 3s timeout so a fresh shell is picked up after a
// deploy. cleanupOutdatedCaches only removes caches with '-precache-' in the
// name, so these versioned runtime caches persist across SW versions by design.
registerRoute(
  ({ url, request }) => request.mode === 'navigate' && url.origin === self.location.origin,
  new NetworkFirst({
    cacheName: 'pages-v1',
    networkTimeoutSeconds: 3,
    plugins: [
      new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 604800 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// mp3quran JSON: hostname-checked (not origin.endsWith, which would match
// notmp3quran.net), with an explicit .mp3 exclusion so surah audio never lands
// here. Lowercased so .MP3 cannot slip past.
registerRoute(
  ({ url }) =>
    (url.hostname === 'mp3quran.net' || url.hostname.endsWith('.mp3quran.net')) &&
    !url.pathname.toLowerCase().endsWith('.mp3'),
  new StaleWhileRevalidate({
    cacheName: 'api-v1',
    plugins: [
      new ExpirationPlugin({ maxEntries: 12, maxAgeSeconds: 86400 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// Downloaded surahs: served from the audio-v1 cache when present, network
// otherwise — WITHOUT storing the network response. Only an explicit user tap
// on the download button writes into audio-v1 (via cache.put from the page),
// so streaming never fills storage silently. cacheWillUpdate returning null is
// what enforces that: without it CacheFirst would store every streamed surah.
//
// RangeRequestsPlugin is load-bearing here, not optional: seeking sends
// `Range: bytes=X-`, and without the plugin a cached full file would be
// served whole, silently breaking ±10s inside downloaded surahs.
registerRoute(
  ({ url }) => url.pathname.toLowerCase().endsWith('.mp3'),
  new CacheFirst({
    cacheName: 'audio-v1',
    plugins: [
      new RangeRequestsPlugin(),
      new CacheableResponsePlugin({ statuses: [0, 200, 206] }),
      // Deliberately last: a null return means "do not store this response".
      { cacheWillUpdate: async () => null },
    ],
  }),
);

// Same-origin static assets.
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    ['style', 'script', 'worker', 'font', 'image'].includes(request.destination),
  new CacheFirst({
    cacheName: 'assets-v1',
    plugins: [
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 2592000 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// Version probe for the update toast. The page cannot read cache names
// directly in every browser, so it asks.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'AUDIO_KEYS') {
    event.waitUntil(
      (async () => {
        const cache = await caches.open('audio-v1');
        const keys = await cache.keys();
        event.ports[0]?.postMessage({ type: 'AUDIO_KEYS', urls: keys.map((r) => r.url) });
      })(),
    );
  }
});
