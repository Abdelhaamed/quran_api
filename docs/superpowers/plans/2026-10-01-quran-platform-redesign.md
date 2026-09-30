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
- Create: `public/icons/icon.svg`, `scripts/generate-icons.mjs`, `public/.nojekyll`
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
  --border: #4a4444;
  --text: #f5f0e9;
  --text-muted: #b5aca3;
  --text-faint: #857c74;
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
  --fs-xs: 12px; --fs-sm: 14px; --fs-base: 16px;
  --fs-lg: 20px; --fs-xl: 26px; --fs-2xl: 34px;

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
  --border: #e2dbd0;
  --text: #1f1a18;
  --text-muted: #5c534c;
  --text-faint: #8a8078;
  --accent: #0092a3;
  --accent-strong: #00707e;
  --accent-contrast: #ffffff;
  --gold: #a97f2f;
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
button, input, select { font: inherit; color: inherit; }
button { background: none; border: 0; cursor: pointer; }
button:focus-visible, input:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
img, svg { display: block; max-width: 100%; }
ul, ol { list-style: none; padding: 0; }
[hidden] { display: none !important; }

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: var(--r-full); }

@media (min-width: 768px) {
  body { font-size: var(--fs-lg); }
}
```

- [ ] **Step 5: Create the app icon and generate PNGs**

`public/icons/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#241f1f"/>
  <g fill="none" stroke="#00d4e6" stroke-width="6" opacity=".55">
    <path d="M256 40 424 148 424 364 256 472 88 364 88 148Z"/>
    <path d="M256 96 376 168 376 344 256 416 136 344 136 168Z"/>
    <path d="M256 96 256 416M136 168 376 344M376 168 136 344"/>
  </g>
  <text x="256" y="300" font-family="Amiri, serif" font-size="180"
        fill="#f5f0e9" text-anchor="middle">ق</text>
</svg>
```

`scripts/generate-icons.mjs`:

```js
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
await mkdir(outDir, { recursive: true });

const svg = await import('node:fs/promises').then((fs) =>
  fs.readFile(join(outDir, 'icon.svg'))
);

// Maskable icons need 10% safe padding, so the glyph is scaled down.
const plain = await sharp(svg).resize(512, 512).png().toBuffer();
const maskable = await sharp(svg)
  .resize(360, 360)
  .extend({
    top: 76, bottom: 76, left: 76, right: 76,
    background: { r: 36, g: 31, b: 31, alpha: 1 },
  })
  .png()
  .toBuffer();

await Promise.all([
  writeFile(join(outDir, 'icon-192.png'), await sharp(plain).resize(192, 192).toBuffer()),
  writeFile(join(outDir, 'icon-512.png'), plain),
  writeFile(join(outDir, 'maskable-512.png'), maskable),
  writeFile(join(outDir, 'apple-touch-icon.png'), await sharp(plain).resize(180, 180).toBuffer()),
]);
console.log('icons written to public/icons');
```

Run: `npm run icons`
Expected: prints `icons written to public/icons`; four PNGs exist. Commit them so the build never needs sharp.

- [ ] **Step 6: Create `vite.config.js`**

```js
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
        navigateFallback: null,
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
        // Audio must never be cached: streams are large and would break seeking.
        navigateFallbackDenylist: [/^\/quran_api\/.*\.(mp3|m3u8)$/],
      },
    }),
  ],
});
```

Audio URLs live on `server*.mp3quran.net` and `backup.qurango.net`, which match no route predicate above, so Workbox never intercepts them. Do not add a route that matches `*.mp3`.

- [ ] **Step 7: Create `.gitignore`**

```
node_modules/
dist/
dev-dist/
.superpowers/
*.local
.DS_Store
```

- [ ] **Step 8: Create `.github/workflows/deploy.yml`**

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

- [ ] **Step 9: Remove legacy files**

```bash
git rm -q normalize.css main.css main.js
git rm -rq image
```

- [ ] **Step 10: Verify the empty shell builds and serves**

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

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite project with PWA config and design tokens

Sets base to /quran_api/ so GitHub Pages serves assets from the
subpath. Workbox applies NetworkFirst to navigations, StaleWhileRevalidate
to mp3quran JSON, and CacheFirst to hashed assets; no route matches
audio URLs so media stays NetworkOnly. Removes the 15.5MB image
directory and the normalize.css/main.css/main.js trio."
```

---

