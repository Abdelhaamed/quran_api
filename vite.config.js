import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/quran_api/',
  build: {
    target: 'es2020',
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // globPatterns already matches everything in public/, so letting the
      // plugin inject manifest.icons as additionalManifestEntries too would
      // precache those icons twice.
      includeManifestIcons: false,
      manifest: {
        name: 'القرآن الكريم',
        short_name: 'القرآن',
        description: 'استماع لتلاوات القرآن الكريم بأصوات كبار القرّاء',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/quran_api/',
        scope: '/quran_api/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#241f1f',
        theme_color: '#241f1f',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,png}'],
        cleanupOutdatedCaches: true,
        // Both keys below must be explicit. vite-plugin-pwa defaults
        // navigateFallback to 'index.html', so merely omitting it still emits a
        // NavigationRoute ahead of runtimeCaching and shadows the pages-v1 route.
        navigateFallback: null,
        // Navigations are served from cache explicitly below: this app has
        // exactly one document and no router.
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.mode === 'navigate' &&
              url.origin === self.location.origin,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pages-v1',
              expiration: { maxEntries: 4, maxAgeSeconds: 604800 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The predicate below is serialized into sw.js and evaluated in
            // the service worker, so it may NOT close over a build-time
            // constant: it would become a free variable and throw
            // ReferenceError on every request. Inline the literal.
            urlPattern: ({ url }) => url.origin === 'https://mp3quran.net',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-v1',
              expiration: { maxEntries: 12, maxAgeSeconds: 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ request, url }) =>
              url.origin === self.location.origin &&
              ['style', 'script', 'worker', 'font', 'image'].includes(request.destination),
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets-v1',
              expiration: { maxEntries: 60, maxAgeSeconds: 2592000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // No route matches *.mp3, so audio stays NetworkOnly and range-based
        // seeking keeps working. Do not add one.
      },
    }),
  ],
});
