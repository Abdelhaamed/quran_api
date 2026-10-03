import { h, frag } from '../utils/dom.js';
import { matchesAll } from '../utils/arabic.js';
import {
  listDownloads, deleteDownload, downloadedBytes, formatBytes,
} from '../audio/downloads.js';
import { icon } from './icons.js';

const EMPTY_COPY = 'لا توجد سور محمّلة. شغّل سورة واضغط زر التحميل ⬇ في المشغّل لحفظها هنا والاستماع بلا إنترنت.';

/**
 * The downloads manager: every surah saved for offline listening, with play,
 * per-surah delete, and the storage meter. The registry is the source of
 * truth for what is shown; Cache Storage holds the bytes. A reconcile on boot
 * (main.js) drops registry entries whose bytes are gone, so this list never
 * shows a file that is not actually on the device.
 */
export function createDownloadsView({ root, store, onPlay, onPlayAll, onBrowse }) {
  const head = h('div', { class: 'fav-head' });
  const list = h('div', { class: 'grid grid-fav' });
  root.append(head, list);

  async function onDelete(d) {
    await deleteDownload(d.surahId, d.moshafId, d.url);
    store.setState({ downloadsRev: (store.getState().downloadsRev || 0) + 1 });
  }

  function render() {
    const s = store.getState();
    const all = listDownloads();
    const shown = s.query
      ? all.filter((d) =>
        matchesAll(d.surahName || '', s.query) ||
        matchesAll(d.reciterName || '', s.query))
      : all;

    if (all.length === 0) {
      head.replaceChildren();
      list.replaceChildren(h('div', { class: 'empty' },
        h('p', {}, EMPTY_COPY),
        h('button', { class: 'btn-primary', type: 'button', onclick: () => onBrowse() },
          'تصفّح السور')));
      return;
    }

    const bytes = downloadedBytes();
    head.replaceChildren(
      h('h2', { class: 'fav-count' }, `${all.length} محمّلة · ${formatBytes(bytes)}`),
      h('button', { class: 'btn-primary', type: 'button', onclick: () => onPlayAll(shown) },
        'تشغيل الكل'),
    );

    if (shown.length === 0) {
      head.replaceChildren();
      list.replaceChildren(h('p', { class: 'empty' }, 'لا نتائج مطابقة'));
      return;
    }

    const nodes = shown.map((d) => {
      const on = s.playback?.kind === 'surah' &&
        s.playback.surahId === d.surahId && s.playback.moshafId === d.moshafId;
      const open = h('button', { class: 'fav-open', type: 'button', onclick: () => onPlay(d) },
        h('span', { class: 'surah-place' }, String(d.surahId)),
        h('span', { class: 'surah-name' }, d.surahName),
        h('span', { class: 'reciter-meta' }, d.reciterName));
      const del = h('button', {
        class: 'heart is-on',
        type: 'button',
        'aria-label': `حذف ${d.surahName} المحمّلة`,
        onclick: (e) => { e.stopPropagation(); onDelete(d); },
      }, icon('delete'));
      return h('div', { class: `card fav${on ? ' is-playing' : ''}` }, open, del);
    });

    list.replaceChildren(frag(nodes));
  }

  const unsubscribe = store.subscribe((_s, keys) => {
    if (keys.has('downloadsRev') || keys.has('playback') || keys.has('query')) render();
  }, { immediate: true });

  return { render, destroy: unsubscribe };
}