## Task 2: Pure Logic (TDD)

**Files:**
- Create: `src/utils/arabic.js`, `src/audio/queue.js`, `src/utils/favorites.js`
- Create: `test/arabic.test.js`, `test/queue.test.js`, `test/favorites.test.js`

**Interfaces:**
- Produces: `normalize(text: string): string`
- Produces: `createQueue()` → `{ setPlaylist, setIndexBySurah, current, next, prev, size, index }`
- Produces: `favoriteKey(surahId, moshafId): string`, `isFavorite(list, surahId, moshafId): boolean`, `toggleFavorite(list, entry): array`, `sortForPlayback(list): array`

All three modules are DOM-free and import nothing.

- [ ] **Step 1: Write `test/arabic.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { normalize } from '../src/utils/arabic.js';

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
  if (!text) return '';
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
  const tokens = normalize(query).split(' ').filter(Boolean);
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
    expect(q.current()).toBeNull();
  });

  it('navigates forward and backward', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(2), item(3)]);
    expect(q.current().surahId).toBe(1);
    expect(q.next().surahId).toBe(2);
    expect(q.next().surahId).toBe(3);
    expect(q.next()).toBeNull();
    expect(q.prev().surahId).toBe(2);
  });

  it('does not wrap at either end', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(2)]);
    expect(q.prev()).toBeNull();
    expect(q.index()).toBe(0);
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
    expect(q.index()).toBe(0);
    expect(q.current().surahId).toBe(9);
  });

  it('locates an index by surah id', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(18), item(36)]);
    expect(q.setIndexBySurah(18)).toBe(1);
    expect(q.current().surahId).toBe(18);
  });

  it('returns -1 for a surah outside the playlist', () => {
    const q = createQueue();
    q.setPlaylist([item(1)]);
    expect(q.setIndexBySurah(99)).toBe(-1);
    expect(q.index()).toBe(0);
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

  const clamp = () => {
    if (items.length === 0) { at = 0; return; }
    if (at < 0) at = 0;
    if (at >= items.length) at = items.length - 1;
  };

  return {
    setPlaylist(list) {
      items = Array.isArray(list) ? list.slice() : [];
      at = 0;
      clamp();
    },
    setIndexBySurah(surahId) {
      const found = items.findIndex((i) => Number(i.surahId) === Number(surahId));
      if (found === -1) return -1;
      at = found;
      return at;
    },
    current() { return items.length ? items[at] : null; },
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
    index() { return at; },
    size() { return items.length; },
    items() { return items.slice(); },
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
  return `${surahId}:${moshafId}`;
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

export function sortForPlayback(list) {
  return [...list].sort((a, b) => Number(a.surahId) - Number(b.surahId));
}

export function removeFavorite(list, surahId, moshafId) {
  const key = favoriteKey(surahId, moshafId);
  return list.filter((f) => favoriteKey(f.surahId, f.moshafId) !== key);
}
```

- [ ] **Step 10: Run all tests**

Run: `npm test`
Expected: 3 files, 22 tests, all passing.

- [ ] **Step 11: Commit**

```bash
git add src/utils/arabic.js src/audio/queue.js src/utils/favorites.js test/
git commit -m "feat: add pure Arabic normalization, queue, and favorites logic

Arabic folding matters for search: without it the query 'احمد' never
matches 'أحمد' and 'فاطمه' never matches 'فاطمة'. Favorites key on
surahId:moshafId because moshaf.id is globally unique across all 287
entries, so the same surah by two reciters stays two records."
```

---

## Task 3: Data Layer

**Files:**
- Create: `src/api/client.js`, `src/api/quran.js`, `src/state/store.js`, `src/state/persist.js`

**Interfaces:**
- Produces: `getJSON(path, { signal, timeoutMs }): Promise<any>`
- Produces: `getReciters()`, `getSuwar()`, `getRiwayat()`, `getRadios()`, `deriveStyle(moshafName)`, `surahUrl(server, surahId)`, `buildPlaylist(moshaf, suwarById)`
- Produces: `createStore(initial)` → `{ getState, setState, subscribe }`
- Produces: `readState()`, `writeState(patch)`, `CACHE_TTL_MS`

- [ ] **Step 1: Create `src/api/client.js`**

