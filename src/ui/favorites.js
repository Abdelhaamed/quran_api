import { h, frag } from '../utils/dom.js';
import { sortForPlayback } from '../utils/favorites.js';

const HEART_ON = '\u2665';

const EMPTY_COPY = 'لا توجد سور في المفضلة. اضغط القلب في تبويب «السور» لحفظ سورة بصوت قارئها.';

export function createFavoritesView({ root, store, onPlay, onRemove, onPlayAll, onBrowse }) {
  const head = h('div', { class: 'fav-head' });
  const list = h('div', { class: 'grid grid-fav' });
  root.append(head, list);

  function render() {
    const s = store.getState();
    const favs = s.favorites;

    if (favs.length === 0) {
      head.replaceChildren();
      // The empty state carries the way out as well as the explanation: a
      // first-time visitor is told what favorites are and then given the tab
      // that fills them.
      list.replaceChildren(h('div', { class: 'empty' },
        h('p', {}, EMPTY_COPY),
        h('button', { class: 'btn-primary', type: 'button', onclick: () => onBrowse() },
          'تصفّح السور')));
      return;
    }

    head.replaceChildren(
      h('h2', { class: 'fav-count' }, `${favs.length} سورة`),
      h('button', { class: 'btn-primary', type: 'button', onclick: () => onPlayAll() },
        'تشغيل الكل'),
    );

    // sortForPlayback orders by surah then reciter, and total by the pair, so
    // play-all walks the queue in the order it is shown here.
    const nodes = sortForPlayback(favs).map((f) => {
      const on = s.playback?.kind === 'surah' &&
        s.playback.surahId === f.surahId && s.playback.moshafId === f.moshafId;

      // Div plus a real button rather than a role="button" div: the remove
      // control is interactive too, and nesting one inside the other is
      // invalid and unreachable by keyboard.
      const open = h('button', { class: 'fav-open', type: 'button', onclick: () => onPlay(f) },
        h('span', { class: 'surah-place' }, String(f.surahId)),
        h('span', { class: 'surah-name' }, f.surahName),
        h('span', { class: 'reciter-meta' }, `${f.reciterName} · ${f.riwayaName}`));

      const heart = h('button', {
        class: 'heart is-on',
        type: 'button',
        'aria-label': 'إزالة من المفضلة',
        onclick: (e) => { e.stopPropagation(); onRemove(f); },
      }, HEART_ON);

      return h('div', { class: `card fav${on ? ' is-playing' : ''}` }, open, heart);
    });

    list.replaceChildren(frag(nodes));
  }

  const unsubscribe = store.subscribe((_s, keys) => {
    if (keys.has('favorites') || keys.has('playback')) render();
  }, { immediate: true });

  return { render, destroy: unsubscribe };
}
