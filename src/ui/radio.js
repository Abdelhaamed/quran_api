import { h, frag } from '../utils/dom.js';
import { matchesAll, normalize } from '../utils/arabic.js';

/**
 * The /radios endpoint returns no category field — only id, name, url. But
 * the names themselves carry the split: ~160 of 177 are reciter streams, and
 * the rest name their topic outright (تفسير, أذكار, سيرة, فتاوى...). So the
 * categories below match explicit words in the names, first match wins, with
 * specific groups ordered before general ones. Anything unmatched is a reciter
 * stream by elimination, which is the honest default rather than a guess.
 *
 * Normalized before matching, so a keyword with or without hamza hits the same
 * way the search box does.
 */
const CATEGORIES = [
  { id: 'all', label: 'الكل', keys: null },
  { id: 'tilawa', label: 'تلاوات', keys: [] },
  { id: 'tafsir', label: 'تفسير', keys: ['تفسير'] },
  { id: 'adhkar', label: 'أذكار وأدعية', keys: ['اذكار', 'دعا', 'رقيه'] },
  // Keywords are stored NORMALIZED (hamza already folded), because categorize()
  // normalizes the channel name first: 'الشمائل' becomes 'الشمايل', so a
  // keyword written with ئ would never match.
  { id: 'sira', label: 'سيرة وقصص', keys: ['سيره', 'قصص', 'صحابه', 'شمايل'] },
  { id: 'fatawa', label: 'فتاوى ودروس', keys: ['فتاو', 'دروس', 'خطب'] },
  { id: 'stations', label: 'إذاعات', keys: ['اذاعه', 'عامه', 'متنوعه'] },
  { id: 'tarjama', label: 'ترجمات', keys: ['ترجمه'] },
];

export function categorize(name) {
  const text = normalize(name || '');
  for (const c of CATEGORIES) {
    if (!c.keys || c.keys.length === 0) continue;
    if (c.keys.some((k) => text.includes(k))) return c.id;
  }
  return 'tilawa';
}

export function categoryLabel(id) {
  return (CATEGORIES.find((c) => c.id === id) || CATEGORIES[0]).label;
}

export function createRadioView({ root, store, onPlay }) {
  const chips = h('div', { class: 'riwaya-filter', role: 'group', 'aria-label': 'تصنيف القنوات' });
  const list = h('div', { class: 'list' });
  root.append(chips, list);

  function render() {
    const s = store.getState();
    renderChips(s);

    let items = s.radios;
    if (s.radioCategory && s.radioCategory !== 'all') {
      items = items.filter((r) => categorize(r.name) === s.radioCategory);
    }
    if (s.query) {
      items = items.filter((r) => matchesAll(r.name, s.query));
    }

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

  function renderChips(s) {
    const counts = new Map();
    for (const r of s.radios) {
      const c = categorize(r.name);
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const nodes = CATEGORIES
      .filter((c) => c.id === 'all' || (counts.get(c.id) || 0) > 0)
      .map((c) => {
        const n = c.id === 'all' ? s.radios.length : counts.get(c.id);
        const isOn = (s.radioCategory || 'all') === c.id;
        return h('button', {
          class: `chip-lg${isOn ? ' is-on' : ''}`,
          type: 'button',
          'aria-pressed': String(isOn),
          onclick: () => store.setState({ radioCategory: c.id }),
        }, `${c.label} · ${n}`);
      });
    chips.replaceChildren(frag(nodes));
  }

  const unsubscribe = store.subscribe((_s, keys) => {
    if (keys.has('radios') || keys.has('query') || keys.has('playback') ||
        keys.has('radioCategory')) render();
  }, { immediate: true });

  return { render, destroy: unsubscribe };
}