```js
const BASE = 'https://mp3quran.net/api/v3';
const DEFAULT_TIMEOUT = 3000;

export class ApiError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ApiError';
    this.cause = cause;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      if (!res.ok) throw new ApiError(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      lastError = err;
      if (attempt < retries) await sleep(400);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  if (lastError instanceof ApiError) throw lastError;
  if (!navigator.onLine) {
    throw new ApiError('لا يوجد اتصال بالإنترنت. البيانات المحفوظة متاحة.', lastError);
  }
  throw new ApiError('تعذّر جلب البيانات. تحقق من الاتصال وحاول مجدداً.', lastError);
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
  if (n.includes('المجود')) return 'مجوّد';
  if (n.includes('المعلم')) return 'مُعلِّم';
  if (n.includes('مرتل')) return 'مرتّل';
  if (n.includes('مجود')) return 'مجوّد';
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
  return (data.suwar || []).map((s) => ({
    id: Number(s.id),
    name: s.name,
    makyi: s.makyi,
    pageStart: s.page_start,
    pageEnd: s.page_end,
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
import { getReciters, getSuwar, getRiwayat, getRadios, buildPlaylist } from '../src/api/quran.js';

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
console.log('radios          :', radios.length);
console.log('styles seen     :', [...new Set(reciters.flatMap((r) => r.moshaf.map((m) => m.style)))].join(' | '));

const byId = new Map(surah.map((s) => [s.id, s]));
const maaher = reciters.find((r) => r.moshaf.some((m) => m.surahTotal === 38));
const partial = maaher.moshaf.find((m) => m.surahTotal === 38);
console.log('partial playlist:', maaher.name, '->', buildPlaylist(partial, byId).length, 'surahs');
```

Run: `node scripts/verify-api.mjs`
Expected: reciters 241 OK, moshaf 287 OK, unique moshaf id OK, suwar 114 OK, riwayat 20 OK, and a non-zero styles list including مرتّل and مجوّد.

- [ ] **Step 6: Commit**

```bash
git add src/api src/state scripts/verify-api.mjs
git commit -m "feat: add API client, quran data layer, store, and persistence

getJSON enforces a 3s timeout (6s for the 191KB reciter payload) and one
retry, so a slow connection degrades instead of hanging. The store
batches updates through queueMicrotask so a multi-key patch renders once."
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

    const frag = document.createDocumentFragment();
    for (const r of list) {
      const selected = r.moshaf.some((m) => m.id === s.selectedMoshafId);
      const chips = r.moshaf.length
        ? frag2(r.moshaf.map((m) => h('span', { class: 'chip' }, m.style || m.name)))
        : h('span', { class: 'chip muted' }, 'لا روايات');

      const card = h('button', {
        class: `card reciter${selected ? ' is-selected' : ''}`,
        type: 'button',
        onclick: () => onSelect(r),
      },
        h('span', { class: 'reciter-name' }, r.name),
        h('span', { class: 'reciter-meta' }, `${r.moshaf.length} رواية · ${r.moshaf[0]?.surahTotal || 0} سورة`),
        chips);
      frag.append(card);
    }
    grid.append(frag);
  }

  const frag2 = (nodes) => {
    const f = document.createDocumentFragment();
    for (const n of nodes) f.append(n);
    return f;
  };

  store.subscribe((s, keys) => {
    if (keys.has('reciters') || keys.has('query') || keys.has('selectedMoshafId')) render();
  }, { immediate: true });

  return { render };
}
```

- [ ] **Step 4: Create `src/ui/surahs.js`**

