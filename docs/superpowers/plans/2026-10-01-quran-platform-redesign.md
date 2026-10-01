# Quran Platform Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-file static Quran site with a Vite-built, installable PWA whose audio survives navigation, screen lock, and tab switching, with Arabic-correct search, a favorites tab, and a phone-first image-free interface.

**Architecture:** Single-page app with no client-side router — four tabs swap view state in one `index.html`, which removes GitHub Pages subpath routing traps entirely. One persistent `<audio>` element lives for the whole session; all playback state flows through a single pub/sub store that the UI subscribes to. Pure logic (Arabic normalization, queue navigation, favorites reducer) lives in DOM-free modules covered by Vitest. A generated Workbox service worker applies a different caching strategy per resource class.

**Tech Stack:** Vite 8 · vanilla ES modules · VitePWA 1.3 / Workbox 7.4 · Vitest 5 · happy-dom · Fontsource (Amiri + IBM Plex Sans Arabic) · GitHub Pages via Actions

**Spec:** `docs/superpowers/specs/2026-10-01-quran-platform-redesign-design.md`

## Global Constraints

- Base path is `/quran_api/` (repository name) in `vite.config.js`. A wrong base silently breaks PWA installability.
- No client-side router. Tabs are view state, not routes. Only one HTML document exists.
- No images in the product UI. Icons exist solely as PWA/mask/MediaSession artwork.
- Exactly one `<audio>` element for the entire session. Never `new Audio()`. Never `AudioContext` or `createMediaElementSource`.
- No `crossOrigin` on the audio element — direct `<audio src>` needs no CORS, and setting it adds a failure mode.
- Audio never enters the Cache Storage. Media is `NetworkOnly`.
- `navigateFallback` must be explicitly `null` and `includeManifestIcons` explicitly `false`: vite-plugin-pwa's own defaults would register a `NavigationRoute` that shadows the `pages-v1` route and precache every icon twice.
- `surah_list` comes from the selected moshaf, never from the global surah list.
- Favorites key is `${surahId}:${moshafId}` because `moshaf.id` is globally unique (verified 287/287).
- Recitation style is parsed from `moshaf.name`, never from `moshaf_type` (opaque codes: 11, 222, 213).
- Arabic normalization must be applied with identical settings to both the index and the query.
- `lang="ar"` and `dir="rtl"` on `<html>`.
- Minimum touch target 48px; primary play button 64px.
- No `skipWaiting()` without user interaction — show an update toast instead.
- Files removed: `normalize.css`, `main.css`, `main.js`, and the entire `image/` directory (15.5 MB).

---

## File Map

| File | Responsibility |
|---|---|
| `index.html` | Shell markup, four view containers, inline pre-paint theme script, one persistent `<audio>` |
| `vite.config.js` | `base`, PWA manifest + Workbox runtimeCaching, Vitest config |
| `src/main.js` | Bootstrap and wiring only; no business logic |
| `src/utils/arabic.js` | `normalize()` — pure, DOM-free |
| `src/utils/dom.js` | `h()`, `frag()`, `qs()`, `on()` |
| `src/utils/favorites.js` | `toggleFavorite()`, `isFavorite()`, `sortForPlayback()` — pure |
| `src/audio/queue.js` | `createQueue()` — pure navigation over a playlist array |
| `src/audio/engine.js` | Owns the one `<audio>` element; emits events |
| `src/audio/mediaSession.js` | Lock-screen metadata + action handlers |
| `src/api/client.js` | `getJSON()` — timeout, one retry, Arabic error messages |
| `src/api/quran.js` | `getReciters()`, `getSuwar()`, `getRiwayat()`, `getRadios()`, `deriveStyle()` |
| `src/state/store.js` | `createStore()` — pub/sub single source of truth |
| `src/state/persist.js` | localStorage read/write with try/catch |
| `src/ui/shell.js` | Top bar, theme toggle, tab switching |
| `src/ui/search.js` | Unified search over reciters + surahs |
| `src/ui/reciters.js` | Reciter card grid |
| `src/ui/surahs.js` | Surah grid + heart toggle |
| `src/ui/favorites.js` | Favorites tab + play-all |
| `src/ui/radio.js` | 177 radio channels |
| `src/ui/player.js` | Sticky bottom player |
| `src/styles/tokens.css` | All color/spacing/type/layout custom properties |
| `src/styles/base.css` | Modern reset replacing normalize.css |
| `src/styles/components.css` | Component classes |
| `scripts/generate-icons.mjs` | Renders PNG icons from `public/icons/icon.svg` via sharp |

---

## Task 1: Project Foundation

**Files:**
- Create: `package.json`, `vite.config.js`, `.gitignore`, `.github/workflows/deploy.yml`
- Create: `public/icons/icon.svg`, `public/favicon.svg`, `scripts/generate-icons.mjs`, `public/.nojekyll`
- Create: `src/styles/tokens.css`, `src/styles/base.css`
- Delete: `normalize.css`, `main.css`, `main.js`, `image/`

**Interfaces:**
- Produces: CSS custom properties consumed by every later UI task (listed in Step 3)
- Produces: `npm run dev`, `npm run build`, `npm run preview`, `npm test`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "quran-api",
  "private": true,
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "icons": "node scripts/generate-icons.mjs"
  },
  "dependencies": {
    "@fontsource/amiri": "^5.3.0",
    "@fontsource/ibm-plex-sans-arabic": "^5.3.0"
  },
  "devDependencies": {
    "happy-dom": "^20.0.0",
    "sharp": "^0.34.0",
    "vite": "^8.3.1",
    "vite-plugin-pwa": "^1.3.0",
    "vitest": "^5.0.3",
    "workbox-build": "^7.4.1",
    "workbox-window": "^7.4.1"
  }
}
```

- [ ] **Step 2: Install and confirm resolution**

Run: `npm install`
Expected: exit 0, no `ERESOLVE`. Then `npm ls vite vite-plugin-pwa vitest` shows one version each.

- [ ] **Step 3: Create `src/styles/tokens.css`**

```css
:root {
  color-scheme: dark;
  --bg: #241f1f;
  --bg-elevated: #2e2828;
  --surface: #353030;
  --surface-hover: #3f3939;
  /* Decorative card boundaries only; interactive boundaries use --accent. */
  --border: #6b625c;
  --text: #f5f0e9;
  --text-muted: #b5aca3;
  /* 4.94:1 on --surface, the lightest surface text ever lands on. Cards use
     --surface, so this must clear AA there and not just on --bg. */
  --text-faint: #a89e95;
  --accent: #00d4e6;
  --accent-strong: #6ff0ff;
  --accent-contrast: #06252a;
  --gold: #d4af6a;
  --danger: #ff7a6b;
  --shadow: 0 2px 12px rgb(0 0 0 / .35);
  --scrim: rgb(0 0 0 / .55);

  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px;

  --r-sm: 10px; --r-md: 14px; --r-lg: 20px; --r-full: 999px;

  --font-quran: 'Amiri', serif;
  --font-ui: 'IBM Plex Sans Arabic', system-ui, sans-serif;
  /* rem, not px, so a user who raises the browser's default font size
     actually gets larger text. */
  --fs-xs: 0.75rem;
  --fs-sm: 0.875rem;
  --fs-base: 1rem;
  --fs-lg: 1.25rem;
  --fs-xl: 1.625rem;
  --fs-2xl: 2.125rem;

  --tap: 48px;
  --tap-lg: 64px;
  --appbar-h: 56px;
  --tabs-h: 52px;
  --player-h: 88px;
  --content-max: 720px;
  --ease: cubic-bezier(.2,.7,.3,1);
}

[data-theme='light'] {
  color-scheme: light;
  --bg: #faf7f2;
  --bg-elevated: #ffffff;
  --surface: #ffffff;
  --surface-hover: #f0ebe3;
  /* Decorative card boundaries only. Interactive boundaries use --accent.
     1.85:1 on --bg, deliberately below the 3:1 of WCAG 1.4.11, which governs
     user-interface components rather than containers. */
  --border: #c4b79f;
  --text: #1f1a18;
  --text-muted: #5c534c;
  --text-faint: #77604a;
  --accent: #007785;
  --accent-strong: #006b78;
  --accent-contrast: #ffffff;
  --gold: #8a6a24;
  --danger: #c0392b;
  --shadow: 0 2px 12px rgb(31 26 24 / .10);
  --scrim: rgb(31 26 24 / .35);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
  }
}
```

- [ ] **Step 4: Create `src/styles/base.css`**

```css
*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; }
html { -webkit-text-size-adjust: 100%; }

body {
  min-height: 100svh;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--fs-base);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  overflow-wrap: break-word;
}

h1, h2, h3 { line-height: 1.25; font-weight: 600; }
/* line-height is set explicitly because the `font` shorthand resets it to
   normal, which breaks baseline alignment inside fixed-height buttons.
   appearance: none removes the platform's tinted rounded field styling so the
   app's own radii apply. textarea is included so no field falls back to the
   browser's ~11px default. */
button, input, select, textarea {
  font: inherit;
  line-height: 1.4;
  color: inherit;
  appearance: none;
}
input[type='search']::-webkit-search-cancel-button { appearance: auto; }
button { background: none; border: 0; cursor: pointer; }
button:focus-visible, input:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
img, svg { display: block; max-width: 100%; }
ul, ol { list-style: none; padding: 0; }
[hidden] { display: none !important; }

/* Firefox needs the standard properties; the ::-webkit rules are ignored there. */
* { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: var(--r-full); }

@media (min-width: 768px) {
  body { font-size: var(--fs-lg); }
}
```

- [ ] **Step 5: Create the app icon and generate PNGs**

Geometry only, no text. A `<text>` glyph rasterizes differently on every host,
because librsvg resolves `font-family` through whatever fontconfig happens to
have installed — the committed PNGs would be correct by accident of the machine
that generated them, and turn into tofu boxes on a bare CI container.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#241f1f"/>
  <g fill="none" stroke="#00d4e6" stroke-width="7" opacity=".55">
    <path d="M256 44 440 160 440 352 256 468 72 352 72 160Z"/>
    <path d="M256 104 384 184 384 328 256 408 128 328 128 184Z"/>
    <path d="M256 104 256 408M128 184 384 328M384 184 128 328"/>
  </g>
  <circle cx="256" cy="256" r="34" fill="none" stroke="#d4af6a" stroke-width="7"/>
</svg>
```

`scripts/generate-icons.mjs`:

```js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
await mkdir(outDir, { recursive: true });

const svg = await readFile(join(outDir, 'icon.svg'));
const square = await sharp(svg).resize(512, 512).png().toBuffer();

// Maskable icons are cropped to a circle of half the canvas, so the glyph is
// scaled to 360px and re-centred, leaving ~15% padding per side.
const maskable = await sharp(svg)
  .resize(360, 360)
  .extend({
    top: 76, bottom: 76, left: 76, right: 76,
    background: { r: 36, g: 31, b: 31, alpha: 1 },
  })
  .png()
  .toBuffer();

await Promise.all([
  writeFile(join(outDir, 'icon-192.png'), await sharp(square).resize(192, 192).toBuffer()),
  writeFile(join(outDir, 'icon-512.png'), square),
  writeFile(join(outDir, 'maskable-512.png'), maskable),
  writeFile(join(outDir, 'apple-touch-icon.png'), await sharp(square).resize(180, 180).toBuffer()),
]);
console.log('icons written to public/icons');
```

Run: `npm run icons`
Expected: prints `icons written to public/icons`; four PNGs exist. Commit them so the build never needs sharp.

- [ ] **Step 6: Create `vite.config.js`**

Run: `npm run build`, then verify the generated `dist/sw.js`:
- `Select-String -Path dist/sw.js -Pattern 'API_ORIGIN' -SimpleMatch` matches **nothing** (a free `API_ORIGIN` means a `urlPattern` closed over a build-time constant and will throw `ReferenceError` on every request)
- `Select-String -Path dist/sw.js -Pattern 'NavigationRoute' -SimpleMatch` matches **nothing** (it would shadow the `pages-v1` route)
- each of `icons/icon-192.png`, `icons/icon-512.png`, `icons/maskable-512.png`, `icons/apple-touch-icon.png` appears exactly once in the precache list

