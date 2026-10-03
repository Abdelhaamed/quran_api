// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { h } from '../src/utils/dom.js';
import { createStore } from '../src/state/store.js';
import { createDownloadsView } from '../src/ui/downloads.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

const dl = (over = {}) => ({
  surahId: 1, moshafId: 11, surahName: 'الفاتحة', reciterName: 'أحمد',
  url: 'https://x/001.mp3', size: 375643, at: 1, ...over,
});

const build = (over = {}) => {
  const root = document.createElement('section');
  document.body.replaceChildren(root);
  const store = createStore({
    query: '', playback: null, downloadsRev: 0,
    favorites: [], ...over,
  });
  // Seed the registry the view reads.
  const reg = {};
  for (const d of over.downloads || []) reg[`${d.surahId}:${d.moshafId}`] = d;
  localStorage.setItem('quran.state.v2', JSON.stringify({ downloads: reg }));
  const onPlay = vi.fn();
  const onPlayAll = vi.fn();
  const onBrowse = vi.fn();
  const view = createDownloadsView({ root, store, onPlay, onPlayAll, onBrowse });
  return { root, store, onPlay, onPlayAll, onBrowse, view };
};

beforeEach(() => {
  localStorage.clear();
  // deleteDownload touches Cache Storage, which happy-dom lacks.
  const items = new Map();
  Object.defineProperty(globalThis, 'caches', {
    value: {
      open: async () => ({
        match: async (url) => null,
        put: async () => {},
        delete: async (url) => items.delete(String(url)),
        keys: async () => [...items.keys()].map((url) => ({ url })),
      }),
    },
    configurable: true, writable: true,
  });
});

describe('createDownloadsView', () => {
  it('shows the empty state with a way out when nothing is downloaded', () => {
    const { root, onBrowse } = build();
    expect(qs('.empty', root).textContent).toContain('لا توجد سور محمّلة');
    qs('.btn-primary', root).click();
    expect(onBrowse).toHaveBeenCalledOnce();
  });

  it('lists downloads with the meter in the head', () => {
    const { root } = build({ downloads: [dl(), dl({ surahId: 2, surahName: 'البقرة', size: 100 })] });
    expect(qsa('.fav', root)).toHaveLength(2);
    expect(qs('.fav-count', root).textContent).toContain('2 محمّلة');
  });

  it('plays one and plays all of the shown list', async () => {
    const { root, store, onPlay, onPlayAll } = build({ downloads: [dl()] });
    qs('.fav-open', root).click();
    expect(onPlay).toHaveBeenCalledOnce();
    qs('.fav-head .btn-primary', root).click();
    expect(onPlayAll).toHaveBeenCalledOnce();
    // Query narrows what play-all receives, but the head still counts all.
    store.setState({ query: 'زززز' });
    await flush();
    expect(qsa('.fav', root)).toHaveLength(0);
  });

  it('deletes through the trash control, never the open button', async () => {
    const { root, store } = build({ downloads: [dl()] });
    qs('.fav .heart', root).click();
    await flush();
    expect(qsa('.fav', root)).toHaveLength(0);
  });

  it('marks the entry that is sounding', () => {
    const { root, store } = build({ downloads: [dl()] });
    store.setState({ playback: { kind: 'surah', surahId: 1, moshafId: 11, isPlaying: true } });
    return flush().then(() => {
      expect(qsa('.fav.is-playing', root)).toHaveLength(1);
    });
  });

  it('filters by surah and reciter names', async () => {
    const { root, store } = build({ downloads: [dl(), dl({ surahId: 2, surahName: 'البقرة' })] });
    store.setState({ query: 'البقرة' });
    await flush();
    expect(qsa('.fav', root)).toHaveLength(1);
    expect(qs('.surah-name', root).textContent).toBe('البقرة');
  });
});
