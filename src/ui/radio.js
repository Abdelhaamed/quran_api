import { h, frag } from '../utils/dom.js';
import { matchesAll, normalize } from '../utils/arabic.js';
import { isRadioFavorite } from '../utils/favorites.js';
import { icon } from './icons.js';

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

const OVERRIDES = {
  'هيثم الجدعاني': 'tilawa',
  'تكبيرات العيد': 'adhkar',
  'كتاب الاختيارات الفقهية في مسائل العبادات والمعاملات': 'fatawa',
  'صحيح البخاري': 'sira',
  'صحيح مسلم': 'sira',
  'رياض الصالحين': 'sira',
  'فضل شهر رمضان': 'fatawa',
};

export function categorize(name) {
  const text = normalize(name || '');
  // Exact-name overrides, checked before keywords. Keywords are substrings and
  // can misfire: "الجدعاني" contains the دعا sequence, so هيثم الجدعاني landed
  // in أذكار. The rest are user-requested placements that no keyword covers
  // (تكبيرات العيد) or that belong elsewhere by content (the two Sahihs and
  // Riyadh as-Salihin read as sira/qasas here, Fadl Ramadan as fatawa).
  // Compared normalized so hamza variants on either side still hit.
  for (const [key, id] of Object.entries(OVERRIDES)) {
    if (text === normalize(key)) return id;
  }
  for (const c of CATEGORIES) {
    if (!c.keys || c.keys.length === 0) continue;
    if (c.keys.some((k) => text.includes(k))) return c.id;
  }
  return 'tilawa';
}

export function categoryLabel(id) {
  return (CATEGORIES.find((c) => c.id === id) || CATEGORIES[0]).label;
}

export function createRadioView({ root, store, onPlay, onToggleFavorite }) {
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
      const fav = isRadioFavorite(s.favorites, r.url);
      return h('div', { class: `row-wrap${on ? ' is-playing' : ''}` },
        h('button', {
          class: 'row',
          type: 'button',
          onclick: () => onPlay(r),
        },
          h('span', { class: 'row-dot' }),
          h('span', { class: 'row-name' }, r.name)),
        h('button', {
          class: `heart${fav ? ' is-on' : ''}`,
          type: 'button',
          'aria-pressed': String(fav),
          'aria-label': fav ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة',
          onclick: (e) => { e.stopPropagation(); onToggleFavorite(r); },
        }, icon(fav ? 'heartOn' : 'heart')));
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
        keys.has('favorites') || keys.has('radioCategory')) render();
  }, { immediate: true });

  return { render, destroy: unsubscribe };
}