```js
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
        // Navigations are NetworkFirst with a 3s timeout so a fresh shell is
        // picked up after a deploy. CacheFirst would pin the old index.html for
        // the full maxAgeSeconds, because cleanupOutdatedCaches only removes
        // caches whose name contains '-precache-' and so never prunes
        // pages-v1/api-v1/assets-v1 across service-worker versions.
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.mode === 'navigate' &&
              url.origin === self.location.origin,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages-v1',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 4, maxAgeSeconds: 604800 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The predicate below is serialized into sw.js and evaluated in
            // the service worker, so it may NOT close over a build-time
            // constant: it would become a free variable and throw
            // ReferenceError on every request. Inline the literal.
            //
            // hostname is used rather than origin.endsWith, because
            // `https://notmp3quran.net` also ends with 'mp3quran.net'.
            // The .mp3 exclusion makes "audio is never cached" structural
            // rather than incidental: surah audio lives on
            // server*.mp3quran.net, which WOULD otherwise match this rule.
            // Lowercased so a .MP3 cannot slip past the exclusion.
            urlPattern: ({ url }) =>
              (url.hostname === 'mp3quran.net' || url.hostname.endsWith('.mp3quran.net')) &&
              !url.pathname.toLowerCase().endsWith('.mp3'),
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
        // Audio is never cached. mp3quran audio lives on server*.mp3quran.net,
        // which the api-v1 predicate matches by hostname — the case-insensitive
        // .mp3 exclusion above is what excludes it. backup.qurango.net radio
        // streams match no route at all. Do not add a route for either.
      },
    }),
  ],
});
```

Audio URLs are never cached. Surah audio lives on `server*.mp3quran.net`, whose hostname **does** match the `api-v1` predicate — the case-insensitive `.mp3` exclusion inside that predicate is what keeps it out of the cache. Radio lives on `backup.qurango.net`, which matches no route at all. Do not add a route covering either, and do not remove that exclusion.

- [ ] **Step 7: Create `public/favicon.svg`**

Same geometry as `icons/icon.svg`, so the browser tab and the installed app
share one mark.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#241f1f"/>
  <g fill="none" stroke="#00d4e6" stroke-width="2" opacity=".6">
    <path d="M32 6 55 20 55 44 32 58 9 44 9 20Z"/>
    <path d="M32 13 48 23 48 41 32 51 16 41 16 23Z"/>
    <path d="M32 13 32 51M16 23 48 41M48 23 16 41"/>
  </g>
  <circle cx="32" cy="32" r="4.5" fill="none" stroke="#d4af6a" stroke-width="2"/>
</svg>
```

`index.html` in Task 6 references `/quran_api/favicon.svg`, so it must exist.

- [ ] **Step 8: Create `.gitignore`**

```
node_modules/
dist/
dev-dist/
.superpowers/
*.local
.DS_Store
```

- [ ] **Step 8b: Create `.gitattributes`**

`core.autocrlf` is on for this host, so `git add` warns `LF will be replaced by
CRLF` on every text file. Blobs are stored as LF either way, but pinning it
stops the warning and keeps the working tree predictable.

```
* text=auto eol=lf
*.png binary
```

- [ ] **Step 9: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: actions/setup-node@v7.0.0
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/configure-pages@v6.0.0
      - uses: actions/upload-pages-artifact@v5.0.0
        with:
          path: dist
          # Defaults to false in v5, which would exclude dist/.nojekyll from the
          # artifact and let Pages run Jekyll over the output.
          include-hidden-files: true

  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5.0.1
```

- [ ] **Step 10: Remove legacy files**

```bash
git rm -q normalize.css main.css main.js
git rm -rq image
```

- [ ] **Step 11: Verify the empty shell builds and serves**

Temporarily create `index.html`:

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>القرآن الكريم</title></head>
<body><p>الأساس جاهز</p></body></html>
```

Run: `npm run build` then `npm run preview -- --port 4173`
Expected: build prints `dist/index.html`; preview serves on 4173. Confirm `dist/index.html` contains `/quran_api/` asset paths and `dist/sw.js` plus `dist/manifest.webmanifest` exist.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite project with PWA config and design tokens

Sets base to /quran_api/ so GitHub Pages serves assets from the
subpath. Navigations are NetworkFirst with a 3s timeout so a fresh shell
is picked up after a deploy; hashed assets are CacheFirst; mp3quran JSON
is StaleWhileRevalidate with a case-insensitive .mp3 exclusion so surah
audio is never cached and range-based seeking keeps working.
navigateFallback is pinned to null because the plugin defaults it to
index.html, which would register a NavigationRoute ahead of
runtimeCaching and shadow the pages route. includeManifestIcons is false
because globPatterns already precaches the icons. upload-pages-artifact
v5 needs include-hidden-files or it drops dist/.nojekyll. Removes the
15.5MB image directory and the normalize.css/main.css/main.js trio."
```

---

## Task 2: Pure Logic (TDD)

**Files:**
- Create: `src/utils/arabic.js`, `src/audio/queue.js`, `src/utils/favorites.js`, `src/utils/ayah-counts.js`
- Create: `test/arabic.test.js`, `test/queue.test.js`, `test/favorites.test.js`, `test/ayah-counts.test.js`

**Interfaces:**
- Produces: `normalize(text: string): string`
- Produces: `createQueue()` → reads are getters (`size`, `index`, `current`, `items`), actions are methods (`setPlaylist`, `setIndexBySurah`, `next`, `prev`, `clear`)
- Produces: `favoriteKey(surahId, moshafId): string`, `isFavorite(list, surahId, moshafId): boolean`, `toggleFavorite(list, entry): array`, `sortForPlayback(list): array`. Note `removeFavorite` was dropped as unreachable: Task 6 removes a favorite via `toggleFavorite`.
- Produces: `AYAH_COUNTS` — frozen null-prototype object keyed by surah id 1..114, plus `ayahCount(surahId): number` returning 0 for anything else

All four modules are DOM-free and import nothing.

- [ ] **Step 1: Write `test/arabic.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { normalize, matchesAll } from '../src/utils/arabic.js';

describe('normalize', () => {
  it('folds alef variants onto bare alef', () => {
    for (const input of ['أحمد', 'احمد', 'إحمد', 'آحمد', 'ٱحمد'])
      expect(normalize(input)).toBe('احمد');
  });

  it('strips tashkeel and tatweel', () => {
    expect(normalize('بِسْمِ')).toBe('بسم');
    expect(normalize('ٱللَّـهِ')).toBe('الله');
  });

  it('folds alef maksura to ya and ta marbuta to ha', () => {
    expect(normalize('على')).toBe('علي');
    expect(normalize('فاطمة')).toBe('فاطمه');
  });

  it('folds hamza carriers', () => {
    expect(normalize('مؤمن')).toBe('مومن');
    expect(normalize('سؤال')).toBe('سوال');
  });

  it('drops a standalone hamza', () => {
    // A real reciter name in the live corpus carries one, inside
    // "قراءة يعقوب الحضرمي بروايتي رويس وروح".
    expect(normalize('قراءة')).toBe('قراه');
  });

  it('normalizes non-strings without swallowing them', () => {
    expect(normalize(0)).toBe('0');
    expect(normalize(18)).toBe('18');
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });

  it('converts Arabic-Indic digits and lowercases latin', () => {
    expect(normalize('سورة ١٨')).toBe('سوره 18');
    expect(normalize('AlKahf')).toBe('alkahf');
  });

  it('collapses whitespace and trims', () => {
    expect(normalize('  杨   李  ')).toBe('杨 李');
    expect(normalize('  الحصري  ')).toBe('الحصري');
  });

  it('is idempotent', () => {
    const once = normalize('أَحْمَدُ الكِتَاب');
    expect(normalize(once)).toBe(once);
  });

  it('handles empty input', () => {
    expect(normalize('')).toBe('');
    expect(normalize('   ')).toBe('');
  });
});

