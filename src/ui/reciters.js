import { h, frag, qs } from '../utils/dom.js';
import { matchesAll } from '../utils/arabic.js';

/**
 * Three explicit steps, as the user asked: reader, then riwaya, then surahs.
 *
 * Tapping a reader EXPANDS it in place instead of jumping to the surah grid,
 * because the surah list belongs to the (reader, riwaya) PAIR, not to the
 * reader: the same reader appears with 114 surahs under one riwaya and 38 under
 * another. Choosing the reader alone therefore does not say which list is about
 * to open, and auto-picking moshaf[0] would silently decide it for the user.
 * No riwaya is ever chosen on their behalf here — the store keeps
 * `selectedMoshafId` exactly as the user left it until a riwaya is tapped.
 */
export function createRecitersView({ root, store, onSelectMoshaf }) {
  // A riwaya picker above the grid: 20 canonical riwayas, and tapping one
  // shows only the readers carrying it. This is the answer to a reader card
  // growing to an impractical height when it holds several riwayas — the
  // choice moves up front, and the card only expands on demand.
  const chips = h('div', { class: 'riwaya-filter', role: 'group', 'aria-label': 'تصفية حسب الرواية' });
  const grid = h('div', { class: 'grid grid-reciters' });
  root.append(chips, grid);

  // `getReciters` maps `(r.moshaf || [])`, so a live payload always yields an
  // array. The guards below are for the OTHER route into this view's state: the
  // 24h cache, which is hand-editable and outlives any payload. A `moshaf: null`
  // there throws inside render(), the store catches and logs it, and the grid
  // stays permanently empty with nothing on screen to explain why.
  const moshafsOf = (r) => (Array.isArray(r.moshaf) ? r.moshaf : []);

  // 241 reciters share 287 moshafs, so one riwaya is the common case and Arabic
  // needs the singular and the plural distinguished. Real counts are 114, 38 and
  // a few dozen smaller sets — all above 10, where Arabic takes the singular
  // noun, so only the riwaya count needs the two-way choice.
  const riwayaCount = (n) => (n === 0 ? 'بلا روايات' : n === 1 ? '1 رواية' : `${n} روايات`);

  /**
   * The surah-count RANGE across this reader's riwayas, not one reciter's count.
   * A reader with two riwayas at 114 and 38 is exactly the case that has to be
   * visible before the riwaya is chosen; collapsing it to moshaf[0]'s count is
   * what made the distinction invisible. Zero is dropped, because
   * `surah_total` absent from the payload must not read as "0 سورة".
   */
  function surahRange(r) {
    const counts = [...new Set(moshafsOf(r).map((m) => Number(m.surahTotal) || 0))]
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    if (counts.length === 0) return '';
    if (counts.length === 1) return `${counts[0]} سورة`;
    return `${counts[0]}–${counts[counts.length - 1]} سورة`;
  }

  function head(r, open) {
    const meta = [riwayaCount(moshafsOf(r).length)];
    const range = surahRange(r);
    if (range) meta.push(range);

    // A <button>, and the only interactive element in the collapsed card: the
    // riwaya buttons appended below are siblings of it inside a plain <div>, not
    // descendants, so no button is ever nested inside another.
    return h('button', {
      class: 'reciter-head',
      type: 'button',
      'aria-expanded': String(open),
      onclick: () => store.setState({ expandedReciterId: open ? null : r.id }),
    },
      h('span', { class: 'reciter-text' },
        h('span', { class: 'reciter-name' }, r.name),
        h('span', { class: 'reciter-meta' }, meta.join(' · '))),
      // Up/down, not left/right: the glyph encodes a vertical direction, which
      // RTL does not mirror (the same rule player.js applies to its arrows).
      h('span', { class: 'reciter-caret', 'aria-hidden': 'true' },
        open ? '▲' : '▼'));
  }

  function riwayaList(r, selectedMoshafId) {
    const moshafs = moshafsOf(r);
    if (moshafs.length === 0) {
      return h('p', { class: 'empty' }, 'لا روايات متاحة لهذا القارئ');
    }
    return h('div', { class: 'riwaya-list' }, moshafs.map((m) => {
      const on = m.id === selectedMoshafId;
      return h('button', {
        class: `riwaya${on ? ' is-on' : ''}`,
        type: 'button',
        // aria-current rather than aria-pressed: this is the choice in a set,
        // not a toggle, and pressing the current one again is a no-op.
        'aria-current': on ? 'true' : null,
        onclick: () => onSelectMoshaf(r, m),
      },
        h('span', { class: 'riwaya-name' }, m.name),
        h('span', { class: 'riwaya-meta' },
          m.style ? h('span', { class: 'chip' }, m.style) : null,
          m.surahTotal ? `${m.surahTotal} سورة` : null));
    }));
  }

  /**
 * Ids of the surahs whose names match the query. A reader matches on any surah
 * one of its riwayas can actually recite, so typing "الكهف" on this tab surfaces
 * the readers who have it. Without it the ONE search box could not span both
 * halves of the app: the reciters view never looked at surah names, so a user
 * looking for the reader of a surah they already knew got nothing, while the
 * surahs tab had 114 names to match against.
 *
 * A Set, because this runs per reader over a 114-entry surah_list, and the
 * matching ids are recomputed for every reciter otherwise.
 */
function matchingSurahIds(suwarById, query) {
  const ids = new Set();
  for (const [id, meta] of suwarById) {
    if (matchesAll(meta?.name || '', query)) ids.add(id);
  }
  return ids;
}

function canRecite(moshafs, surahIds) {
  return moshafs.some((m) => (m.surahList ?? []).some((id) => surahIds.has(id)));
}

  function renderChips(s) {
    // "الكل" clears the filter. Chips show a count so the user sees how many
    // readers each riwaya has before tapping.
    const all = h('button', {
      class: `chip-lg${!s.riwayaFilter ? ' is-on' : ''}`,
      type: 'button',
      'aria-pressed': String(!s.riwayaFilter),
      onclick: () => store.setState({ riwayaFilter: null }),
    }, `الكل · ${s.reciters.length}`);
    const nodes = [all];
    for (const rw of s.riwayat || []) {
      const n = s.reciters.filter((r) =>
        moshafsOf(r).some((m) => (m.name || '').includes(rw.name))).length;
      if (n === 0) continue;
      nodes.push(h('button', {
        class: `chip-lg${s.riwayaFilter === rw.name ? ' is-on' : ''}`,
        type: 'button',
        'aria-pressed': String(s.riwayaFilter === rw.name),
        onclick: () => store.setState({
          riwayaFilter: s.riwayaFilter === rw.name ? null : rw.name,
        }),
      }, `${rw.name} · ${n}`));
    }
    chips.replaceChildren(frag(nodes));
  }

  function render() {
    const s = store.getState();

    // The picker lists the 20 canonical riwayas from /riwayat. A reader
    // matches when any of its moshaf names contains the riwaya name — verified
    // against all 22 distinct moshaf names, with zero misses. The overlaps are
    // benign: "قالون عن نافع" also matches "قالون عن نافع من طريق أبي نشيط",
    // which genuinely is that riwaya down a named path.
    renderChips(s);
    let list = s.reciters;
    if (s.riwayaFilter) {
      list = list.filter((r) => moshafsOf(r).some((m) => (m.name || '').includes(s.riwayaFilter)));
    }
    // One box, one query, four views — and each view filters its own data. A
    // reciter matches on its own name, on any of its riwaya names, and on any
    // surah it can recite, so "حفص" finds a reader whose name does not contain
    // the riwaya and "الكهف" finds the readers who have that surah. The riwaya
    // filter above and this query combine: both must pass.
    const queried = s.query
      ? (() => {
          const surahIds = matchingSurahIds(s.suwarById, s.query);
          return list.filter((r) => {
            const moshafs = moshafsOf(r);
            return matchesAll(r.name, s.query) ||
              moshafs.some((m) => matchesAll(m.name, s.query)) ||
              canRecite(moshafs, surahIds);
          });
        })()
      : list;
    list = queried;

    if (list.length === 0) {
      grid.replaceChildren(h('p', { class: 'empty' },
        s.reciters.length ? 'لا نتائج مطابقة' : 'جارٍ تحميل القرّاء…'));
      return;
    }

    const nodes = list.map((r) => {
      const moshafs = moshafsOf(r);
      const open = s.expandedReciterId === r.id;
      const chosen = moshafs.some((m) => m.id === s.selectedMoshafId);
      const card = h('div', {
        class: `card reciter${chosen ? ' is-selected' : ''}${open ? ' is-open' : ''}`,
      }, head(r, open));
      if (open) card.append(riwayaList(r, s.selectedMoshafId));
      return card;
    });

    grid.replaceChildren(frag(nodes));
  }

  // Every key that can change what is drawn. `selectedMoshafId` rather than
  // `selectedMoshaf`: the cards compare against raw moshaf ids, and the resolved
  // object is a fresh reference on every background refresh — keying on it would
  // re-render 241 cards each time the reciters payload is refetched.
  // `suwarById` is here because the surah matching above needs the names: without
  // it a query typed before the suwar payload landed would keep its incomplete
  // result set for the rest of the session.
  const unsubscribe = store.subscribe((_s, keys) => {
    if (keys.has('reciters') || keys.has('query') || keys.has('suwarById') ||
        keys.has('riwayat') || keys.has('riwayaFilter') ||
        keys.has('selectedMoshafId') || keys.has('expandedReciterId')) render();
  }, { immediate: true });

  /**
   * Scrolls the expanded reader into view. The wiring calls this after sending
   * the user back to this tab from the surah header's change button, because
   * with 241 cards the reader they are switching riwaya on can be many screens
   * away and the expansion they asked for would be off screen.
   *
   * Queued on a microtask rather than scrolled inline: setState flushes its
   * listeners on a microtask, so scrolling first would measure the card list as
   * it was before the re-render this navigation is about to cause.
   */
  function reveal() {
    queueMicrotask(() => {
      const card = qs('.reciter.is-open', grid);
      // Optional call: happy-dom has no layout, and scrollIntoView is absent in
      // some embedded webviews, where the call would throw inside the microtask.
      card?.scrollIntoView?.({ block: 'center' });
    });
  }

  return { render, reveal, destroy: unsubscribe };
}
