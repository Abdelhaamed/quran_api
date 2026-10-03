import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: '/quran_api/',
  build: {
    target: 'es2020',
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
  },
  test: {
    environment: 'node',
    // `virtual:pwa-register` exists only inside Vite's dev server and build.
    // Tests resolve through Node, so without this alias every suite importing
    // src/main.js fails at import time. Scoped to `test` so the production
    // build still resolves the real virtual module through the plugin.
    // fileURLToPath, not .pathname: on Windows the path contains a drive
    // letter and spaces, which a raw pathname mangles.
    alias: {
      'virtual:pwa-register': fileURLToPath(new URL('./test/stubs/pwa-register.js', import.meta.url)),
    },
    include: ['test/**/*.test.js'],
  },
  plugins: [
    VitePWA({
      // injectManifest, not generateSW: the audio download feature needs a
      // hand-written service worker (RangeRequestsPlugin on the audio route
      // plus a message port), which generateSW cannot express. The routes in
      // src/sw.js mirror the old generateSW config one for one.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // NOTE: under injectManifest the manifest globs live HERE, not under
      // `workbox` (those are generateSW-only and silently ignored). The
      // default injectManifest glob covers only js/css/html, which is how the
      // fonts and icons went missing from the precache unnoticed.
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,png}'],
      },
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
      // Under injectManifest only the injectManifest block above is read (to
      // build the precache manifest injected as self.__WB_MANIFEST). Every
      // route lives as code in src/sw.js instead — generateSW cannot express
      // the audio route's RangeRequestsPlugin or the message port.
    }),
  ],
});