describe('matchesAll', () => {
  // This is the function search actually calls, so it needs coverage of its
  // own: normalize() being correct does not prove matching is correct.
  it('folds the query, not just the haystack', () => {
    // Every natural query a user types is UNFOLDED. If normalize(query) were
    // dropped, all of these would return false and search would silently break
    // for every real input while a suite using pre-folded queries stayed green.
    expect(matchesAll('احمد العجمي', 'أحمد')).toBe(true);
    expect(matchesAll('محمد إبراهيم الحضرمي', 'إبراهيم')).toBe(true);
    expect(matchesAll('أبو بكر الشاطري', 'ابو بكر')).toBe(true);
    expect(matchesAll('فاطمة', 'فاطمة')).toBe(true);
    expect(matchesAll('مؤمن', 'مؤمن')).toBe(true);
  });

  it('folds both sides identically', () => {
    expect(matchesAll('أحمد العجمي', 'احمد')).toBe(true);
    expect(matchesAll('احمد العجمي', 'أحمد')).toBe(true);
  });

  it('requires every token to match', () => {
    expect(matchesAll('أحمد بن علي العجمي', 'احمد')).toBe(true);
    expect(matchesAll('أحمد بن علي العجمي', 'احمد عجمي')).toBe(true);
    expect(matchesAll('أحمد بن علي العجمي', 'احمد sudais')).toBe(false);
    expect(matchesAll('عبد الرحمن السديس', 'السديس عبد')).toBe(true);
  });

  it('treats an empty query as a match', () => {
    expect(matchesAll('الحصري', '')).toBe(true);
    expect(matchesAll('الحصري', '   ')).toBe(true);
  });

  it('rejects a token absent from the haystack', () => {
    expect(matchesAll('محمد', 'احمد')).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/utils/arabic.js'`.

- [ ] **Step 3: Create `src/utils/arabic.js`**

```js
const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const ALEF = /[\u0622\u0623\u0625\u0671\u0672\u0673\u0675]/g;
const WAW_HAMZA = /\u0624/g;
const YEH_HAMZA = /\u0626/g;
const HAMZA = /\u0621/g;
const ALEF_MAKSURA = /\u0649/g;
const TA_MARBUTA = /\u0629/g;
const ARABIC_INDIC = /[\u0660-\u0669]/g;
const WHITESPACE = /\s+/g;

export function normalize(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(TASHKEEL, '')
    .replace(ALEF, '\u0627')
    .replace(WAW_HAMZA, '\u0648')
    .replace(YEH_HAMZA, '\u064A')
    .replace(HAMZA, '')
    .replace(ALEF_MAKSURA, '\u064A')
    .replace(TA_MARBUTA, '\u0647')
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(WHITESPACE, ' ')
    .trim();
}

export function matchesAll(haystack, query) {
  const normalizedQuery = normalize(query);
  const tokens = normalizedQuery ? normalizedQuery.split(' ') : [];
  if (tokens.length === 0) return true;
  const text = normalize(haystack);
  return tokens.every((t) => text.includes(t));
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test`
Expected: 8 passing.

- [ ] **Step 5: Write `test/queue.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { createQueue } from '../src/audio/queue.js';

const item = (id) => ({ surahId: id, url: `/x/${id}.mp3`, title: `سورة ${id}` });

describe('createQueue', () => {
  it('starts empty', () => {
    const q = createQueue();
    expect(q.size).toBe(0);
    expect(q.current).toBeNull();
  });

  it('navigates forward and backward', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(2), item(3)]);
    expect(q.current.surahId).toBe(1);
    expect(q.next().surahId).toBe(2);
    expect(q.next().surahId).toBe(3);
    expect(q.next()).toBeNull();
    expect(q.prev().surahId).toBe(2);
  });

  it('does not wrap at either end', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(2)]);
    expect(q.prev()).toBeNull();
    expect(q.index).toBe(0);
  });

  it('honours a partial surah_list from the selected moshaf', () => {
    const q = createQueue();
    q.setPlaylist([item(2), item(3)]);
    expect(q.size).toBe(2);
    expect(q.next().surahId).toBe(3);
    expect(q.next()).toBeNull();
  });

  it('resets to the start when the playlist changes', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(2)]);
    q.next();
    q.setPlaylist([item(9)]);
    expect(q.index).toBe(0);
    expect(q.current.surahId).toBe(9);
  });

  it('locates an index by surah id', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(18), item(36)]);
    expect(q.setIndexBySurah(18)).toBe(1);
    expect(q.current.surahId).toBe(18);
  });

  it('returns -1 for a surah outside the playlist', () => {
    const q = createQueue();
    q.setPlaylist([item(1)]);
    expect(q.setIndexBySurah(99)).toBe(-1);
    expect(q.index).toBe(0);
  });

  it('copies the playlist instead of aliasing the caller array', () => {
    const source = [item(1), item(2)];
    const q = createQueue();
    q.setPlaylist(source);
    source.push(item(3));
    expect(q.size).toBe(2);
  });

  it('copies on read so a caller cannot mutate the queue through items', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(2)]);
    const got = q.items;
    got.push(item(99));
    expect(q.size).toBe(2);
    expect(q.items).toHaveLength(2);
  });

  it('coerces a string surah id', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(18)]);
    expect(q.setIndexBySurah('18')).toBe(1);
  });

  it('coerces string ids coming from the playlist itself', () => {
    const q = createQueue();
    q.setPlaylist([{ surahId: '1', url: '/x/1.mp3' }, { surahId: '2', url: '/x/2.mp3' }]);
    expect(q.setIndexBySurah(2)).toBe(1);
    expect(q.current.url).toBe('/x/2.mp3');
  });

  it('clears back to an empty queue', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(2)]);
    q.next();
    q.clear();
    expect(q.size).toBe(0);
    expect(q.index).toBe(0);
    expect(q.current).toBeNull();
    expect(q.next()).toBeNull();
    expect(q.prev()).toBeNull();
  });

  it('degrades to empty when handed a non-array', () => {
    const q = createQueue();
    q.setPlaylist('not an array');
    expect(q.size).toBe(0);
    expect(q.current).toBeNull();
  });
});
```

- [ ] **Step 6: Run and confirm failure**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/audio/queue.js'`.

- [ ] **Step 7: Create `src/audio/queue.js`**

```js
export function createQueue() {
  let items = [];
  let at = 0;

  return {
    setPlaylist(list) {
      items = Array.isArray(list) ? list.slice() : [];
      at = 0;
    },
    setIndexBySurah(surahId) {
      const found = items.findIndex((i) => Number(i.surahId) === Number(surahId));
      if (found === -1) return -1;
      at = found;
      return at;
    },
    // Reads are getters and actions are methods. Mixing the two made `size` a
    // property while `index` stayed a method, which is a call-site trap.
    get size() { return items.length; },
    get index() { return at; },
    get current() { return items.length ? items[at] : null; },
    get items() { return items.slice(); },
    next() {
      if (at >= items.length - 1) return null;
      at += 1;
      return items[at];
    },
    prev() {
      if (at <= 0) return null;
      at -= 1;
      return items[at];
    },
    clear() { items = []; at = 0; },
  };
}
```

- [ ] **Step 8: Write `test/favorites.test.js`**

```js
import { describe, it, expect } from 'vitest';
import {
  favoriteKey, isFavorite, toggleFavorite, sortForPlayback,
} from '../src/utils/favorites.js';

const entry = (surahId, moshafId, reciter = 'الحصري') => ({
  surahId, moshafId, surahName: `سورة ${surahId}`,
  reciterName: reciter, riwayaName: 'حفص عن عاصم',
  server: 'https://server6.mp3quran.net/akdr/', addedAt: 0,
});

describe('favoriteKey', () => {
  it('composes surah and moshaf ids', () => {
    expect(favoriteKey(18, 133)).toBe('18:133');
  });

  it('coerces ids so a stored string matches the API number', () => {
    expect(favoriteKey('18', '133')).toBe('18:133');
    expect(favoriteKey(' 18 ', 133)).toBe('18:133');
  });
});

describe('isFavorite', () => {
  it('distinguishes the same surah across reciters', () => {
    const list = [entry(18, 1, 'الحصري')];
    expect(isFavorite(list, 18, 1)).toBe(true);
    expect(isFavorite(list, 18, 2)).toBe(false);
  });
});

describe('toggleFavorite', () => {
  it('adds when absent and returns a new array', () => {
    const list = [];
    const next = toggleFavorite(list, entry(18, 1));
    expect(next).toHaveLength(1);
    expect(list).toHaveLength(0);
  });

  it('removes when present', () => {
    const list = [entry(18, 1)];
    expect(toggleFavorite(list, entry(18, 1))).toHaveLength(0);
  });

  it('never duplicates the same surah+reciter pair', () => {
    let list = toggleFavorite([], entry(18, 1));
    list = toggleFavorite(list, entry(18, 1, 'other name'));
    expect(list).toHaveLength(0);
  });

  it('keeps different reciters for the same surah', () => {
    let list = toggleFavorite([], entry(18, 1, 'الحصري'));
    list = toggleFavorite(list, entry(18, 2, 'السديس'));
    expect(list).toHaveLength(2);
  });
});

describe('sortForPlayback', () => {
  it('sorts by surah number', () => {
    const list = [entry(18, 1), entry(2, 1), entry(36, 1)];
    expect(sortForPlayback(list).map((f) => f.surahId)).toEqual([2, 18, 36]);
  });

  it('breaks a same-surah tie by moshaf id', () => {
    const list = [entry(18, 133), entry(18, 1), entry(2, 9)];
    expect(sortForPlayback(list).map((f) => f.moshafId)).toEqual([9, 1, 133]);
  });

  it('does not mutate the input', () => {
    const list = [entry(18, 1), entry(2, 1)];
    sortForPlayback(list);
    expect(list[0].surahId).toBe(18);
  });
});
```

- [ ] **Step 9: Create `src/utils/favorites.js`**

```js
export function favoriteKey(surahId, moshafId) {
  // Coerced so a key built from a string id read out of storage still matches
  // one built from the numeric id the API returns.
  return `${Number(surahId)}:${Number(moshafId)}`;
}

export function isFavorite(list, surahId, moshafId) {
  const key = favoriteKey(surahId, moshafId);
  return list.some((f) => favoriteKey(f.surahId, f.moshafId) === key);
}

export function toggleFavorite(list, entry) {
  const key = favoriteKey(entry.surahId, entry.moshafId);
  const exists = list.some((f) => favoriteKey(f.surahId, f.moshafId) === key);
  if (exists) return list.filter((f) => favoriteKey(f.surahId, f.moshafId) !== key);
  return [...list, { ...entry, addedAt: Date.now() }];
}

/**
 * Two favorites of the same surah by different reciters are a supported shape,
 * so moshafId breaks the tie. Without it the comparator is not total and the
 * order falls to Array#sort stability rather than to a rule.
 */
export function sortForPlayback(list) {
  return [...list].sort((a, b) =>
    Number(a.surahId) - Number(b.surahId) || Number(a.moshafId) - Number(b.moshafId));
}
```

- [ ] **Step 10: Create `src/utils/ayah-counts.js`**

The mp3quran `suwar` endpoint returns no ayah count. Rather than add a second
network dependency for 114 immutable integers, ship them as a table. Counts were
cross-checked against the canonical total of 6236 ayat.

```js
/**
 * Ayah count per surah id. mp3quran's `suwar` endpoint has no ayah count field,
 * and these are immutable reference data, so a table beats a second runtime
 * dependency.
 *
 * Written as an explicit id: value map, NOT a positional array: an earlier
 * draft used a bare array and silently omitted surah 5, which shifted every
 * surah from 5 onward. Keying by id makes that class of error impossible.
 *
 * Built on a null prototype so an id like 'constructor' cannot resolve to an
 * inherited Object.prototype member.
 *
 * Verified against two independent live sources that agree exactly, and against
 * the canonical total of 6236 ayat: 114 keys, surah 1=7, surah 5=120,
 * surah 18=110, surah 114=6.
 */
const COUNTS = {
  1: 7, 2: 286, 3: 200, 4: 176, 5: 120, 6: 165, 7: 206, 8: 75, 9: 129, 10: 109,
  11: 123, 12: 111, 13: 43, 14: 52, 15: 99, 16: 128, 17: 111, 18: 110, 19: 98, 20: 135,
  21: 112, 22: 78, 23: 118, 24: 64, 25: 77, 26: 227, 27: 93, 28: 88, 29: 69, 30: 60,
  31: 34, 32: 30, 33: 73, 34: 54, 35: 45, 36: 83, 37: 182, 38: 88, 39: 75, 40: 85,
  41: 54, 42: 53, 43: 89, 44: 59, 45: 37, 46: 35, 47: 38, 48: 29, 49: 18, 50: 45,
  51: 60, 52: 49, 53: 62, 54: 55, 55: 78, 56: 96, 57: 29, 58: 22, 59: 24, 60: 13,
  61: 14, 62: 11, 63: 11, 64: 18, 65: 12, 66: 12, 67: 30, 68: 52, 69: 52, 70: 44,
  71: 28, 72: 28, 73: 20, 74: 56, 75: 40, 76: 31, 77: 50, 78: 40, 79: 46, 80: 42,
  81: 29, 82: 19, 83: 36, 84: 25, 85: 22, 86: 17, 87: 19, 88: 26, 89: 30, 90: 20,
  91: 15, 92: 21, 93: 11, 94: 8, 95: 8, 96: 19, 97: 5, 98: 8, 99: 8, 100: 11,
  101: 11, 102: 8, 103: 3, 104: 9, 105: 5, 106: 4, 107: 7, 108: 3, 109: 6, 110: 3,
  111: 5, 112: 4, 113: 5, 114: 6,
};

export const AYAH_COUNTS = Object.freeze(Object.assign(Object.create(null), COUNTS));

export function ayahCount(surahId) {
  const value = AYAH_COUNTS[surahId];
  return typeof value === 'number' ? value : 0;
}
```

- [ ] **Step 11: Write `test/ayah-counts.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { AYAH_COUNTS, ayahCount } from '../src/utils/ayah-counts.js';

describe('AYAH_COUNTS', () => {
  it('covers all 114 surahs', () => {
    expect(Object.keys(AYAH_COUNTS)).toHaveLength(114);
  });

  it('sums to the canonical total of 6236 ayat', () => {
    const total = Object.values(AYAH_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(6236);
  });

  it('has known values for landmark surahs', () => {
    expect(ayahCount(1)).toBe(7);
    expect(ayahCount(2)).toBe(286);
    expect(ayahCount(18)).toBe(110);
    expect(ayahCount(114)).toBe(6);
  });

  it('has surah 5 at 120, the value an earlier draft dropped', () => {
    expect(ayahCount(5)).toBe(120);
  });

  it('never returns zero for a real surah', () => {
    for (let id = 1; id <= 114; id += 1) expect(ayahCount(id)).toBeGreaterThan(0);
  });

  it('returns 0 for an unknown surah', () => {
    expect(ayahCount(0)).toBe(0);
    expect(ayahCount(115)).toBe(0);
  });

  it('does not resolve inherited Object.prototype keys', () => {
    expect(ayahCount('constructor')).toBe(0);
    expect(ayahCount('toString')).toBe(0);
    expect(ayahCount('__proto__')).toBe(0);
    expect(ayahCount('hasOwnProperty')).toBe(0);
  });

  it('has no null-prototype to inherit from', () => {
    expect(Object.getPrototypeOf(AYAH_COUNTS)).toBeNull();
  });

  it('is frozen so no module can mutate the table', () => {
    expect(Object.isFrozen(AYAH_COUNTS)).toBe(true);
  });
});
```

- [ ] **Step 12: Run all tests**

Run: `npm test`
Expected: 4 files pass and the command exits 0. Assert exit code, not a literal
test count — the counts above are illustrative.

- [ ] **Step 13: Commit**

```bash
git add src/utils/arabic.js src/audio/queue.js src/utils/favorites.js src/utils/ayah-counts.js test/
git commit -m "feat: add pure Arabic normalization, queue, favorites, and ayah counts

Arabic folding matters for search: without it the query 'احمد' never
matches 'أحمد' and 'فاطمه' never matches 'فاطمة'. Favorites key on
surahId:moshafId because moshaf.id is globally unique across all 287
entries, so the same surah by two reciters stays two records. Ayah counts
are a frozen table because mp3quran's suwar endpoint omits them and 114
immutable integers do not justify a second runtime dependency."
```

---

## Task 3: Data Layer

**Files:**
- Create: `src/api/client.js`, `src/api/quran.js`, `src/state/store.js`, `src/state/persist.js`
- Create: `test/client.test.js`, `test/quran.test.js`, `scripts/verify-api.mjs`

**Interfaces:**
- Produces: `getJSON(path, { signal, timeoutMs, retries }): Promise<any>`, `ApiError` with `.status`
- Produces: `getReciters()`, `getSuwar()`, `getRiwayat()`, `getRadios()`, `deriveStyle(moshafName)`, `surahUrl(server, surahId)`, `buildPlaylist(moshaf, suwarById)`
- Produces: `createStore(initial)` → `{ getState, setState, subscribe }`
- Produces: `readState()`, `writeState(patch)`, `readCache(key)`, `writeCache(key, data)`, `CACHE_TTL_MS`

- [ ] **Step 1: Create `src/api/client.js`**

```js
const BASE = 'https://mp3quran.net/api/v3';
const DEFAULT_TIMEOUT = 3000;

export class ApiError extends Error {
  constructor(message, cause, status) {
    super(message);
    this.name = 'ApiError';
    this.cause = cause;
    // status 0 means the request never produced a response (offline, DNS,
    // timeout); 4xx/5xx carry the real code so callers can tell a bad path
    // from a dead server.
    this.status = status ?? 0;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A 4xx is deterministic, so replaying it only spends 400ms to reach the same answer. */
function isRetryable(err) {
  return !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
}

/**
 * The Arabic copy is the only user-facing text this layer produces, so every
 * failure path must map to it — including HTTP statuses. Rethrowing the raw
 * `HTTP 404` would surface English in an Arabic interface.
 *
 * `navigator` is absent outside browsers, so it is guarded: a ReferenceError
 * here would replace the Arabic message with an opaque crash.
 */
function messageFor(err) {
  if (!(err instanceof ApiError)) {
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'لا يوجد اتصال بالإنترنت. البيانات المحفوظة متاحة.'
      : 'تعذّر جلب البيانات. تحقق من الاتصال وحاول مجدداً.';
  }
  if (err.status >= 500) return 'الخادم غير متاح الآن. حاول بعد قليل.';
  if (err.status === 404) return 'تعذّر العثور على البيانات المطلوبة.';
  if (err.status === 403) return 'لا صلاحية للوصول إلى هذه البيانات.';
  return 'تعذّر جلب البيانات. تحقق من الاتصال وحاول مجدداً.';
}

export async function getJSON(path, { signal, timeoutMs = DEFAULT_TIMEOUT, retries = 1 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${BASE}${path}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new ApiError(`HTTP ${res.status}`, undefined, res.status);
      return await res.json();
    } catch (err) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      lastError = err;
      // break, not a skipped sleep: the loop condition alone would still spend
      // another round trip reaching the same answer.
      if (!isRetryable(err)) break;
      if (attempt < retries) await sleep(400);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  throw new ApiError(messageFor(lastError), lastError, lastError?.status ?? 0);
}
```

- [ ] **Step 2: Create `src/api/quran.js`**

```js
import { getJSON } from './client.js';

/**
 * moshaf_type holds opaque codes (11, 222, 213, ...) that do NOT match the
 * 1/2/3 mapping in older api_2 docs, so the style is read from the name.
 */
export function deriveStyle(moshafName) {
  const n = moshafName || '';
  if (n.includes('المعلم')) return 'مُعلِّم';
  if (n.includes('مرتل')) return 'مرتّل';
  if (n.includes('مجود')) return 'مجوّد';
  if (n.includes('مميزة')) return 'مميّزة';
  return '';
}

export async function getReciters(signal) {
  const data = await getJSON('/reciters?language=ar', { signal, timeoutMs: 6000 });
  return (data.reciters || []).map((r) => ({
    id: r.id,
    name: r.name,
    letter: r.letter || '',
    moshaf: (r.moshaf || []).map((m) => ({
      id: m.id,
      name: m.name,
      style: deriveStyle(m.name),
      server: m.server,
      surahTotal: Number(m.surah_total) || 0,
      surahList: String(m.surah_list || '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    })),
  }));
}

export async function getSuwar(signal) {
  const data = await getJSON('/suwar?language=ar', { signal });
  // Verified field names: id, name, start_page, end_page, makkia, type.
  // makkia is 1 for Meccan / 0 for Medinan. `type` is its exact inverse, so
  // it is ignored. The endpoint carries no ayah count — see utils/ayah-counts.js.
  return (data.suwar || []).map((s) => ({
    id: Number(s.id),
    name: s.name,
    isMeccan: Number(s.makkia) === 1,
    pageStart: Number(s.start_page),
    pageEnd: Number(s.end_page),
  }));
}

export async function getRiwayat(signal) {
  const data = await getJSON('/riwayat?language=ar', { signal });
  return (data.riwayat || []).map((r) => ({ id: Number(r.id), name: r.name }));
}

export async function getRadios(signal) {
  const data = await getJSON('/radios?language=ar', { signal, timeoutMs: 6000 });
  return (data.radios || []).map((r) => ({ id: Number(r.id), name: r.name, url: r.url }));
}

export function surahUrl(server, surahId) {
  return `${server}${String(surahId).padStart(3, '0')}.mp3`;
}

/** Playlist is built from the moshaf's own surah_list, never the global list. */
export function buildPlaylist(moshaf, suwarById) {
  if (!moshaf) return [];
  return moshaf.surahList
    .map((id) => {
      const meta = suwarById.get(id);
      return {
        surahId: id,
        title: meta?.name || `سورة ${id}`,
        url: surahUrl(moshaf.server, id),
      };
    })
    .filter(Boolean);
}
```

- [ ] **Step 3: Create `src/state/store.js`**

```js
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  let queued = false;
  let pendingKeys = new Set();

  const flush = () => {
    queued = false;
    const keys = pendingKeys;
    pendingKeys = new Set();
    const snapshot = state;
    for (const fn of listeners) fn(snapshot, keys);
  };

  return {
    getState() { return state; },
    setState(patch) {
      state = { ...state, ...patch };
      pendingKeys = new Set([...pendingKeys, ...Object.keys(patch)]);
      if (!queued) {
        queued = true;
        queueMicrotask(flush);
      }
    },
    subscribe(fn, { immediate = false } = {}) {
      listeners.add(fn);
      if (immediate) fn(state, new Set(Object.keys(state)));
      return () => listeners.delete(fn);
    },
  };
}
```

Batching through `queueMicrotask` keeps a multi-key update from triggering several re-renders.

- [ ] **Step 4: Create `src/state/persist.js`**

```js
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
    if (!entry) return null;
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
```

- [ ] **Step 5: Verify the data layer against the live API**

Create `scripts/verify-api.mjs`:

```js
/**
 * Live survey of the four `moshaf_type`-shaped collections, run before the UI
 * work so field-name and classification mistakes surface here rather than in a
 * component. Not shipped and not part of the build.
 *
 * Everything asserted below is a fact about the upstream API, not a preference.
 * If one fails, the API changed — report it rather than editing the expectation.
 */
import { getReciters, getSuwar, getRiwayat, getRadios, buildPlaylist, deriveStyle } from '../src/api/quran.js';

const reciters = await getReciters();
const suwar = await getSuwar();
const riwayat = await getRiwayat();
const radios = await getRadios();

const moshafCount = reciters.reduce((n, r) => n + r.moshaf.length, 0);
const ids = reciters.flatMap((r) => r.moshaf.map((m) => m.id));
const unique = new Set(ids);

console.log('reciters        :', reciters.length, reciters.length === 241 ? 'OK' : 'MISMATCH');
console.log('moshaf          :', moshafCount, moshafCount === 287 ? 'OK' : 'MISMATCH');
console.log('unique moshaf id:', unique.size, unique.size === moshafCount ? 'OK (globally unique)' : 'COLLISION');
console.log('suwar           :', suwar.length, suwar.length === 114 ? 'OK' : 'MISMATCH');
console.log('riwayat         :', riwayat.length, riwayat.length === 20 ? 'OK' : 'MISMATCH');
console.log('radios          :', radios.length, radios.length === 177 ? 'OK' : 'MISMATCH');
// Every radio URL must be a plain audio stream the <audio> element can take
// directly. deriveStyle is called here rather than trusted from the precomputed
// m.style, so the harness actually exercises the classifier.
if (radios.some((r) => !r.url)) throw new Error('a radio entry has no url');
const unstyled = reciters.flatMap((r) => r.moshaf)
  .filter((m) => deriveStyle(m.name) === '');
console.log('unstyled moshaf :', unstyled.length, '→', unstyled.map((m) => m.name).join(' | '));
if (unstyled.length > 1) throw new Error(`${unstyled.length} unstyled moshaf; extend deriveStyle`);

const styles = new Set(reciters.flatMap((r) => r.moshaf.map((m) => deriveStyle(m.name))));
for (const required of ['مرتّل', 'مجوّد', 'مميّزة'])
  if (!styles.has(required)) throw new Error(`deriveStyle lost the ${required} branch`);
console.log('styles seen     :', [...styles].join(' | '));

// Every radio URL must be a plain audio stream the <audio> element can take
// directly. deriveStyle is called here rather than trusted from the precomputed
// m.style, so the harness actually exercises the classifier.
if (radios.some((r) => !r.url)) throw new Error('a radio entry has no url');
const unstyled = reciters.flatMap((r) => r.moshaf).filter((m) => m.style === '');
console.log('unstyled moshaf :', unstyled.length, '→', unstyled.map((m) => m.name).join(' | '));

const byId = new Map(suwar.map((s) => [s.id, s]));
const maaher = reciters.find((r) => r.moshaf.some((m) => m.surahTotal === 38));
if (!maaher) throw new Error('expected a reciter with a 38-surah moshaf');
const partial = maaher.moshaf.find((m) => m.surahTotal === 38);
const built = buildPlaylist(partial, byId);
console.log('partial playlist:', maaher.name, '->', built.length, 'surahs');
if (built.length !== 38) throw new Error(`expected 38 surahs, got ${built.length}`);
console.log('partial url     :', built[0].title, built[0].url);

// Every built entry must resolve to a real surah and a zero-padded URL, so a
// dead link can never reach the player.
for (const entry of built) {
  if (!byId.has(entry.surahId)) throw new Error(`unknown surah ${entry.surahId}`);
  if (!/\/\d{3}\.mp3$/.test(entry.url)) throw new Error(`bad url ${entry.url}`);
}
console.log('all playlist urls well-formed');
```

Run: `node scripts/verify-api.mjs`
Expected: reciters 241 OK, moshaf 287 OK, unique moshaf id OK, suwar 114 OK, riwayat 20 OK, and a non-zero styles list including مرتّل and مجوّد.

- [ ] **Step 6: Write `test/client.test.js`**

`messageFor` is the only user-facing text this layer produces, and three of its five branches cannot be reached against the live API. `fetch` is replaced per test, so no network is touched.

```js
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getJSON, ApiError } from '../src/api/client.js';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; vi.restoreAllMocks(); });

function stubFetch(response) {
  const spy = vi.fn().mockResolvedValue(response);
  globalThis.fetch = spy;
  return spy;
}

const withStatus = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({}),
});

const ARABIC = /[\u0600-\u06FF]/;

describe('getJSON error messages', () => {
  it('maps 404 to Arabic', async () => {
    stubFetch(withStatus(404));
    await expect(getJSON('/nope')).rejects.toMatchObject({ status: 404 });
    await expect(getJSON('/nope')).rejects.toThrow(ARABIC);
  });

  it('maps 5xx to Arabic', async () => {
    stubFetch(withStatus(503));
    await expect(getJSON('/boom')).rejects.toMatchObject({ status: 503 });
    await expect(getJSON('/boom')).rejects.toThrow(ARABIC);
  });

  it('maps 403 to Arabic', async () => {
    stubFetch(withStatus(403));
    await expect(getJSON('/secret')).rejects.toMatchObject({ status: 403 });
    await expect(getJSON('/secret')).rejects.toThrow(ARABIC);
  });

  it('never leaks the literal HTTP to the user', async () => {
    for (const status of [400, 403, 404, 429, 500, 503]) {
      stubFetch(withStatus(status));
      await expect(getJSON(`/x/${status}`)).rejects.toSatisfy(
        (e) => ARABIC.test(e.message) && !e.message.includes('HTTP'),
      );
    }
  });

  it('does not retry a 4xx', async () => {
    const spy = stubFetch(withStatus(404));
    await getJSON('/nope').catch(() => {});
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx exactly once', async () => {
    const spy = stubFetch(withStatus(503));
    await getJSON('/boom').catch(() => {});
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('returns parsed JSON on success', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
    await expect(getJSON('/fine')).resolves.toEqual({ ok: 1 });
  });

  it('reports status 0 for a network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('failed'));
    await expect(getJSON('/x', { retries: 0 })).rejects.toMatchObject({ status: 0 });
  });

  it('surfaces ApiError with a name', async () => {
    stubFetch(withStatus(404));
    await expect(getJSON('/nope')).rejects.toBeInstanceOf(ApiError);
    await expect(getJSON('/nope')).rejects.toHaveProperty('name', 'ApiError');
  });
});
```

- [ ] **Step 7: Write `test/quran.test.js`**

`deriveStyle` is pure and is the function that would silently mislabel 215 reciters if it drifted, so it gets its own unit coverage against the real names the live API returns.

```js
import { describe, it, expect } from 'vitest';
import { deriveStyle, surahUrl, buildPlaylist } from '../src/api/quran.js';

describe('deriveStyle', () => {
  it('classifies the three styles present in the live corpus', () => {
    expect(deriveStyle('حفص عن عاصم - مرتل')).toBe('مرتّل');
    expect(deriveStyle('المصحف المجود')).toBe('مجوّد');
    expect(deriveStyle('المصحف المعلم')).toBe('مُعلِّم');
    expect(deriveStyle('حفص عن عاصم - تلاوة مميزة')).toBe('مميّزة');
  });

  it('does not confuse المجود with مجود', () => {
    // Both fold to مجوّد because المجود contains مجود as a substring, so the
    // separate branch that used to exist for it was dead.
    expect(deriveStyle('المصحف المجود')).toBe(deriveStyle('مجود'));
  });

  it('returns empty for a riwaya name with no style word', () => {
    expect(deriveStyle('ورش عن نافع من طريق الأزرق - مرتل')).toBe('مرتّل');
    expect(deriveStyle('حفص عن عاصم - تسجيل عام 1387 هـ - 1967م')).toBe('');
    expect(deriveStyle('')).toBe('');
    expect(deriveStyle(undefined)).toBe('');
  });

  it('is case and whitespace insensitive', () => {
    expect(deriveStyle('  مرتل  ')).toBe('مرتّل');
  });
});

describe('surahUrl', () => {
  it('zero-pads the surah id to three digits', () => {
    expect(surahUrl('https://server6.mp3quran.net/akdr/', 1)).toBe('https://server6.mp3quran.net/akdr/001.mp3');
    expect(surahUrl('https://server6.mp3quran.net/akdr/', 18)).toBe('https://server6.mp3quran.net/akdr/018.mp3');
    expect(surahUrl('https://server6.mp3quran.net/akdr/', 114)).toBe('https://server6.mp3quran.net/akdr/114.mp3');
  });

  it('accepts a string id', () => {
    expect(surahUrl('https://s/', '7')).toBe('https://s/007.mp3');
  });
});

describe('buildPlaylist', () => {
  const suwarById = new Map([
    [1, { id: 1, name: 'الفاتحة' }],
    [18, { id: 18, name: 'الكهف' }],
    [114, { id: 114, name: 'الناس' }],
  ]);

  it('builds from the moshaf surahList, not the full 114', () => {
    const moshaf = { server: 'https://s/', surahList: [1, 18] };
    const list = buildPlaylist(moshaf, suwarById);
    expect(list.map((x) => x.surahId)).toEqual([1, 18]);
    expect(list[1]).toEqual({ surahId: 18, title: 'الكهف', url: 'https://s/018.mp3' });
  });

  it('honours a partial surah_list', () => {
    const moshaf = { server: 'https://s/', surahList: [18] };
    expect(buildPlaylist(moshaf, suwarById)).toHaveLength(1);
  });

  it('falls back to a generic title when metadata is missing', () => {
    const moshaf = { server: 'https://s/', surahList: [99] };
    expect(buildPlaylist(moshaf, suwarById)[0].title).toBe('سورة 99');
  });

  it('returns an empty list when there is no moshaf', () => {
    expect(buildPlaylist(null, suwarById)).toEqual([]);
  });

  it('ignores non-numeric and out-of-range entries in surahList', () => {
    const moshaf = { server: 'https://s/', surahList: [0, 1, -3, 18] };
    expect(buildPlaylist(moshaf, suwarById).map((x) => x.surahId)).toEqual([1, 18]);
  });
});
```

- [ ] **Step 8: Run everything**

Run: `npm test && node scripts/verify-api.mjs && npm run build`
Expected: all suites pass, `verify-api.mjs` exits 0 with every count exact, and the build completes. Assert exit codes, not literal test counts.

- [ ] **Step 9: Commit**

```bash
git add src/api src/state test/client.test.js test/quran.test.js scripts/verify-api.mjs
git commit -m "feat: add API client, quran data layer, store, and persistence

getJSON enforces a per-attempt timeout (6s for the 191KB reciter payload),
retries only 5xx and network failures, and maps every failure path to
Arabic copy so an HTTP status never reaches the user as an English
string. ApiError keeps .status for programmatic callers.

The store batches notifications through queueMicrotask so a multi-key
patch renders once. deriveStyle parses the moshaf name rather than
moshaf_type, whose real values are opaque codes like 11 and 222."
```

---

## Task 4: Audio Core — the highest-risk component

**Files:**
- Create: `src/audio/engine.js`, `src/audio/mediaSession.js`, `test/engine.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (no API, no store)
- Produces: `createEngine()` → `{ play, pause, toggle, seekBy, restart, setVolume, on, destroy, element }`
- Produces: `createMediaSession({ onPlay, onPause, onSeekBy, onNext, onPrev, onStop })` → `{ update(item), setState(state), destroy }`

> **This is the component most likely to need design changes.** Build and device-test it before anything else. If autoplay on track change is blocked on a real Android device, the queue and repeat design must change.

- [ ] **Step 1: Create `src/audio/engine.js`**

```js
const ENDED_GUARD_MS = 400;

/**
 * Owns the single <audio> element for the whole session.
 *
 * Creating a new Audio() per track makes mobile browsers treat each one as
 * a fresh autoplay request and block it. Reusing one element preserves the
 * user's activation, so later tracks start without another tap.
 *
 * Audio is deliberately NOT routed through AudioContext: the OS suspends
 * the context when the screen locks, killing playback seconds later.
 */
export function createEngine() {
  const el = document.createElement('audio');
  el.preload = 'auto';
  el.playsInline = true;
  el.setAttribute('aria-hidden', 'true');
  el.style.display = 'none';
  document.body.appendChild(el);

  const listeners = new Map();
  let current = null;
  let retryUsed = false;
  let endedAt = 0;

  const emit = (event, detail) => {
    const set = listeners.get(event);
    if (set) for (const fn of set) fn(detail);
  };

  const setLoading = (value) => {
    if (current) current.loading = value;
    emit('loading', value);
  };

  el.addEventListener('loadstart', () => setLoading(true));
  el.addEventListener('waiting', () => setLoading(true));
  el.addEventListener('canplay', () => setLoading(false));
  el.addEventListener('playing', () => setLoading(false));

  el.addEventListener('play', () => emit('play', current));
  el.addEventListener('pause', () => {
    if (el.ended) return;
    emit('pause', current);
  });

  el.addEventListener('timeupdate', () => {
    emit('time', { currentTime: el.currentTime, duration: el.duration || 0 });
  });

  el.addEventListener('ended', () => {
    const now = Date.now();
    if (now - endedAt < ENDED_GUARD_MS) return;
    endedAt = now;
    emit('ended', current);
  });

  el.addEventListener('error', () => {
    if (retryUsed) {
      setLoading(false);
      emit('error', current);
      return;
    }
    retryUsed = true;
    setLoading(true);
    el.load();
    el.play().catch(() => {
      setLoading(false);
      emit('error', current);
    });
  });

  return {
    element: el,

    async play(item) {
      const changing = !current || current.url !== item.url;
      current = { ...item, loading: true };
      emit('track', current);

      if (changing) {
        retryUsed = false;
        el.src = item.url;
        el.load();
      }

      try {
        await el.play();
      } catch (err) {
        setLoading(false);
        emit('blocked', { item: current, error: err });
      }
    },

    pause() { el.pause(); },

    toggle() {
      if (el.paused) {
        if (current) this.play(current);
      } else {
        el.pause();
      }
    },

    seekBy(delta) {
      if (!current || current.seekable === false) return;
      const max = Number.isFinite(el.duration) ? el.duration : Infinity;
      el.currentTime = Math.min(Math.max(el.currentTime + delta, 0), max);
    },

    restart() {
      if (!current || current.seekable === false) return;
      el.currentTime = 0;
      if (el.paused) el.play().catch(() => {});
    },

    setVolume(v) { el.volume = Math.min(Math.max(v, 0), 1); },
    getVolume() { return el.volume; },
    getCurrent() { return current; },

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },

    destroy() {
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
      listeners.clear();
    },
  };
}
```

`seekBy` and `restart` no-op when `seekable === false`, which is how radio mode drops the progress bar and skip buttons without branching in the UI.

- [ ] **Step 2: Write `test/engine.test.js`**

```js
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEngine } from '../src/audio/engine.js';

const surah = (n) => ({
  surahId: n, url: `https://x/${n}.mp3`, title: `سورة ${n}`,
  kind: 'surah', seekable: true,
});

describe('engine', () => {
  let engine;
  beforeEach(() => {
    // happy-dom does not implement play(); record intent instead.
    vi.spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockImplementation(function mockPlay() { this._playing = true; return Promise.resolve(); });
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause')
      .mockImplementation(function mockPause() { this._playing = false; });
    vi.spyOn(window.HTMLMediaElement.prototype, 'load')
      .mockImplementation(function mockLoad() {});
    engine = createEngine();
  });

  afterEach(() => { engine.destroy(); vi.restoreAllMocks(); });

  it('creates exactly one audio element and keeps it in the DOM', () => {
    expect(document.querySelectorAll('audio')).toHaveLength(1);
    expect(engine.element.isConnected).toBe(true);
  });

  it('emits track then play and does not create a new element', async () => {
    const events = [];
    engine.on('track', () => events.push('track'));
    engine.on('play', () => events.push('play'));
    await engine.play(surah(1));
    expect(events).toEqual(['track', 'play']);
    expect(document.querySelectorAll('audio')).toHaveLength(1);
  });

  it('reuses the same element when switching tracks', async () => {
    await engine.play(surah(1));
    const first = engine.element;
    await engine.play(surah(2));
    expect(engine.element).toBe(first);
    expect(document.querySelectorAll('audio')).toHaveLength(1);
  });

  it('skips seek and restart when the item is not seekable', async () => {
    await engine.play({ ...surah(1), seekable: false, kind: 'radio' });
    engine.element.currentTime = 0;
    engine.seekBy(10);
    expect(engine.element.currentTime).toBe(0);
    engine.restart();
    expect(engine.element.currentTime).toBe(0);
  });

  it('seeks by the requested delta when seekable', async () => {
    await engine.play(surah(1));
    engine.element.currentTime = 30;
    engine.seekBy(-10);
    expect(engine.element.currentTime).toBeCloseTo(20, 1);
  });

  it('emits ended once for repeated ended events', () => {
    let count = 0;
    engine.on('ended', () => { count += 1; });
    engine.element.dispatchEvent(new Event('ended'));
    engine.element.dispatchEvent(new Event('ended'));
    expect(count).toBe(1);
  });

  it('reports blocked playback instead of throwing', async () => {
    window.HTMLMediaElement.prototype.play.mockRejectedValueOnce(new Error('NotAllowedError'));
    const blocked = vi.fn();
    engine.on('blocked', blocked);
    await engine.play(surah(1));
    expect(blocked).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/audio/engine.js'`.

- [ ] **Step 4: Run and confirm pass**

Run: `npm test`
Expected: 4 files, 29 tests, all passing.

- [ ] **Step 5: Create `src/audio/mediaSession.js`**

```js
const ICON = '/quran_api/icons/icon-512.png';

/**
 * Handlers are registered at bootstrap rather than after the first play,
 * otherwise lock-screen controls are absent until audio has already started.
 * Each action is guarded independently because support varies by browser.
 */
export function createMediaSession(handlers) {
  const ms = navigator.mediaSession;
  const bound = new Map();

  const set = (action, fn) => {
    if (!ms || typeof ms.setActionHandler !== 'function') return;
    try {
      ms.setActionHandler(action, fn);
      bound.set(action, fn);
    } catch {
      /* action unsupported in this browser */
    }
  };

  set('play', handlers.onPlay);
  set('pause', handlers.onPause);
  set('stop', handlers.onStop);
  set('seekbackward', (e) => handlers.onSeekBy(-(e?.seekOffset || 10)));
  set('seekforward', (e) => handlers.onSeekBy(e?.seekOffset || 10));
  set('previoustrack', handlers.onPrev);
  set('nexttrack', handlers.onNext);

  return {
    update(item) {
      if (!ms) return;
      try {
        ms.metadata = new MediaMetadata({
          title: item.title,
          artist: item.artist || '',
          album: item.album || '',
          artwork: [
            { src: `${ICON}`, sizes: '192x192', type: 'image/png' },
            { src: `${ICON}`, sizes: '512x512', type: 'image/png' },
          ],
        });
        ms.playbackState = item.isPlaying ? 'playing' : 'paused';
      } catch {
        /* MediaMetadata unavailable */
      }
    },

    setState(isPlaying) {
      if (ms) ms.playbackState = isPlaying ? 'playing' : 'paused';
    },

    setPosition(currentTime, duration, rate = 1) {
      if (!ms?.setPositionState || !Number.isFinite(duration) || duration <= 0) return;
      try {
        ms.setPositionState({
          duration,
          position: Math.min(currentTime, duration),
          playbackRate: rate,
        });
      } catch {
        /* ignore: browsers throw when position exceeds duration mid-seek */
      }
    },

    destroy() {
      if (!ms) return;
      for (const action of bound.keys()) {
        try { ms.setActionHandler(action, null); } catch { /* ignore */ }
      }
    },
  };
}
```

- [ ] **Step 6: Wire MediaSession in `src/main.js` and smoke-test in the browser**

```js
import { createEngine } from './audio/engine.js';
import { createMediaSession } from './audio/mediaSession.js';

const engine = createEngine();
const session = createMediaSession({
  onPlay: () => engine.play(engine.getCurrent()),
  onPause: () => engine.pause(),
  onStop: () => engine.pause(),
  onSeekBy: (d) => engine.seekBy(d),
  onNext: () => document.dispatchEvent(new CustomEvent('quran:next')),
  onPrev: () => document.dispatchEvent(new CustomEvent('quran:prev')),
});

engine.on('track', (item) => session.update({ ...item, isPlaying: !engine.element.paused }));
engine.on('play', () => session.setState(true));
engine.on('pause', () => session.setState(false));
engine.on('time', ({ currentTime, duration }) =>
  session.setPosition(currentTime, duration, engine.element.playbackRate || 1));
```

Add a temporary `<button id="probe">` that calls `engine.play({ url: 'https://server6.mp3quran.net/akdr/001.mp3', title: 'الفاتحة', kind: 'surah', seekable: true })`.

Run: `npm run dev`, open the URL, click the button.
Expected: audio plays. Lock the phone. Confirm audio continues and lock-screen controls appear with "الفاتحة".

**Gate:** verify on a real Android device before continuing. Record the result in the commit message.

- [ ] **Step 7: Commit**

```bash
git add src/audio/engine.js src/audio/mediaSession.js src/main.js test/engine.test.js
git commit -m "feat: add persistent audio engine and MediaSession controls

One <audio> element lives for the whole session: mobile browsers treat a
fresh new Audio() as a new autoplay request and block it, so reusing the
element preserves activation across track changes. Audio is never routed
through AudioContext because the OS suspends that context on screen lock.
MediaSession handlers register at bootstrap so lock-screen controls exist
before audio starts."
```

---

## Task 5: Sticky Player

**Files:**
- Create: `src/ui/player.js`, `src/styles/components.css`
- Modify: `index.html`

**Interfaces:**
- Consumes: `createEngine()` from Task 4, tokens from Task 1
- Produces: `createPlayer({ root, store, queue })` → `{ render, destroy }`

- [ ] **Step 1: Create `src/ui/player.js`**

```js
import { h, qs } from '../utils/dom.js';

const fmt = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export function createPlayer({ root, store, engine, onNext, onPrev, onToggleFavorite }) {
  const icon = (d) => h('span', { class: 'ic', 'aria-hidden': 'true', html: d });

  const els = {
    heart: h('button', { class: 'pl-heart', type: 'button', 'aria-label': 'إضافة إلى المفضلة' }, icon('&#9825;')),
    title: h('div', { class: 'pl-title' }),
    sub: h('div', { class: 'pl-sub' }),
    time: h('span', { class: 'pl-time', dir: 'ltr' }, '0:00'),
    bar: h('div', { class: 'pl-bar-fill' }),
    play: h('button', { class: 'pl-btn pl-play', type: 'button', 'aria-label': 'تشغيل' }, icon('&#9654;')),
    prev: h('button', { class: 'pl-btn', type: 'button', 'aria-label': 'السورة السابقة' }, icon('&#9198;')),
    next: h('button', { class: 'pl-btn', type: 'button', 'aria-label': 'السورة التالية' }, icon('&#9197;')),
    back: h('button', { class: 'pl-btn', type: 'button', 'aria-label': 'تأخير 10 ثوانٍ' }, icon('&#9194;')),
    fwd: h('button', { class: 'pl-btn', type: 'button', 'aria-label': 'تقديم 10 ثوانٍ' }, icon('&#9193;')),
    repeat: h('button', { class: 'pl-btn', type: 'button', 'aria-label': 'تكرار السورة' }, icon('&#128257;')),
  };

  const progress = h('div', { class: 'pl-progress' }, els.bar);
  const controls = h('div', { class: 'pl-controls' },
    els.repeat, els.prev, els.back, els.play, els.fwd, els.next);
  const seekRow = h('div', { class: 'pl-seek' }, progress, els.time);

  root.append(
    h('div', { class: 'pl-inner' },
      h('div', { class: 'pl-head' },
        h('div', { class: 'pl-names' }, els.title, els.sub),
        els.heart),
      seekRow, controls),
  );
  root.hidden = true;

  els.play.addEventListener('click', () => engine.toggle());
  els.back.addEventListener('click', () => engine.seekBy(-10));
  els.fwd.addEventListener('click', () => engine.seekBy(10));
  els.prev.addEventListener('click', () => onPrev());
  els.next.addEventListener('click', () => onNext());
  els.repeat.addEventListener('click', () => {
    const next = store.getState().repeat === 'one' ? 'off' : 'one';
    store.setState({ repeat: next });
  });
  els.heart.addEventListener('click', () => onToggleFavorite());

  engine.on('time', ({ currentTime, duration }) => {
    els.time.textContent = `${fmt(currentTime)} / ${fmt(duration)}`;
    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
    els.bar.style.inlineSize = `${pct}%`;
  });

  function render() {
    const s = store.getState();
    const p = s.playback;

    if (!p || !p.kind) { root.hidden = true; return; }
    root.hidden = false;

    const isRadio = p.kind === 'radio';
    els.title.textContent = p.title || '';
    els.sub.textContent = p.reciterName || '';

    // Radio streams send Accept-Ranges: none, so no progress or seeking.
    seekRow.hidden = isRadio;
    els.back.hidden = isRadio;
    els.fwd.hidden = isRadio;
    els.prev.hidden = isRadio;
    els.next.hidden = isRadio;
    els.repeat.hidden = isRadio;
    els.play.innerHTML = s.playback.isPlaying ? '&#10073;&#10073;' : '&#9654;';
    els.play.setAttribute('aria-label', s.playback.isPlaying ? 'إيقاف' : 'تشغيل');
    els.repeat.classList.toggle('is-on', s.repeat === 'one');
    els.repeat.setAttribute('aria-pressed', String(s.repeat === 'one'));
    els.heart.innerHTML = p.isFavorite ? '&#9829;' : '&#9825;';
    els.heart.classList.toggle('is-on', Boolean(p.isFavorite));
    els.heart.setAttribute('aria-pressed', String(Boolean(p.isFavorite)));
  }

  store.subscribe((s, keys) => {
    if (keys.has('playback') || keys.has('repeat')) render();
  }, { immediate: true });

  return { render, root: qs('.pl-inner', root) };
}
```

- [ ] **Step 2: Create `src/utils/dom.js`**

```js
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const frag = (...nodes) => {
  const f = document.createDocumentFragment();
  for (const n of nodes.flat()) if (n) f.append(n);
  return f;
};

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
export const on = (el, ev, fn, opts) => { el.addEventListener(ev, fn, opts); return () => el.removeEventListener(ev, fn, opts); };
```

- [ ] **Step 3: Add player styles to `src/styles/components.css`**

```css
.pl {
  position: fixed;
  inset-inline: 0;
  inset-block-end: 0;
  z-index: 40;
  background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
  backdrop-filter: blur(14px);
  border-block-start: 1px solid var(--border);
  box-shadow: var(--shadow);
  padding: var(--sp-2) var(--sp-4) calc(var(--sp-2) + env(safe-area-inset-bottom));
}
.pl-inner { max-inline-size: var(--content-max); margin-inline: auto; display: grid; gap: var(--sp-2); }
.pl-head { display: flex; align-items: center; gap: var(--sp-3); }
.pl-names { min-inline-size: 0; flex: 1; }
.pl-title { font-family: var(--font-quran); font-size: var(--fs-lg); font-weight: 700;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-sub { font-size: var(--fs-xs); color: var(--text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-heart { inline-size: var(--tap); block-size: var(--tap); border-radius: var(--r-full);
  font-size: var(--fs-xl); color: var(--text-muted); }
.pl-heart.is-on { color: var(--danger); }

.pl-seek { display: flex; align-items: center; gap: var(--sp-3); }
.pl-progress { flex: 1; block-size: 4px; background: var(--border); border-radius: var(--r-full); overflow: hidden; }
.pl-bar-fill { display: block; block-size: 100%; inline-size: 0; background: var(--accent); }
.pl-time { font-size: var(--fs-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }

.pl-controls { display: flex; align-items: center; justify-content: center; gap: var(--sp-2); }
.pl-btn { inline-size: var(--tap); block-size: var(--tap); border-radius: var(--r-full);
  display: grid; place-items: center; color: var(--text); font-size: var(--fs-lg); }
.pl-btn:hover { background: var(--surface-hover); }
.pl-btn.is-on { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
.pl-play { inline-size: var(--tap-lg); block-size: var(--tap-lg); background: var(--accent); color: var(--accent-contrast); }
.pl-play:hover { background: var(--accent-strong); }
.ic { line-height: 1; }

@media (min-width: 768px) {
  .pl-controls { gap: var(--sp-3); }
}
```

- [ ] **Step 4: Reserve space so the player never covers the last card**

In `src/styles/base.css` append:

```css
body { padding-block-end: calc(var(--player-h) + env(safe-area-inset-bottom) + var(--sp-4)); }
body.no-player { padding-block-end: env(safe-area-inset-bottom); }
```

Toggle the `no-player` class from `player.js` when `root.hidden` becomes true.

- [ ] **Step 5: Verify and commit**

Run: `npm test` then `npm run dev`. Click a test button that plays a surah.
Expected: the player appears fixed at the bottom, progress advances, seek buttons work. Radio mode hides the seek row.

```bash
git add src/ui/player.js src/utils/dom.js src/styles
git commit -m "feat: add sticky bottom player with seek, repeat, and heart

Radio streams send Accept-Ranges: none, so the player hides the progress
bar and skip controls in radio mode rather than offering dead buttons."
```

---

## Task 6: Navigation, Search, and Favorites UI

**Files:**
- Create: `src/ui/shell.js`, `src/ui/search.js`, `src/ui/reciters.js`, `src/ui/surahs.js`, `src/ui/favorites.js`, `src/ui/radio.js`
- Modify: `index.html`, `src/main.js`

**Interfaces:**
- Consumes: `createStore`, `buildPlaylist`, `normalize`/`matchesAll`, favorites helpers, `createQueue`, `createEngine`
- Produces: four view containers in `index.html` (`#view-reciters`, `#view-surahs`, `#view-favorites`, `#view-radio`)

- [ ] **Step 1: Write the shell in `index.html`**

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#241f1f">
<meta name="description" content="استماع لتلاوات القرآن الكريم بأصوات كبار القرّاء">
<title>القرآن الكريم</title>
<link rel="icon" href="/quran_api/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/quran_api/icons/apple-touch-icon.png">
<script>
  // Runs before first paint so the theme never flashes.
  (function () {
    try {
      var saved = JSON.parse(localStorage.getItem('quran.state.v2') || '{}').theme || 'auto';
      var dark = saved === 'dark' || (saved === 'auto' &&
        matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    } catch (e) {
      document.documentElement.dataset.theme = 'dark';
    }
  })();
</script>
</head>
<body>
  <header class="appbar">
    <h1 class="appbar-title">القرآن الكريم</h1>
    <div class="appbar-actions">
      <button id="theme-toggle" class="icon-btn" type="button" aria-label="تبديل السمة"></button>
      <button id="install" class="icon-btn" type="button" aria-label="تثبيت التطبيق" hidden>&#x1F4E6;</button>
    </div>
  </header>

  <div class="searchbar">
    <input id="search" type="search" inputmode="search" autocomplete="off"
           placeholder="ابحث عن سورة أو قارئ" aria-label="ابحث عن سورة أو قارئ">
  </div>

  <nav class="tabs" role="tablist" aria-label="الأقسام">
    <button class="tab" role="tab" data-tab="reciters"   aria-selected="true">القرّاء</button>
    <button class="tab" role="tab" data-tab="surahs"     aria-selected="false">السور</button>
    <button class="tab" role="tab" data-tab="favorites"  aria-selected="false">المفضلة</button>
    <button class="tab" role="tab" data-tab="radio"      aria-selected="false">البث</button>
  </nav>

  <main class="views">
    <section id="view-reciters"  class="view" role="tabpanel"></section>
    <section id="view-surahs"    class="view" role="tabpanel" hidden></section>
    <section id="view-favorites" class="view" role="tabpanel" hidden></section>
    <section id="view-radio"     class="view" role="tabpanel" hidden></section>
  </main>

  <div class="banner" id="banner" role="status" hidden></div>
  <div class="player" id="player" hidden></div>
  <div class="toast" id="toast" role="status" hidden></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `src/ui/shell.js`**

```js
import { qs, qsa } from '../utils/dom.js';
import { writeState } from '../state/persist.js';

const TABS = ['reciters', 'surahs', 'favorites', 'radio'];

export function createShell({ store }) {
  const banner = qs('#banner');

  function applyTheme(theme) {
    const dark = theme === 'dark' || (theme === 'auto' &&
      matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    qs('#theme-toggle').textContent = dark ? '\u{1F319}' : '\u{2600}';
    qs('#theme-toggle').setAttribute('aria-label', dark ? 'الوضع الليلي مفعّل' : 'الوضع النهاري مفعّل');
  }

  function switchTab(name) {
    store.setState({ activeTab: name });
  }

  for (const btn of qsa('.tab')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }

  qs('#theme-toggle').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(store.getState().theme) + 1) % order.length];
    store.setState({ theme: next });
    writeState({ theme: next });
    applyTheme(next);
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (store.getState().theme === 'auto') applyTheme('auto');
  });

  store.subscribe((s, keys) => {
    if (keys.has('activeTab')) {
      for (const t of TABS) {
        qs(`#view-${t}`).hidden = t !== s.activeTab;
        const btn = qs(`.tab[data-tab="${t}"]`);
        btn.setAttribute('aria-selected', String(t === s.activeTab));
      }
      scrollTo({ top: 0, behavior: 'instant' });
    }
    if (keys.has('offline')) {
      banner.hidden = !s.offline;
      banner.textContent = s.offline ? 'لا يوجد اتصال — تتصفّح البيانات المحفوظة' : '';
    }
  });

  applyTheme(store.getState().theme);
  const active = store.getState().activeTab;
  for (const t of TABS) qs(`#view-${t}`).hidden = t !== active;

  return {
    banner(message) { banner.textContent = message; banner.hidden = !message; },
  };
}
```

- [ ] **Step 3: Create `src/ui/reciters.js`**

```js
import { h, frag } from '../utils/dom.js';
import { matchesAll } from '../utils/arabic.js';

export function createRecitersView({ root, store, onSelect }) {
  const grid = h('div', { class: 'grid grid-reciters' });
  root.append(grid);

  function render() {
    const s = store.getState();
    const list = s.query
      ? s.reciters.filter((r) =>
          matchesAll(r.name, s.query) ||
          r.moshaf.some((m) => matchesAll(m.name, s.query)))
      : s.reciters;

    grid.replaceChildren();
    if (list.length === 0) {
      grid.append(h('p', { class: 'empty' }, s.reciters.length
        ? 'لا نتائج مطابقة'
        : 'جارٍ تحميل القرّاء…'));
      return;
    }

    const nodes = list.map((r) => {
      const selected = r.moshaf.some((m) => m.id === s.selectedMoshafId);
      const chips = r.moshaf.length
        ? frag(r.moshaf.map((m) =>
            h('span', { class: 'chip' }, m.style || m.name)))
        : h('span', { class: 'chip muted' }, 'لا روايات');

      return h('button', {
        class: `card reciter${selected ? ' is-selected' : ''}`,
        type: 'button',
        onclick: () => onSelect(r),
      },
        h('span', { class: 'reciter-name' }, r.name),
        h('span', { class: 'reciter-meta' },
          `${r.moshaf.length} رواية · ${r.moshaf[0]?.surahTotal || 0} سورة`),
        chips);
    });

    grid.replaceChildren(frag(nodes));
  }

  store.subscribe((s, keys) => {
    if (keys.has('reciters') || keys.has('query') || keys.has('selectedMoshafId')) render();
  }, { immediate: true });

  return { render };
}
```

- [ ] **Step 4: Create `src/ui/surahs.js`**

```js
import { h, frag } from '../utils/dom.js';
import { matchesAll } from '../utils/arabic.js';
import { isFavorite } from '../utils/favorites.js';
import { AYAH_COUNTS } from '../utils/ayah-counts.js';

export function createSurahsView({ root, store, onPlay, onToggleFavorite }) {
  const grid = h('div', { class: 'grid grid-surahs' });
  root.append(grid);

  function render() {
    const s = store.getState();
    const moshaf = s.selectedMoshaf;
    grid.replaceChildren();

    if (!moshaf) {
      grid.append(h('p', { class: 'empty' },
        'اختر قارئاً من تبويب «القرّاء» أولاً لعرض سوره'));
      return;
    }

    const ids = s.query
      ? moshaf.surahList.filter((id) =>
          matchesAll(s.suwarById.get(id)?.name || '', s.query))
      : moshaf.surahList;

    if (ids.length === 0) {
      grid.append(h('p', { class: 'empty' },
        s.suwarById.size ? 'لا نتائج مطابقة' : 'جارٍ التحميل…'));
      return;
    }

    const nodes = ids.map((id) => {
      const meta = s.suwarById.get(id);
      const fav = isFavorite(s.favorites, id, moshaf.id);
      const isNow = s.playback?.kind === 'surah' &&
        s.playback.surahId === id && s.playback.moshafId === moshaf.id;

      return h('div', {
        class: `card surah${isNow ? ' is-playing' : ''}`,
        role: 'button',
        tabindex: '0',
        onclick: () => onPlay(id),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(id); }
        },
      },
        h('span', { class: 'surah-place' },
          meta?.isMeccan ? 'مكية' : 'مدنية'),
        h('span', { class: 'surah-name' }, meta?.name || `سورة ${id}`),
        h('span', { class: 'ayah-badge', 'aria-hidden': 'true' },
          String(AYAH_COUNTS[id] ?? '')),
        h('span', { class: 'ayah-label' },
          `${AYAH_COUNTS[id] ?? '؟'} آية`),
        h('button', {
          class: `heart${fav ? ' is-on' : ''}`,
          type: 'button',
          'aria-pressed': String(fav),
          'aria-label': fav ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة',
          onclick: (e) => { e.stopPropagation(); onToggleFavorite(id); },
          html: fav ? '&#9829;' : '&#9825;',
        }));
    });

    grid.replaceChildren(frag(nodes));
  }

  store.subscribe((s, keys) => {
    if (keys.has('selectedMoshaf') || keys.has('query') || keys.has('favorites') ||
        keys.has('playback') || keys.has('suwarById')) render();
  }, { immediate: true });

  return { render };
}
```

- [ ] **Step 5: Create `src/ui/favorites.js`**

```js
import { h } from '../utils/dom.js';
import { sortForPlayback } from '../utils/favorites.js';

