import { h, frag } from '../utils/dom.js';
import { matchesAll } from '../utils/arabic.js';
import { isFavorite } from '../utils/favorites.js';
import { AYAH_COUNTS } from '../utils/ayah-counts.js';
import { icon } from './icons.js';

const NOT_PICKED = 'اختر قارئاً ثم روايته من تبويب «القرّاء»';

export function createSurahsView({ root, store, onPlay, onToggleFavorite, onChangeReciter }) {
  const head = h('div', { class: 'surah-head' });
  const grid = h('div', { class: 'grid grid-surahs' });
  root.append(head, grid);

  /**
   * Always present, so the list below is never unattributed: it names the
   * (reader, riwaya) pair the surahs belong to, because the pair is what decides
   * the list, and its change button is the only way back to picking another.
   */
  function renderHead(moshaf) {
    if (!moshaf) {
      head.replaceChildren(h('p', { class: 'empty' }, NOT_PICKED));
      return;
    }
    // `?? []` for the same reason buildPlaylist guards: a moshaf restored from a
    // cache written before surah_list was parsed must not throw here.
    const total = (moshaf.surahList ?? []).length;
    head.replaceChildren(
      h('div', { class: 'surah-where' },
        h('span', { class: 'surah-where-reciter' }, moshaf.reciterName || ''),
        h('span', { class: 'surah-where-riwaya' }, moshaf.name || '')),
      h('button', {
        class: 'btn-ghost',
        type: 'button',
        // Naming the reader in the accessible name: "تغيير" alone leaves a screen
        // reader announcing four identical buttons once several views are mounted.
        'aria-label': `تغيير القارئ أو الرواية — ${moshaf.reciterName || ''}`,
        onclick: () => onChangeReciter(moshaf.reciterId),
      }, 'تغيير'),
      h('span', { class: 'surah-count' }, `${total} سورة`),
    );
  }

  function render() {
    const s = store.getState();
    const moshaf = s.selectedMoshaf;
    renderHead(moshaf);

    if (!moshaf) {
      grid.replaceChildren();
      return;
    }

    // `?? []` mirrors buildPlaylist's guard: a moshaf restored from a cache
    // written before surah_list was parsed renders as empty rather than
    // throwing on `.filter`.
    const available = moshaf.surahList ?? [];
    // Only this moshaf's own surahs, never the global 114. The API does not
    // agree across reciters — one ships 38 — so the global list would offer
    // tracks that do not exist for the voice in use.
    const ids = s.query
      ? available.filter((id) => matchesAll(s.suwarById.get(id)?.name || '', s.query))
      : available;

    if (ids.length === 0) {
      grid.replaceChildren(h('p', { class: 'empty' },
        s.suwarById.size ? 'لا نتائج مطابقة' : 'جارٍ التحميل…'));
      return;
    }

    const nodes = ids.map((id) => {
      const meta = s.suwarById.get(id);
      const ayahs = AYAH_COUNTS[id];
      const fav = isFavorite(s.favorites, id, moshaf.id);
      const isNow = s.playback?.kind === 'surah' &&
        s.playback.surahId === id && s.playback.moshafId === moshaf.id;

      // The card is a div, not a button, with a real button inside it. A
      // role="button" wrapper around the heart would nest an interactive
      // element inside another, and the space/enter handler would be hand-rolled
      // beside a native one — the button gets both for free.
      const open = h('button', { class: 'surah-open', type: 'button', onclick: () => onPlay(id) },
        // The surah number rides with the revelation place: the API's `name` is
        // the bare name ("الفاتحة") and carries no number. Place is blanked
        // while `suwar` is still in flight rather than guessed, because defaulting
        // to "مدنية" would be a wrong label on every card for that second.
        h('span', { class: 'surah-place' },
          meta ? `${meta.isMeccan ? 'مكية' : 'مدنية'} · ${id}` : ''),
        h('span', { class: 'ayah-badge', 'aria-hidden': 'true' }, String(ayahs ?? '')),
        h('span', { class: 'surah-name' }, meta?.name || `سورة ${id}`),
        h('span', { class: 'ayah-label' }, `${ayahs ?? '؟'} آية`));

      const heart = h('button', {
        class: `heart${fav ? ' is-on' : ''}`,
        type: 'button',
        'aria-pressed': String(fav),
        'aria-label': fav ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة',
        onclick: (e) => { e.stopPropagation(); onToggleFavorite(id); },
      }, icon(fav ? 'heartOn' : 'heart'));

      return h('div', { class: `card surah${isNow ? ' is-playing' : ''}` }, open, heart);
    });

    grid.replaceChildren(frag(nodes));
  }

  const unsubscribe = store.subscribe((_s, keys) => {
    if (keys.has('selectedMoshaf') || keys.has('query') || keys.has('favorites') ||
        keys.has('playback') || keys.has('suwarById')) render();
  }, { immediate: true });

  return { render, destroy: unsubscribe };
}