```js
import { h } from '../utils/dom.js';
import { matchesAll } from '../utils/arabic.js';
import { isFavorite } from '../utils/favorites.js';

export function createSurahsView({ root, store, onPlay, onToggleFavorite }) {
  const grid = h('div', { class: 'grid grid-surahs' });
  root.append(grid);

  function render() {
    const s = store.getState();
    const moshaf = s.selectedMoshaf;
    grid.replaceChildren();

    if (!moshaf) {
      grid.append(h('p', { class: 'empty' }, 'اختر قارئاً من تبويب «القرّاء» أولاً لعرض سوره'));
      return;
    }

    const ids = s.query
      ? moshaf.surahList.filter((id) => matchesAll(s.suwarById.get(id)?.name || '', s.query))
      : moshaf.surahList;

    if (ids.length === 0) {
      grid.append(h('p', { class: 'empty' }, s.reciters.length ? 'لا نتائج مطابقة' : 'جارٍ التحميل…'));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const id of ids) {
      const meta = s.suwarById.get(id);
      const fav = isFavorite(s.favorites, id, moshaf.id);
      const card = h('div', {
        class: `card surah${s.playback?.surahId === id && s.playback?.moshafId === moshaf.id ? ' is-playing' : ''}`,
        role: 'button',
        tabindex: '0',
        onclick: () => onPlay(id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(id); } },
      },
        h('span', { class: 'surah-num' }, meta?.makyi === 'مكية' ? '' : 'مدنية'),
        h('span', { class: 'surah-name' }, meta?.name || `سورة ${id}`),
        h('span', { class: 'surah-count' }, meta?.makyi === 'مكية' ? '' : ''),
        h('span', { class: 'ayah-badge' }, String(id)),
        h('button', {
          class: `heart${fav ? ' is-on' : ''}`,
          type: 'button',
          'aria-pressed': String(fav),
          'aria-label': fav ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة',
          onclick: (e) => { e.stopPropagation(); onToggleFavorite(id); },
          html: fav ? '&#9829;' : '&#9825;',
        }));
      frag.append(card);
    }
    grid.append(frag);
  }

  store.subscribe((s, keys) => {
    if (keys.has('selectedMoshaf') || keys.has('query') || keys.has('favorites') ||
        keys.has('playback') || keys.has('suwarById')) render();
  }, { immediate: true });

  return { render };
}
```

Replace the placeholder `surah-num`, `surah-count`, and `ayah-badge` content: `ayah-badge` shows the surah's ordinal inside the decorative circle, and `surah-count` shows the ayah count once `getSuwar()` is confirmed to include it. If the API does not return ayah counts, render the makyi/madani label only and drop `surah-count`.

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

.surah { place-items: center; text-align: center; padding: var(--sp-3); }
.surah-name { font-family: var(--font-quran); font-size: var(--fs-lg); font-weight: 700; }
.ayah-badge { inline-size: 34px; block-size: 34px; display: grid; place-items: center;
  border: 1px solid var(--gold); border-radius: var(--r-full); color: var(--gold);
  font-size: var(--fs-xs); }
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

const moshafOf = (id) => store.getState().reciters
  .flatMap((r) => r.moshaf.map((m) => ({ ...m, reciterName: r.name })))
  .find((m) => m.id === id) || null;

function resolveMoshaf() {
  const s = store.getState();
  const moshaf = moshafOf(s.selectedMoshafId);
  store.setState({ selectedMoshaf: moshaf });
  if (moshaf) queue.setPlaylist(buildPlaylist(moshaf, s.suwarById));
}

function playSurah(surahId, { fromFavorite } = {}) {
  const s = store.getState();
  const moshaf = fromFavorite
    ? { ...fromFavorite, reciterName: fromFavorite.reciterName }
    : s.selectedMoshaf;
  if (!moshaf) return;

  queue.setPlaylist(fromFavorite
    ? buildPlaylist(moshaf, s.suwarById)
    : queue.items());
  queue.setIndexBySurah(surahId);

  const cur = queue.current();
  if (!cur) return;

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

function playRadio(radio) {
  store.setState({
    playback: {
      kind: 'radio', url: radio.url, title: radio.name,
      reciterName: 'بث مباشر', isPlaying: true, isFavorite: false, seekable: false,
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
  qs('#toast').textContent = stillFav ? 'أُضيفت إلى المفضلة' : 'أُزيلت من المفضلة';
  const t = qs('#toast');
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 1800);
}

function playAllFavorites() {
  const s = store.getState();
  const ordered = sortForPlayback(s.favorites);
  if (ordered.length === 0) return;
  const moshafById = new Map(
    s.reciters.flatMap((r) => r.moshaf.map((m) => [m.id, { ...m, reciterName: r.name }])));
  queue.setPlaylist(ordered.map((f) => {
    const m = moshafById.get(f.moshafId);
    return { surahId: f.surahId, title: f.surahName, url: surahUrl(f.server || m?.server, f.surahId) };
  }));
  playSurah(ordered[0].surahId);
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
  onPlay: (f) => playSurah(f.surahId, { fromFavorite: f }),
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
engine.on('play', () => session.setState(true));
engine.on('pause', () => session.setState(false));
engine.on('time', ({ currentTime, duration }) =>
  session.setPosition(currentTime, duration, engine.element.playbackRate || 1));
engine.on('ended', advance);

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