export function createFavoritesView({ root, store, onPlay, onRemove, onPlayAll }) {
  const head = h('div', { class: 'fav-head' });
  const list = h('div', { class: 'grid grid-fav' });
  root.append(head, list);

  function render() {
    const s = store.getState();
    const favs = s.favorites;
    head.replaceChildren();

    if (favs.length === 0) {
      list.replaceChildren(h('p', { class: 'empty' },
        'لا توجد سور في المفضلة. اضغط القلب في تبويب «السور» لحفظ سورة بصوت قارئها.'));
      return;
    }

    head.append(
      h('h2', { class: 'fav-count' }, `${favs.length} سورة`),
      h('button', { class: 'btn-primary', type: 'button', onclick: () => onPlayAll() },
        'تشغيل الكل'),
    );

    const frag = document.createDocumentFragment();
    for (const f of sortForPlayback(favs)) {
      frag.append(h('div', {
        class: 'card fav', role: 'button', tabindex: '0',
        onclick: () => onPlay(f),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(f); } },
      },
        h('span', { class: 'surah-name' }, f.surahName),
        h('span', { class: 'reciter-meta' }, `${f.reciterName} · ${f.riwayaName}`),
        h('button', {
          class: 'heart is-on', type: 'button', 'aria-label': 'إزالة من المفضلة',
          onclick: (e) => { e.stopPropagation(); onRemove(f); },
          html: '&#9829;',
        })));
    }
    list.replaceChildren(frag);
  }

  store.subscribe((s, keys) => {
    if (keys.has('favorites')) render();
  }, { immediate: true });

  return { render };
}
```

- [ ] **Step 6: Create `src/ui/radio.js`**

```js
import { h } from '../utils/dom.js';
import { matchesAll } from '../utils/arabic.js';

