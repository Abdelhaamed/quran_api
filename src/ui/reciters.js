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
  const grid = h('div', { class: 'grid grid-reciters' });
  root.append(grid);

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
    const counts = [...new Set(r.moshaf.map((m) => Number(m.surahTotal) || 0))]
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    if (counts.length === 0) return '';
    if (counts.length === 1) return `${counts[0]} سورة`;
    return `${counts[0]}–${counts[counts.length - 1]} سورة`;
  }

  function head(r, open) {
    const meta = [riwayaCount(r.moshaf.length)];
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
    if (r.moshaf.length === 0) {
      return h('p', { class: 'empty' }, 'لا روايات متاحة لهذا القارئ');
    }
    return h('div', { class: 'riwaya-list' }, r.moshaf.map((m) => {
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

  function render() {
    const s = store.getState();
    // One box searches both, but each view filters its own data. A reciter also
    // matches on any of its riwaya names, so "حفص" finds a reciter whose own
    // name does not contain the riwaya.
    const list = s.query
      ? s.reciters.filter((r) =>
          matchesAll(r.name, s.query) ||
          r.moshaf.some((m) => matchesAll(m.name, s.query)))
      : s.reciters;

    if (list.length === 0) {
      grid.replaceChildren(h('p', { class: 'empty' },
        s.reciters.length ? 'لا نتائج مطابقة' : 'جارٍ تحميل القرّاء…'));
      return;
    }

    const nodes = list.map((r) => {
      const open = s.expandedReciterId === r.id;
      const chosen = r.moshaf.some((m) => m.id === s.selectedMoshafId);
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
  const unsubscribe = store.subscribe((_s, keys) => {
    if (keys.has('reciters') || keys.has('query') ||
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
