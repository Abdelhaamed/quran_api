import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const API_ORIGIN = 'https://mp3quran.net';

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
      includeAssets: ['icons/*.png', 'favicon.svg'],
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
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.mode === 'navigate' &&
              url.origin === self.location.origin,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages-v1',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 8, maxAgeSeconds: 604800 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === API_ORIGIN,
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
        // The urlPattern predicates above are serialized into sw.js and run
        // inside the service worker, where `self` is ServiceWorkerGlobalScope
        // and `.location.origin` is the site's own origin.
        // No route below matches *.mp3, so audio stays NetworkOnly and
        // range-based seeking keeps working. Do not add one.
      },
    }),
  ],
});