export function createRadioView({ root, store, onPlay }) {
  const list = h('div', { class: 'list' });
  root.append(list);

  function render() {
    const s = store.getState();
    const items = s.query
      ? s.radios.filter((r) => matchesAll(r.name, s.query))
      : s.radios;

    list.replaceChildren();
    if (items.length === 0) {
      list.append(h('p', { class: 'empty' }, s.radios.length ? 'لا نتائج مطابقة' : 'جارٍ تحميل القنوات…'));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const r of items) {
      const on = s.playback?.kind === 'radio' && s.playback.url === r.url;
      frag.append(h('button', {
        class: `row${on ? ' is-playing' : ''}`, type: 'button', onclick: () => onPlay(r),
      },
        h('span', { class: 'row-dot' }),
        h('span', { class: 'row-name' }, r.name)));
    }
    list.append(frag);
  }

  store.subscribe((s, keys) => {
    if (keys.has('radios') || keys.has('query') || keys.has('playback')) render();
  }, { immediate: true });

  return { render };
}
```

- [ ] **Step 7: Create `src/ui/search.js`**

```js
import { qs } from '../utils/dom.js';

export function createSearch({ store }) {
  const input = qs('#search');
  let timer;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => store.setState({ query: input.value.trim() }), 120);
  });

  store.subscribe((s) => {
    if (s.query && input.value.trim() !== s.query) input.value = s.query;
  });

  return { input };
}
```

- [ ] **Step 8: Add remaining component styles**

Append to `src/styles/components.css`:

```css
.appbar { position: sticky; top: 0; z-index: 30; display: flex; align-items: center;
  justify-content: space-between; gap: var(--sp-3);
  block-size: var(--appbar-h); padding-inline: var(--sp-4);
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(12px); border-block-end: 1px solid var(--border);
  padding-block-start: env(safe-area-inset-top); }
