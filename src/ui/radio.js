import { h, frag } from '../utils/dom.js';
import { matchesAll } from '../utils/arabic.js';

export function createRadioView({ root, store, onPlay }) {
  const list = h('div', { class: 'list' });
  root.append(list);

  function render() {
    const s = store.getState();
    const items = s.query
      ? s.radios.filter((r) => matchesAll(r.name, s.query))
      : s.radios;

    if (items.length === 0) {
      list.replaceChildren(h('p', { class: 'empty' },
        s.radios.length ? 'لا نتائج مطابقة' : 'جارٍ تحميل القنوات…'));
      return;
    }

    const nodes = items.map((r) => {
      // Matched on the URL, not the name: two stations can share a name, and
      // the URL is what the engine is actually holding.
      const on = s.playback?.kind === 'radio' && s.playback.url === r.url;
      return h('button', {
        class: `row${on ? ' is-playing' : ''}`,
        type: 'button',
        // seekable: false is set by playRadio, not here: the flag describes what
        // the stream answers with (Accept-Ranges: none), and the engine is the
        // only layer that can refuse to seek on it.
        onclick: () => onPlay(r),
      },
        h('span', { class: 'row-dot' }),
        h('span', { class: 'row-name' }, r.name));
    });

    list.replaceChildren(frag(nodes));
  }

  const unsubscribe = store.subscribe((_s, keys) => {
    if (keys.has('radios') || keys.has('query') || keys.has('playback')) render();
  }, { immediate: true });

  return { render, destroy: unsubscribe };
}