.appbar-title { font-family: var(--font-quran); font-size: var(--fs-xl); }
.appbar-actions { display: flex; gap: var(--sp-1); }
.icon-btn { inline-size: var(--tap); block-size: var(--tap); border-radius: var(--r-full);
  display: grid; place-items: center; font-size: var(--fs-lg); }
.icon-btn:hover { background: var(--surface-hover); }

.searchbar { position: sticky; top: var(--appbar-h); z-index: 29; padding: var(--sp-3) var(--sp-4);
  background: var(--bg); }
#search { inline-size: 100%; min-block-size: var(--tap); padding: var(--sp-2) var(--sp-4);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-full);
  color: var(--text); }
#search::placeholder { color: var(--text-faint); }

.tabs { position: sticky; top: calc(var(--appbar-h) + 61px); z-index: 28;
  display: flex; gap: var(--sp-1); padding: 0 var(--sp-4) var(--sp-2);
  background: var(--bg); border-block-end: 1px solid var(--border); }
.tab { flex: 1; min-block-size: var(--tap); border-radius: var(--r-md);
  font-size: var(--fs-sm); color: var(--text-muted); }
.tab[aria-selected='true'] { background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent-strong); font-weight: 600; }

.views { max-inline-size: var(--content-max); margin-inline: auto; padding: var(--sp-4); }
.view { display: grid; gap: var(--sp-3); }
.grid { display: grid; gap: var(--sp-3); }
.grid-reciters { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
.grid-surahs { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }
.grid-fav { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }

.card { position: relative; display: grid; gap: var(--sp-1); padding: var(--sp-4);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md);
  text-align: start; transition: background .15s var(--ease), border-color .15s var(--ease); }
.card:hover { background: var(--surface-hover); border-color: var(--accent); }
.reciter.is-selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.reciter-name { font-family: var(--font-quran); font-size: var(--fs-lg); font-weight: 700; }
.reciter-meta { font-size: var(--fs-xs); color: var(--text-muted); }
.chip { display: inline-block; padding: 2px var(--sp-2); border-radius: var(--r-full);
  background: color-mix(in srgb, var(--gold) 22%, transparent); color: var(--gold);
  font-size: var(--fs-xs); margin-inline-end: var(--sp-1); }
.chip.muted { background: var(--surface-hover); color: var(--text-faint); }

.surah { place-items: center; text-align: center; padding: var(--sp-3); gap: var(--sp-1); }
.surah-place { font-size: var(--fs-xs); color: var(--text-faint); }
.surah-name { font-family: var(--font-quran); font-size: var(--fs-lg); font-weight: 700; }
.ayah-badge { inline-size: 36px; block-size: 36px; display: grid; place-items: center;
  border: 1px solid var(--gold); border-radius: var(--r-full); color: var(--gold);
  font-size: var(--fs-xs); font-variant-numeric: tabular-nums; }
.ayah-label { font-size: var(--fs-xs); color: var(--text-muted); }
.surah.is-playing { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.heart { position: absolute; inset-block-start: var(--sp-1); inset-inline-end: var(--sp-1);
  inline-size: var(--tap); block-size: var(--tap); font-size: var(--fs-lg);
  color: var(--text-faint); display: grid; place-items: center; }
.heart.is-on { color: var(--danger); }

.list { display: grid; gap: var(--sp-1); }
.row { display: flex; align-items: center; gap: var(--sp-3); min-block-size: var(--tap);
  padding: var(--sp-2) var(--sp-4); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--r-md); text-align: start; }
.row:hover { background: var(--surface-hover); }
.row-dot { inline-size: 8px; block-size: 8px; border-radius: var(--r-full); background: var(--text-faint); }
.row.is-playing .row-dot { background: var(--accent); }
.row-name { font-size: var(--fs-sm); }

.empty { color: var(--text-muted); text-align: center; padding: var(--sp-6) var(--sp-4); }
.fav-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
.fav-count { font-size: var(--fs-sm); color: var(--text-muted); font-weight: 400; }
.btn-primary { min-block-size: var(--tap); padding-inline: var(--sp-4); border-radius: var(--r-full);
  background: var(--accent); color: var(--accent-contrast); font-weight: 600; }

.banner { position: fixed; inset-block-start: var(--appbar-h); inset-inline: 0; z-index: 35;
  padding: var(--sp-2) var(--sp-4); background: var(--gold); color: #241f1f;
  font-size: var(--fs-sm); text-align: center; }
.toast { position: fixed; inset-block-end: calc(var(--player-h) + var(--sp-4)); inset-inline: 0;
  z-index: 45; margin-inline: auto; inline-size: fit-content; max-inline-size: 90%;
  padding: var(--sp-3) var(--sp-4); border-radius: var(--r-md); background: var(--bg-elevated);
  border: 1px solid var(--accent); box-shadow: var(--shadow); font-size: var(--fs-sm); }
```

- [ ] **Step 9: Wire everything in `src/main.js`**

```js
import '@fontsource/amiri/400.css';
import '@fontsource/amiri/700.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { createStore } from './state/store.js';
import { readState, readCache, writeState, writeCache } from './state/persist.js';
import { getReciters, getSuwar, getRiwayat, getRadios, buildPlaylist, surahUrl } from './api/quran.js';
import { createQueue } from './audio/queue.js';
import { createEngine } from './audio/engine.js';
import { createMediaSession } from './audio/mediaSession.js';
import { createShell } from './ui/shell.js';
import { createSearch } from './ui/search.js';
import { createRecitersView } from './ui/reciters.js';
import { createSurahsView } from './ui/surahs.js';
import { createFavoritesView } from './ui/favorites.js';
import { createRadioView } from './ui/radio.js';
import { createPlayer } from './ui/player.js';
import { toggleFavorite, isFavorite, sortForPlayback } from './utils/favorites.js';
import { qs } from './utils/dom.js';

const saved = readState();
const store = createStore({
  theme: saved.theme || 'auto',
  activeTab: saved.activeTab || 'reciters',
  query: '',
  offline: !navigator.onLine,
  reciters: [], suwarById: new Map(), riwayat: [], radios: [],
  selectedMoshafId: saved.selectedMoshafId ?? null,
  selectedMoshaf: null,
  playback: null,
  repeat: saved.repeat || 'off',
  favorites: saved.favorites || [],
});

const queue = createQueue();
const engine = createEngine();

const moshafIndex = new Map();
function indexMoshaf(reciters) {
  moshafIndex.clear();
  for (const r of reciters) {
    for (const m of r.moshaf) moshafIndex.set(m.id, { ...m, reciterName: r.name });
  }
}
const moshafOf = (id) => moshafIndex.get(id) || null;

function resolveMoshaf() {
  const s = store.getState();
  const moshaf = moshafOf(s.selectedMoshafId);
  store.setState({ selectedMoshaf: moshaf });
  if (moshaf) queue.setPlaylist(buildPlaylist(moshaf, s.suwarById));
}

function playSurah(surahId) {
  const s = store.getState();
  const moshaf = s.selectedMoshaf;
  if (!moshaf) return;

  // Only rebuild the queue from the moshaf when this surah is inside it.
  // A favorite may point at a moshaf the user has not selected.
  if (queue.setIndexBySurah(surahId) === -1) {
    queue.setPlaylist(buildPlaylist(moshaf, s.suwarById));
    if (queue.setIndexBySurah(surahId) === -1) {
      store.setState({
        playback: {
          kind: 'surah', surahId, moshafId: moshaf.id, url: '',
          title: s.suwarById.get(surahId)?.name || `سورة ${surahId}`,
          reciterName: moshaf.reciterName, riwayaName: moshaf.name,
          isPlaying: false, isFavorite: false, error: 'هذه السورة غير متوفرة لهذا القارئ',
        },
      });
      return;
    }
  }

  const cur = queue.current;
  const isFav = isFavorite(s.favorites, surahId, moshaf.id);
  store.setState({
    playback: {
      kind: 'surah', surahId, moshafId: moshaf.id, url: cur.url,
      title: cur.title, reciterName: moshaf.reciterName,
      riwayaName: moshaf.name, isPlaying: true, isFavorite: isFav,
    },
  });
  engine.play({
    url: cur.url, title: cur.title, artist: moshaf.reciterName,
    album: moshaf.name, kind: 'surah', seekable: true,
  });
}

/** Plays a saved favorite, switching to that reciter's own playlist. */
function playFavorite(fav) {
  const s = store.getState();
  const moshaf = moshafOf(fav.moshafId);
  if (!moshaf) {
    qs('#toast').textContent = 'القارئ لم يعد متوفراً';
    const t = qs('#toast'); t.hidden = false;
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.hidden = true; }, 2200);
    return;
  }
  store.setState({ selectedMoshafId: fav.moshafId });
  writeState({ selectedMoshafId: fav.moshafId });
  resolveMoshaf();
  playSurah(fav.surahId);
}

function playRadio(radio) {
  store.setState({
    playback: {
      kind: 'radio', url: radio.url, title: radio.name,
      reciterName: 'بث مباشر', isPlaying: true, isFavorite: false,
      seekable: false, error: null,
    },
  });
  engine.play({ url: radio.url, title: radio.name, artist: 'بث مباشر', kind: 'radio', seekable: false });
}

function advance() {
  const s = store.getState();
  if (s.repeat === 'one' && s.playback?.kind === 'surah') {
    engine.restart();
    return;
  }
  const nextItem = queue.next();
  if (!nextItem) {
    store.setState({ playback: { ...s.playback, isPlaying: false } });
    engine.pause();
    return;
  }
  playSurah(nextItem.surahId);
}

function toggleCurrentFavorite() {
  const p = store.getState().playback;
  if (!p || p.kind !== 'surah') return;
  toggleSurah(p.surahId, p.moshafId);
}

function toggleSurah(surahId, moshafId) {
  if (moshafId == null) return;
  const s = store.getState();
  const moshaf = moshafOf(moshafId);
  const meta = s.suwarById.get(surahId);
  const next = toggleFavorite(s.favorites, {
    surahId, moshafId,
    surahName: meta?.name || `سورة ${surahId}`,
    reciterName: moshaf?.reciterName || '',
    riwayaName: moshaf?.name || '',
    server: moshaf?.server || '',
  });
  writeState({ favorites: next });
  const stillFav = isFavorite(next, surahId, moshafId);
  store.setState({
    favorites: next,
    playback: s.playback?.surahId === surahId && s.playback?.moshafId === moshafId
      ? { ...s.playback, isFavorite: stillFav } : s.playback,
  });
  const t = qs('#toast');
  t.textContent = stillFav ? 'أُضيفت إلى المفضلة' : 'أُزيلت من المفضلة';
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 1800);
}

function playAllFavorites() {
  const s = store.getState();
  const ordered = sortForPlayback(s.favorites);
  if (ordered.length === 0) return;

  // Play-all crosses reciters, so build one queue from the saved URLs rather
  // than a single reciter's playlist.
  queue.setPlaylist(ordered.map((f) => ({
    surahId: f.surahId,
    title: f.surahName,
    url: surahUrl(f.server, f.surahId),
    fav: f,
  })));
  playFromQueue(0);
}

function playFromQueue(index) {
  const item = queue.items[index];
  if (!item) return;
  queue.setIndexBySurah(item.surahId);

  if (item.fav) {
    const fav = item.fav;
    store.setState({
      playback: {
        kind: 'surah', surahId: fav.surahId, moshafId: fav.moshafId, url: item.url,
        title: fav.surahName, reciterName: fav.reciterName, riwayaName: fav.riwayaName,
        isPlaying: true, isFavorite: true, seekable: true, error: null,
      },
    });
  } else {
    playSurah(item.surahId);
    return;
  }
  engine.play({
    url: item.url, title: item.title, artist: item.fav.reciterName,
    album: item.fav.riwayaName, kind: 'surah', seekable: true,
  });
}

const shell = createShell({ store });
createSearch({ store });

createRecitersView({
  root: qs('#view-reciters'),
  store,
  onSelect(reciter) {
    const first = reciter.moshaf[0];
    store.setState({ selectedMoshafId: first.id, activeTab: 'surahs' });
    writeState({ selectedMoshafId: first.id });
    resolveMoshaf();
  },
});

createSurahsView({
  root: qs('#view-surahs'), store,
  onPlay: (id) => playSurah(id),
  onToggleFavorite: (id) => toggleSurah(id, store.getState().selectedMoshafId),
});

createFavoritesView({
  root: qs('#view-favorites'), store,
  onPlay: playFavorite,
  onRemove: (f) => toggleSurah(f.surahId, f.moshafId),
  onPlayAll: playAllFavorites,
});

createRadioView({ root: qs('#view-radio'), store, onPlay: playRadio });

createPlayer({
  root: qs('#player'), store, engine,
  onNext: advance,
  onPrev: () => { const p = queue.prev(); if (p) playSurah(p.surahId); },
  onToggleFavorite: toggleCurrentFavorite,
});

const session = createMediaSession({
  onPlay: () => engine.play(engine.getCurrent()),
  onPause: () => engine.pause(),
  onStop: () => engine.pause(),
  onSeekBy: (d) => engine.seekBy(d),
  onNext: advance,
  onPrev: () => { const p = queue.prev(); if (p) playSurah(p.surahId); },
});
engine.on('play', () => {
  session.setState(true);
  store.setState({ playback: { ...store.getState().playback, isPlaying: true, error: null } });
});
engine.on('pause', () => {
  session.setState(false);
  store.setState({ playback: { ...store.getState().playback, isPlaying: false } });
});
engine.on('time', ({ currentTime, duration }) =>
  session.setPosition(currentTime, duration, engine.element.playbackRate || 1));
engine.on('ended', advance);
engine.on('error', () => {
  const p = store.getState().playback;
  store.setState({
    playback: { ...p, isPlaying: false, error: 'تعذّر تحميل السورة. تحقّق من الاتصال.' },
  });
  showErrorToast('تعذّر تحميل السورة', 'تخطّي', () => advance());
});
engine.on('blocked', () => {
  const p = store.getState().playback;
  store.setState({ playback: { ...p, isPlaying: false } });
  showErrorToast('اضغط تشغيل للسماح بالصوت', 'تشغيل', () => {
    const p2 = store.getState().playback;
    if (p2?.url) engine.play({ ...p2, seekable: p2.kind !== 'radio' });
  });
});

function showErrorToast(message, actionLabel, onAction) {
  const t = qs('#toast');
  t.replaceChildren(
    h('span', {}, message),
    h('button', {
      class: 'btn-primary', type: 'button',
      style: 'margin-inline-start:var(--sp-3)',
      onclick: onAction,
    }, actionLabel),
  );
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; t.replaceChildren(); }, 6000);
}

addEventListener('online', () => store.setState({ offline: false }));
addEventListener('offline', () => store.setState({ offline: true }));

// Data: cached copy first so repeat visits paint instantly with no network.
(async () => {
  const cachedReciters = readCache('reciters');
  const cachedSuwar = readCache('suwar');
  const cachedRadios = readCache('radios');
  const cachedRiwayat = readCache('riwayat');

  if (cachedSuwar) store.setState({ suwarById: new Map(cachedSuwar.map((s) => [s.id, s])) });
  if (cachedReciters) store.setState({ reciters: cachedReciters });
  if (cachedRadios) store.setState({ radios: cachedRadios });
  if (cachedRiwayat) store.setState({ riwayat: cachedRiwayat });
  indexMoshaf(cachedReciters || []);
  resolveMoshaf();

  try {
    const [reciters, suwar, radios, riwayat] = await Promise.all([
      getReciters(), getSuwar(), getRadios(), getRiwayat(),
    ]);
    writeCache('reciters', reciters);
    writeCache('suwar', suwar);
    writeCache('radios', radios);
    writeCache('riwayat', riwayat);
    store.setState({
      reciters, radios, riwayat,
      suwarById: new Map(suwar.map((s) => [s.id, s])),
    });
    indexMoshaf(reciters);
    resolveMoshaf();
  } catch (err) {
    const hasCache = store.getState().reciters.length > 0;
    shell.banner(hasCache
      ? 'تعذّر التحديث — تتصفّح البيانات المحفوظة'
      : err.message);
  }
})();
```

- [ ] **Step 10: Verify by hand and commit**

Run: `npm run dev`. Check: 241 reciters render; selecting one switches to its surah grid; Arabic search for `احمد` finds `أحمد`; the heart toggles and survives reload; play-all works; switching tabs does not interrupt audio; radio plays and hides the seek row.

```bash
git add src index.html
git commit -m "feat: add tabbed navigation, unified search, and favorites

Search normalizes both the index and the query with identical settings,
so 'احمد' matches 'أحمد'. Favorites persist per surah+moshaf pair and
render the reciter name because one surah can appear with several voices."
```

---

## Task 7: PWA and Offline

**Files:**
- Create: `src/pwa.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `createShell` from Task 6
- Produces: install button wiring, update toast, offline fallback page

- [ ] **Step 1: Create `src/pwa.js`**

```js
import { registerSW } from 'virtual:pwa-register';
import { h, qs } from './utils/dom.js';

export function initPWA({ onUpdateReady } = {}) {
  let deferredPrompt = null;
  const installBtn = qs('#install');

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      const toast = qs('#toast');
      toast.replaceChildren(
        h('span', {}, 'يتوفر تحديث للتطبيق'),
        h('button', {
          class: 'btn-primary', type: 'button',
          style: 'margin-inline-start:var(--sp-3)',
          onclick: () => { onUpdateReady?.(); updateSW(true); },
        }, 'تحديث'),
      );
      toast.hidden = false;
    },
  });

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });

  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  addEventListener('appinstalled', () => { if (installBtn) installBtn.hidden = true; });

  return { updateSW };
}
```

- [ ] **Step 2: Register it in `src/main.js`**

```js
import { initPWA } from './pwa.js';
initPWA({ onUpdateReady: () => { /* assets are already precached by Workbox */ } });
```

- [ ] **Step 3: Verify installability and offline**

Run: `npm run build && npm run preview -- --port 4173`.

1. Open `http://localhost:4173/quran_api/`. DevTools → Application → Manifest: name, icons 192 and 512, and maskable all resolve with HTTP 200.
2. DevTools → Application → Service Workers: `sw.js` under scope `https://host/quran_api/` is activated.
3. DevTools → Network → throttling `Slow 3G` → reload. Note LCP; it must be under ~1.2s once cached.
4. DevTools → Application → Offline, then reload. Reciters, surahs, and favorites must still render from cache with the offline banner visible.
5. Confirm `dist/sw.js` contains no route matching `.mp3`, and that `runtimeCaching` audio URLs are never intercepted.

- [ ] **Step 4: Commit**

```bash
git add src/pwa.js src/main.js
git commit -m "feat: register service worker with install prompt and update toast

registerType 'prompt' with no unconditional skipWaiting: swapping the
worker under a live session would let old code request assets the new
shell no longer references. Audio stays NetworkOnly because caching
multi-megabyte streams would break range-based seeking."
```

---

## Task 8: Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the whole suite and build**

Run: `npm test && npm run build`
Expected: all Vitest files pass; build completes with no warnings about missing assets.

- [ ] **Step 2: Automated responsive check**

Run `npm run preview -- --port 4173`, then drive it with Playwright at 360×640, 390×844, 768×1024, 1280×800, and 1920×1080. Assert at each width: no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth + 1`), every interactive element at least 44×44 px, the player fixed to the viewport bottom and never overlapping the last card, and both themes applied.

- [ ] **Step 3: Automated functional check**

In the same Playwright session: select a reciter, play surah 1, assert `document.querySelectorAll('audio').length === 1` before and after, switch all four tabs and assert `audio.paused === false`, assert the current time advances, toggle a heart and assert it persists across reload, and trigger play-all.

- [ ] **Step 4: Lighthouse pass**

Run Lighthouse against the preview URL. Targets: Performance ≥ 90, Accessibility ≥ 90, Best Practices ≥ 90, PWA installability satisfied.

- [ ] **Step 5: Rewrite `README.md`**

Document: what the app is, `npm install` / `npm run dev` / `npm run build` / `npm test`, the `/quran_api/` base-path requirement and why it exists, the single-`<audio>`-element rule and why `new Audio()` and `AudioContext` are banned, the `moshaf_type` opaque-code trap, and the known iOS 26 and WebKit 261858 limitations.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "docs: document build, base path, and audio engine constraints"
```

---

## Self-Review Notes

**Spec coverage:** §3 API facts → Task 3 (`deriveStyle`, `buildPlaylist`, `surahUrl`). §5 engine → Task 4. §6 state → Task 3 + Task 6 Step 9. §7 Arabic normalization → Task 2. §8 UI → Tasks 5 and 6. §9 performance → Tasks 1 (images deleted, fonts local, hls.js never added) and 8. §10 PWA → Task 7. §11 errors → Task 3 Step 1 (`ApiError` with Arabic copy) and Task 6 Step 9 (banner, toast). §12 testing → Tasks 2, 4, and 8. §14 risks → Task 4 Step 6 gate.

**Deferred by spec §1.3:** mushaf reading view, ayah repeat, cloud sync, manual queue reordering, push notifications — intentionally absent.