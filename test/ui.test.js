// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createStore } from '../src/state/store.js';
import { createShell, TABS, THEMES, resolveDark } from '../src/ui/shell.js';
import { createSearch } from '../src/ui/search.js';
import { createRecitersView } from '../src/ui/reciters.js';
import { createSurahsView } from '../src/ui/surahs.js';
import { createFavoritesView } from '../src/ui/favorites.js';
import { createRadioView } from '../src/ui/radio.js';
import { AYAH_COUNTS } from '../src/utils/ayah-counts.js';
import { favoriteKey } from '../src/utils/favorites.js';

// happy-dom replaces import.meta.url with an http URL, so the repo file is
// resolved from the vitest root (the directory holding vite.config.js) instead.
const HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
// happy-dom tries to FETCH any <script src> it parses, so the module tag is
// dropped before the markup is mounted. The tests drive the same module graph
// through a dynamic import() instead, and index.html's own script tag is
// asserted on separately below.
const BODY = HTML
  .slice(HTML.indexOf('<body>') + 6, HTML.indexOf('</body>'))
  .replace(/<script\b[^>]*><\/script>/g, '');
const PRE_PAINT = /<script>\n([\s\S]*?)<\/script>/.exec(HTML)[1];

// A single gate, not a single promise: the four endpoints answer with four
// different payloads, so holding one shared promise open would hand
// Promise.all the same value four times — an undefined one, if the test just
// calls the resolver.
const api = vi.hoisted(() => ({
  reciters: [], suwar: [], radios: [], riwayat: [],
  fresh: null, gate: null, open: null, failWith: null, signals: [],
}));

vi.mock('../src/api/quran.js', async (importOriginal) => {
  const actual = await importOriginal();
  const getter = (name) => async (signal) => {
    api.signals.push(signal);
    if (!api.gate) return api[name];
    await api.gate;
    if (api.failWith) throw api.failWith;
    return api.fresh[name];
  };
  return {
    ...actual,
    getReciters: getter('reciters'),
    getSuwar: getter('suwar'),
    getRadios: getter('radios'),
    getRiwayat: getter('riwayat'),
  };
});

/** Holds every endpoint open until the returned function is called. */
const holdRequests = (fresh = {}) => {
  api.gate = new Promise((r) => { api.open = () => r(); });
  api.fresh = { reciters: RECITERS, suwar: SUWAR, radios: RADIOS, riwayat: [], ...fresh };
  return api.open;
};

const flush = () => new Promise((r) => setTimeout(r, 0));
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

const moshaf = (id, over = {}) => ({
  id, name: 'رواية حفص عن عاصم', style: 'مرتّل',
  server: `https://server${id}.example/`, surahTotal: 3,
  surahList: [1, 2, 3], ...over,
});

const reciter = (id, name, ...ms) => ({ id, name, letter: '', moshaf: ms });

const RECITERS = [
  reciter(1, 'أحمد العكش', moshaf(11)),
  reciter(2, 'محمود خليل الحصري', moshaf(22, { surahList: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })),
  // The pair the three-step navigation exists for: ONE reader, TWO riwayas, and
  // the second carries a third of the first's surahs. Every test that would pass
  // under an auto-selected moshaf[0] has to be able to fail against it, which
  // needs a reciter whose first riwaya is not the one the user means.
  reciter(3, 'ياسر الدوسري',
    moshaf(31, {
      name: 'رواية حفص عن عاصم مرتل', style: 'مرتّل',
      surahTotal: 4, surahList: [1, 2, 3, 18],
    }),
    moshaf(32, {
      name: 'رواية حفص عن عاصم مجود', style: 'مجوّد',
      surahTotal: 1, surahList: [1],
    })),
];
const SUWAR = [
  { id: 1, name: 'الفاتحة', isMeccan: true, pageStart: 1, pageEnd: 1 },
  { id: 2, name: 'البقرة', isMeccan: true, pageStart: 2, pageEnd: 49 },
  { id: 3, name: 'آل عمران', isMeccan: true, pageStart: 50, pageEnd: 176 },
  { id: 18, name: 'الكهف', isMeccan: true, pageStart: 293, pageEnd: 304 },
];
const RADIOS = [
  { id: 1, name: 'إذاعة إبراهيم العكش', url: 'https://radio.example/akdr' },
  { id: 2, name: 'إذاعة تلاوة', url: 'https://radio.example/tl' },
];

const emptyState = (over = {}) => ({
  theme: 'auto', activeTab: 'reciters', query: '', offline: false,
  reciters: [], suwarById: new Map(), riwayat: [], radios: [],
  selectedMoshafId: null, expandedReciterId: null, selectedMoshaf: null,
  playback: null, repeat: 'off', favorites: [], ...over,
});

const storeWith = (over) => createStore(emptyState(over));

const mountShellDom = () => { document.body.innerHTML = BODY; };

/**
 * The two real taps of the reader -> riwaya -> surahs flow, in order. Written
 * once so no test can reach the surahs by a shortcut the user does not have: the
 * head tap expands, and only a riwaya tap selects.
 */
async function chooseMoshaf({ index = 0, riwaya = 0, root = document } = {}) {
  const head = qsa('#view-reciters .reciter-head', root)[index];
  // Only tap when the card is actually closed. `expandedReciterId` is persisted,
  // so a test booting with storage intact can find a reader already open, and an
  // unconditional tap would collapse it instead of expanding it.
  if (head.getAttribute('aria-expanded') === 'false') {
    head.click();
    await flush();
  }
  qsa('#view-reciters .reciter.is-open .riwaya', root)[riwaya].click();
  await flush();
}

/** Asserts no button anywhere inside `root` contains another button. */
const expectNoNestedButtons = (root) => {
  for (const btn of qsa('button', root)) {
    expect(qsa('button', btn), `a button nested inside <button class="${btn.className}">`)
      .toHaveLength(0);
  }
};

// ---------------------------------------------------------------------------
// index.html — the shell the JS modules bind to by id.
// ---------------------------------------------------------------------------

describe('index.html', () => {
  it('provides the four view containers the modules mount into', () => {
    mountShellDom();
    for (const name of TABS) {
      expect(qs(`#view-${name}`), `#view-${name}`).toBeTruthy();
    }
    expect(qs('#search')).toBeTruthy();
    expect(qs('#theme-toggle')).toBeTruthy();
    expect(qs('#banner')).toBeTruthy();
    expect(qs('#toast')).toBeTruthy();
    expect(qs('#player')).toBeTruthy();
  });

  it('keeps the four tabs in the same order the view modules are named for', () => {
    mountShellDom();
    expect(qsa('.tab').map((b) => b.dataset.tab)).toEqual(TABS);
  });

  it('links each tab to its panel in both directions', () => {
    mountShellDom();
    for (const name of TABS) {
      const btn = qs(`.tab[data-tab="${name}"]`);
      // aria-controls is an ID reference, so it carries no '#'.
      expect(btn.getAttribute('aria-controls')).toBe(`view-${name}`);
      expect(qs(`#view-${name}`).getAttribute('aria-labelledby')).toBe(btn.id);
    }
  });

  it('ships the pre-paint theme script in the head, before the styles', () => {
    // The script must precede the module script: it exists to set the theme
    // before the first paint, so a script tag placed later has already missed.
    const scriptAt = HTML.indexOf('<script>');
    const moduleAt = HTML.indexOf('type="module"');
    expect(scriptAt).toBeGreaterThan(-1);
    expect(moduleAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeLessThan(moduleAt);
  });

  it('marks the player root with no class, so player.js owns the only one', () => {
    mountShellDom();
    // createPlayer adds `pl`. A second class name here would be a second thing
    // to keep in step with the stylesheet.
    expect(qs('#player').className).toBe('');
  });
});

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

describe('createShell', () => {
  let store;
  let shell;

  beforeEach(() => {
    mountShellDom();
    localStorage.clear();
    store = storeWith();
    shell = createShell({ store });
  });

  afterEach(() => shell.destroy());

  it('shows the active tab’s panel and hides the other three', () => {
    for (const name of TABS) expect(qs(`#view-${name}`).hidden).toBe(name !== 'reciters');
    expect(qs('.tab[data-tab="reciters"]').getAttribute('aria-selected')).toBe('true');
    expect(qs('.tab[data-tab="radio"]').getAttribute('aria-selected')).toBe('false');
  });

  it('keeps only the selected tab in the tab order', () => {
    expect(qsa('.tab').map((b) => b.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('switches panels on click and persists the choice', async () => {
    qs('.tab[data-tab="radio"]').click();
    await flush();
    expect(qs('#view-radio').hidden).toBe(false);
    expect(qs('#view-reciters').hidden).toBe(true);
    expect(qs('.tab[data-tab="radio"]').getAttribute('aria-selected')).toBe('true');
    expect(qsa('.tab').map((b) => b.tabIndex)).toEqual([-1, -1, -1, 0]);
    expect(JSON.parse(localStorage.getItem('quran.state.v2')).activeTab).toBe('radio');
  });

  it('moves between tabs with the arrow keys, in reading order', async () => {
    // The document is permanently RTL, so ArrowLeft advances the tab order.
    const press = async (key, from) => {
      const btn = qs(`.tab[data-tab="${from}"]`);
      btn.focus();
      btn.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await flush();
    };
    await press('ArrowLeft', 'reciters');
    expect(store.getState().activeTab).toBe('surahs');
    await press('ArrowRight', 'surahs');
    expect(store.getState().activeTab).toBe('reciters');
    await press('ArrowRight', 'reciters');
    expect(store.getState().activeTab).toBe('radio');
    // One step past the last tab wraps to the first.
    await press('ArrowLeft', 'radio');
    expect(store.getState().activeTab).toBe('reciters');
    await press('End', 'reciters');
    expect(store.getState().activeTab).toBe('radio');
    await press('Home', 'radio');
    expect(store.getState().activeTab).toBe('reciters');
  });

  it('cycles the theme and writes every step', () => {
    const label = () => qs('#theme-toggle').getAttribute('aria-label');
    expect(document.documentElement.dataset.theme).toBe('light');
    qs('#theme-toggle').click();
    expect(store.getState().theme).toBe('light');
    expect(label()).toBe('الوضع النهاري مفعّل');
    qs('#theme-toggle').click();
    expect(store.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem('quran.state.v2')).theme).toBe('dark');
    qs('#theme-toggle').click();
    expect(store.getState().theme).toBe('auto');
  });

  it('resolves a stored theme exactly the way the pre-paint script does', () => {
    // Two copies of the same rule, one inline in index.html and one in
    // shell.js. If they ever disagree the app repaints the theme the inline
    // script just set, which is the flash that script exists to prevent.
    const real = window.matchMedia;
    try {
      for (const prefers of [true, false]) {
        window.matchMedia = () => ({ matches: prefers, addEventListener() {} });
        for (const theme of ['auto', 'light', 'dark', 'nonsense']) {
          localStorage.setItem('quran.state.v2', JSON.stringify({ theme }));
          runPrePaint();
          expect(document.documentElement.dataset.theme, `theme=${theme} prefers=${prefers}`)
            .toBe(resolveDark(theme, prefers) ? 'dark' : 'light');
        }
      }
    } finally {
      window.matchMedia = real;
    }
  });

  it('scrolls to the top for a tab change made from code, not only on click', async () => {
    // Both of the app's real tab changes are made from code: picking a riwaya
    // opens the surahs, and the surah header's change button opens the readers.
    const real = globalThis.scrollTo;
    const spy = vi.fn();
    globalThis.scrollTo = spy;
    try {
      store.setState({ activeTab: 'surahs' });
      await flush();
      expect(spy).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });

      spy.mockClear();
      store.setState({ offline: true });
      await flush();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      globalThis.scrollTo = real;
    }
  });

  it('shows the offline notice from the flag alone', async () => {
    expect(qs('#banner').hidden).toBe(true);
    store.setState({ offline: true });
    await flush();
    expect(qs('#banner').hidden).toBe(false);
    expect(qs('#banner').textContent.length).toBeGreaterThan(0);
    store.setState({ offline: false });
    await flush();
    expect(qs('#banner').hidden).toBe(true);
  });

  it('lets an app notice outrank the ambient offline flag, and vice versa', async () => {
    store.setState({ offline: true });
    await flush();
    shell.banner('تعذّر التحديث');
    expect(qs('#banner').textContent).toBe('تعذّر التحديث');
    store.setState({ offline: false });
    await flush();
    // Going back online must not discard the app's own message, and must clear
    // the ambient one on its own.
    expect(qs('#banner').textContent).toBe('تعذّر التحديث');
    shell.banner('');
    expect(qs('#banner').hidden).toBe(true);
  });

  it('re-renders nothing on a state change that touches no rendered key', async () => {
    const before = qs('#banner').textContent;
    store.setState({ reciters: RECITERS });
    await flush();
    expect(qs('#banner').textContent).toBe(before);
  });
});

const runPrePaint = () => { new Function(PRE_PAINT)(); };

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('createSearch', () => {
  beforeEach(() => {
    mountShellDom();
    localStorage.clear();
  });

  it('commits the trimmed query once the typing settles', async () => {
    const store = storeWith();
    createSearch({ store });
    const input = qs('#search');
    input.value = '  الكهف  ';
    input.dispatchEvent(new window.Event('input'));
    expect(store.getState().query).toBe('');
    await new Promise((r) => setTimeout(r, 200));
    expect(store.getState().query).toBe('الكهف');
  });

  it('coalesces a burst of keystrokes into one commit', async () => {
    const store = storeWith();
    createSearch({ store });
    const input = qs('#search');
    for (const value of ['ا', 'ال', 'الک', 'الكهف']) {
      input.value = value;
      input.dispatchEvent(new window.Event('input'));
    }
    expect(store.getState().query).toBe('');
    await new Promise((r) => setTimeout(r, 200));
    expect(store.getState().query).toBe('الكهف');
  });

  it('writes a programmatic clear back into the box', async () => {
    // The empty case is the one a truthiness guard skips: a non-empty query is
    // cleared by the tab switch below, and the box has to follow it out.
    const store = storeWith({ query: 'الكهف' });
    createSearch({ store });
    expect(qs('#search').value).toBe('الكهف');
    store.setState({ query: '' });
    await flush();
    expect(qs('#search').value).toBe('');
  });

  it('clears the query and the box together when the tab changes', async () => {
    const store = storeWith({ query: 'الكهف' });
    createSearch({ store });
    expect(qs('#search').value).toBe('الكهف');
    store.setState({ activeTab: 'radio' });
    await flush();
    expect(store.getState().query).toBe('');
    expect(qs('#search').value).toBe('');
  });

  it('leaves the box alone for a state change that touches no query', async () => {
    const store = storeWith({ query: 'الكهف' });
    createSearch({ store });
    const input = qs('#search');
    input.value = 'الكهف';
    store.setState({ reciters: RECITERS });
    await flush();
    expect(input.value).toBe('الكهف');
  });
});

// ---------------------------------------------------------------------------
// reciters
// ---------------------------------------------------------------------------

describe('createRecitersView', () => {
  const build = (over = {}) => {
    const root = document.createElement('section');
    document.body.replaceChildren(root);
    const store = storeWith({ reciters: RECITERS, ...over });
    const onSelectMoshaf = vi.fn();
    const view = createRecitersView({ root, store, onSelectMoshaf });
    return { root, store, onSelectMoshaf, view };
  };

  it('renders one card per reciter, with the riwaya count and the surah range', () => {
    const { root } = build();
    const cards = qsa('.reciter', root);
    expect(cards).toHaveLength(3);
    expect(cards[0].querySelector('.reciter-name').textContent).toBe('أحمد العكش');
    expect(cards[0].querySelector('.reciter-meta').textContent).toBe('1 رواية · 3 سورة');
    // Two riwayas at 4 and 1 surahs: the range is the whole point of the step,
    // since collapsing it to one number is what hid the difference.
    expect(cards[2].querySelector('.reciter-meta').textContent).toBe('2 روايات · 1–4 سورة');
  });

  it('says a reader with no riwaya has none rather than counting zero', () => {
    const { root } = build({ reciters: [reciter(7, 'قارئ بلا روايات')] });
    expect(qs('.reciter-meta', root).textContent).toBe('بلا روايات');
  });

  it('expands a reader in place instead of selecting it', async () => {
    const { root, store, onSelectMoshaf } = build({ selectedMoshafId: 22 });
    qsa('.reciter-head', root)[0].click();
    await flush();

    // Nothing was chosen: the tab did not move, the selection did not change and
    // no riwaya callback fired. Expanding is not selecting.
    expect(store.getState().activeTab).toBe('reciters');
    expect(store.getState().selectedMoshafId).toBe(22);
    expect(onSelectMoshaf).not.toHaveBeenCalled();
    expect(store.getState().expandedReciterId).toBe(1);
  });

  it('lists the expanded reader’s riwayas, and no other reader’s', async () => {
    const { root } = build();
    qsa('.reciter-head', root)[2].click();
    await flush();

    expect(qsa('.reciter.is-open', root)).toHaveLength(1);
    expect(qsa('.riwaya', root).map((b) => qs('.riwaya-name', b).textContent))
      .toEqual(['رواية حفص عن عاصم مرتل', 'رواية حفص عن عاصم مجود']);
    expect(qsa('.riwaya', root).map((b) => qs('.riwaya-meta', b).textContent))
      .toEqual(['مرتّل4 سورة', 'مجوّد1 سورة']);
    // The head reports its own state rather than leaving aria-expanded stale.
    expect(qsa('.reciter-head', root)[2].getAttribute('aria-expanded')).toBe('true');
    expect(qsa('.reciter-head', root)[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('collapses on a second tap, and moves the expansion to another reader', async () => {
    const { root } = build();
    qsa('.reciter-head', root)[0].click();
    await flush();
    qsa('.reciter-head', root)[0].click();
    await flush();
    expect(qsa('.riwaya', root)).toHaveLength(0);

    qsa('.reciter-head', root)[0].click();
    await flush();
    qsa('.reciter-head', root)[2].click();
    await flush();
    // Only one reader is open at a time: two open readers make "which riwaya did
    // I pick" ambiguous on a grid of 241 cards.
    expect(qsa('.reciter.is-open', root)).toHaveLength(1);
    expect(qs('.reciter.is-open .reciter-name', root).textContent).toBe('ياسر الدوسري');
  });

  it('expands whichever reader the store names, restored from storage', () => {
    const { root } = build({ expandedReciterId: 3 });
    expect(qs('.reciter.is-open .reciter-name', root).textContent).toBe('ياسر الدوسري');
  });

  it('reports the riwaya that was tapped, never the reader’s first', async () => {
    const { root, store, onSelectMoshaf } = build();
    qsa('.reciter-head', root)[2].click();
    await flush();
    qsa('.riwaya', root)[1].click();
    await flush();

    expect(onSelectMoshaf).toHaveBeenCalledWith(RECITERS[2], RECITERS[2].moshaf[1]);
    expect(store.getState().expandedReciterId).toBe(3);
  });

  it('marks the chosen riwaya, not just its reader', async () => {
    const { root } = build({ selectedMoshafId: 32 });
    qsa('.reciter-head', root)[2].click();
    await flush();
    const rows = qsa('.riwaya', root);
    expect(rows[0].classList.contains('is-on')).toBe(false);
    expect(rows[1].classList.contains('is-on')).toBe(true);
    expect(rows[1].getAttribute('aria-current')).toBe('true');
    expect(rows[0].getAttribute('aria-current')).toBe(null);
    // The reader card is marked from its moshaf list, so the reader shows up as
    // selected on the readers tab even though it is the surahs tab in play.
    expect(qsa('.reciter', root)[2].classList.contains('is-selected')).toBe(true);
  });

  it('shows a reader with no riwayas instead of an empty expander', async () => {
    const { root } = build({ reciters: [reciter(7, 'قارئ بلا روايات')] });
    qsa('.reciter-head', root)[0].click();
    await flush();
    expect(qsa('.riwaya', root)).toHaveLength(0);
    expect(qs('.empty', root).textContent).toBe('لا روايات متاحة لهذا القارئ');
  });

  it('never nests one button inside another', async () => {
    const { root } = build({ selectedMoshafId: 31 });
    expectNoNestedButtons(root);
    // The same check with a reader open, which is the only state that adds the
    // riwaya buttons.
    qsa('.reciter-head', root)[2].click();
    await flush();
    expectNoNestedButtons(root);
    expect(qsa('.reciter.is-open button', root).length).toBeGreaterThan(1);
  });

  it('falls back to the riwaya name when deriveStyle found no style word', async () => {
    const { root } = build({
      reciters: [reciter(1, 'قارئ', moshaf(11, { style: '', name: 'رواية ورش' }))],
    });
    qsa('.reciter-head', root)[0].click();
    await flush();
    // No chip rather than a chip of nothing: the full name is already the row's
    // own label, so the style word is a shortcut and not the label.
    expect(qs('.riwaya-name', root).textContent).toBe('رواية ورش');
    expect(qsa('.chip', root)).toHaveLength(0);
  });

  it('matches a reciter on a riwaya its name does not contain', () => {
    const { root } = build({ query: 'ورش' });
    expect(qsa('.reciter', root)).toHaveLength(0);
  });

  it('normalizes both sides of the comparison', () => {
    const { root } = build({ query: 'احمد' });
    expect(qsa('.reciter-name', root).map((n) => n.textContent)).toEqual(['أحمد العكش']);
  });

  it('matches a reciter whose riwaya contains the query', () => {
    const { root } = build({
      reciters: [reciter(1, 'قارئ', moshaf(11, { name: 'رواية ورش عن نافع' }))],
      query: 'ورش',
    });
    expect(qsa('.reciter', root)).toHaveLength(1);
  });

  it('distinguishes "no results" from "still loading"', () => {
    expect(qs('.empty', build({ query: 'زززز' }).root).textContent).toBe('لا نتائج مطابقة');
    expect(qs('.empty', build({ reciters: [] }).root).textContent).toBe('جارٍ تحميل القرّاء…');
    expect(qs('.reciter', build().root)).toBeTruthy();
  });

  it('rebuilds only for the keys it draws', async () => {
    const { root, store } = build();
    const first = qs('.reciter', root);
    store.setState({ offline: true });
    await flush();
    expect(qs('.reciter', root)).toBe(first);
    store.setState({ playback: null });
    await flush();
    expect(qs('.reciter', root)).toBe(first);
    store.setState({ reciters: [...RECITERS] });
    await flush();
    expect(qs('.reciter', root)).not.toBe(first);
    store.setState({ selectedMoshafId: 11 });
    await flush();
    expect(qs('.reciter', root).classList.contains('is-selected')).toBe(true);
    store.setState({ query: 'احمد' });
    await flush();
    expect(qsa('.reciter', root)).toHaveLength(1);
  });

  it('reveals the expanded reader on request, after the re-render', async () => {
    const { root, store, view } = build();
    store.setState({ expandedReciterId: 3 });
    await flush();
    // Spied on the OPENED card only, so a reveal that scrolled the first card in
    // the grid, or nothing at all, fails.
    const spy = vi.fn();
    qs('.reciter.is-open', root).scrollIntoView = spy;
    view.reveal();
    await flush();
    expect(spy).toHaveBeenCalledWith({ block: 'center' });
  });
});

// ---------------------------------------------------------------------------
// surahs
// ---------------------------------------------------------------------------

describe('createSurahsView', () => {
  const build = (over = {}) => {
    const root = document.createElement('section');
    document.body.replaceChildren(root);
    const store = storeWith({
      suwarById: new Map(SUWAR.map((s) => [s.id, s])),
      selectedMoshafId: 11,
      selectedMoshaf: { ...moshaf(11), reciterId: 1, reciterName: 'أحمد العكش' },
      ...over,
    });
    const onPlay = vi.fn();
    const onToggleFavorite = vi.fn();
    const onChangeReciter = vi.fn();
    const view = createSurahsView({ root, store, onPlay, onToggleFavorite, onChangeReciter });
    return { root, store, onPlay, onToggleFavorite, onChangeReciter, view };
  };

  it('renders only the surahs the selected reciter actually has', () => {
    // The global list is 4 entries and the moshaf ships 3: a view built from the
    // global list would offer tracks that 404 for this voice.
    const { root } = build();
    expect(qsa('.surah', root)).toHaveLength(3);
    expect(qsa('.surah-name', root).map((n) => n.textContent))
      .toEqual(['الفاتحة', 'البقرة', 'آل عمران']);
  });

  it('names the reader and the riwaya the list belongs to', () => {
    // The header is not decoration: the surah list belongs to the PAIR, so
    // without both names the grid is unattributed.
    const { root } = build({
      selectedMoshaf: { ...moshaf(32), reciterId: 3, reciterName: 'ياسر الدوسري' },
    });
    expect(qs('.surah-where-reciter', root).textContent).toBe('ياسر الدوسري');
    expect(qs('.surah-where-riwaya', root).textContent).toBe('رواية حفص عن عاصم');
    expect(qs('.surah-count', root).textContent).toBe('3 سورة');
  });

  it('counts what the chosen riwaya has, not what the reader has', () => {
    const { root } = build({
      selectedMoshaf: {
        ...moshaf(32, { surahList: [1], surahTotal: 1 }),
        reciterId: 3, reciterName: 'ياسر الدوسري',
      },
    });
    expect(qs('.surah-count', root).textContent).toBe('1 سورة');
    expect(qsa('.surah', root)).toHaveLength(1);
  });

  it('sends the user back to their own reader from the change button', async () => {
    const { root, onChangeReciter } = build({
      selectedMoshaf: { ...moshaf(32), reciterId: 3, reciterName: 'ياسر الدوسري' },
    });
    qs('.btn-ghost', root).click();
    // The reciterId, not just "go back": with 241 cards, returning to the tab
    // without the reader expanded would leave the user hunting for it.
    expect(onChangeReciter).toHaveBeenCalledWith(3);
    // Named for a screen reader, since the visible label is the bare "تغيير".
    expect(qs('.btn-ghost', root).getAttribute('aria-label'))
      .toContain('ياسر الدوسري');
  });

  it('asks for a reader AND a riwaya before it can show any surah', () => {
    const { root } = build({ selectedMoshaf: null });
    expect(qsa('.surah', root)).toHaveLength(0);
    // The prompt lives in the header, where the change button would be, so the
    // user is told which of the two steps is missing rather than just "pick one".
    expect(qs('.surah-head .empty', root).textContent)
      .toContain('اختر قارئاً ثم روايته');
    expect(qs('.btn-ghost', root)).toBe(null);
  });

  it('survives a moshaf with no surah_list', () => {
    const { root } = build({
      selectedMoshaf: { ...moshaf(11), surahList: undefined, reciterId: 1, reciterName: 'x' },
    });
    expect(qs('.empty', root)).toBeTruthy();
    // The header reads the same field, so it needs the same guard.
    expect(qs('.surah-count', root).textContent).toBe('0 سورة');
  });

  it('shows the revelation place, the surah number and the ayah count', () => {
    const { root } = build();
    const card = qs('.surah', root);
    // The API's name carries no number, so it is shown beside the place.
    expect(qs('.surah-place', card).textContent).toBe('مكية · 1');
    expect(qs('.ayah-badge', card).textContent).toBe(String(AYAH_COUNTS[1]));
    expect(qs('.ayah-label', card).textContent).toBe(`${AYAH_COUNTS[1]} آية`);
  });

  it('marks a Medinan surah from makkia, not from the inverse `type`', () => {
    const { root } = build({
      suwarById: new Map([[2, { id: 2, name: 'البقرة', isMeccan: false, pageStart: 2, pageEnd: 49 }]]),
      selectedMoshaf: { ...moshaf(11), surahList: [2], reciterId: 1, reciterName: 'x' },
    });
    expect(qs('.surah-place', root).textContent).toBe('مدنية · 2');
  });

  it('keeps the two controls in a card out of each other’s way', () => {
    const { root } = build();
    const card = qs('.surah', root);
    // A role="button" wrapper around the heart would nest one interactive
    // element inside another; a native button gets Enter and Space for free.
    expect(card.tagName).toBe('DIV');
    expect(qsa('button', card)).toHaveLength(2);
    expect(qs('.surah-open', card).tagName).toBe('BUTTON');
    expect(qs('.heart', card).tagName).toBe('BUTTON');
    expectNoNestedButtons(root);
  });

  it('plays on the open target and favorites on the heart, never both', () => {
    const { root, onPlay, onToggleFavorite } = build();
    const card = qs('.surah', root);
    qs('.heart', card).click();
    expect(onToggleFavorite).toHaveBeenCalledWith(1);
    expect(onPlay).not.toHaveBeenCalled();
    qs('.surah-open', card).click();
    expect(onPlay).toHaveBeenCalledWith(1);
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  });

  it('keys the heart by surah AND moshaf, so one surah can be two favorites', async () => {
    const fav = (surahId, moshafId) => ({ surahId, moshafId, surahName: 'الفاتحة' });
    const { root, store } = build({ favorites: [fav(1, 11)] });
    expect(qs('.heart', root).classList.contains('is-on')).toBe(true);
    expect(qs('.heart', root).getAttribute('aria-pressed')).toBe('true');

    store.setState({
      selectedMoshafId: 22,
      selectedMoshaf: { ...moshaf(22), reciterId: 2, reciterName: 'y' },
    });
    await flush();
    expect(qs('.heart', root).classList.contains('is-on')).toBe(false);

    store.setState({ favorites: [fav(1, 11), fav(1, 22)] });
    await flush();
    expect(qsa('.surah', root)).toHaveLength(3);
    expect(qsa('.heart.is-on', root)).toHaveLength(1);
    expect(favoriteKey(1, 11)).not.toBe(favoriteKey(1, 22));
  });

  it('marks the surah that is sounding, per reciter', async () => {
    const { root, store } = build();
    store.setState({
      playback: { kind: 'surah', surahId: 2, moshafId: 11, isPlaying: true },
    });
    await flush();
    expect(qsa('.surah', root).map((c) => c.classList.contains('is-playing')))
      .toEqual([false, true, false]);
    store.setState({ playback: { kind: 'surah', surahId: 2, moshafId: 99, isPlaying: true } });
    await flush();
    expect(qsa('.surah.is-playing', root)).toHaveLength(0);
  });

  it('rebuilds for the keys it draws and for nothing else', async () => {
    const { root, store } = build();
    const first = qs('.surah', root);
    store.setState({ offline: true });
    await flush();
    expect(qs('.surah', root)).toBe(first);
    store.setState({ expandedReciterId: 3 });
    await flush();
    expect(qs('.surah', root)).toBe(first);
    store.setState({ query: 'البقرة' });
    await flush();
    expect(qsa('.surah', root)).toHaveLength(1);
    store.setState({ favorites: [] });
    await flush();
    expect(qs('.surah', root)).not.toBe(first);
    store.setState({ playback: { kind: 'surah', surahId: 1, moshafId: 11 } });
    await flush();
    expect(qs('.surah', root)).not.toBe(first);
    store.setState({ suwarById: new Map(SUWAR.map((s) => [s.id, s])) });
    await flush();
    expect(qs('.surah', root)).not.toBe(first);
  });

  it('falls back to a numbered name and a blank place while suwar is in flight', () => {
    // Defaulting the place to "مدنية" would be a wrong label on every card for
    // as long as the suwar payload takes to arrive.
    const { root } = build({ suwarById: new Map() });
    expect(qs('.surah-name', root).textContent).toBe('سورة 1');
    expect(qs('.surah-place', root).textContent).toBe('');
  });

  it('distinguishes "no results" from "suwar not here yet"', () => {
    expect(qs('.grid-surahs .empty', build({ query: 'زززز' }).root).textContent).toBe('لا نتائج مطابقة');
    expect(qs('.grid-surahs .empty', build({ query: 'البقرة', suwarById: new Map() }).root).textContent)
      .toBe('جارٍ التحميل…');
  });
});

// ---------------------------------------------------------------------------
// favorites
// ---------------------------------------------------------------------------

describe('createFavoritesView', () => {
  const fav = (surahId, moshafId, over = {}) => ({
    surahId, moshafId,
    surahName: surahId === 1 ? 'الفاتحة' : 'الكهف',
    reciterName: moshafId === 11 ? 'أحمد العكش' : 'محمود خليل الحصري',
    riwayaName: 'رواية حفص عن عاصم',
    server: `https://server${moshafId}.example/`,
    addedAt: 1,
    ...over,
  });

  const build = (over = {}) => {
    const root = document.createElement('section');
    document.body.replaceChildren(root);
    const store = storeWith(over);
    const onPlay = vi.fn();
    const onRemove = vi.fn();
    const onPlayAll = vi.fn();
    const onBrowse = vi.fn();
    const view = createFavoritesView({
      root, store, onPlay, onRemove, onPlayAll, onBrowse,
    });
    return { root, store, onPlay, onRemove, onPlayAll, onBrowse, view };
  };

  it('explains the empty state and offers the way into it', () => {
    const { root, onBrowse } = build();
    expect(qsa('.fav', root)).toHaveLength(0);
    expect(qs('.empty', root).textContent).toContain('لا توجد سور في المفضلة');
    qs('.btn-primary', root).click();
    expect(onBrowse).toHaveBeenCalled();
  });

  it('lists entries ordered for playback, naming the reciter and the riwaya', () => {
    // The same surah under two reciters is a supported shape, so the moshaf id
    // has to break the tie or the order falls to sort stability.
    const { root } = build({ favorites: [fav(18, 11), fav(1, 22), fav(1, 11)] });
    expect(qsa('.fav', root)).toHaveLength(3);
    expect(qs('.fav-count', root).textContent).toBe('3 سورة');
    expect(qs('.reciter-meta', root).textContent)
      .toBe('أحمد العكش · رواية حفص عن عاصم');
  });

  it('plays and removes through separate controls', () => {
    const { root, onPlay, onRemove, onPlayAll } = build({ favorites: [fav(1, 11)] });
    qs('.fav .heart', root).click();
    expect(onRemove).toHaveBeenCalledWith(fav(1, 11));
    expect(onPlay).not.toHaveBeenCalled();
    qs('.fav-open', root).click();
    expect(onPlay).toHaveBeenCalledWith(fav(1, 11));
    qs('.btn-primary', root).click();
    expect(onPlayAll).toHaveBeenCalled();
  });

  it('never nests one button inside another', () => {
    const { root } = build({ favorites: [fav(1, 11), fav(18, 22)] });
    expectNoNestedButtons(root);
    expect(qs('.fav').tagName).toBe('DIV');
  });

  it('marks the entry that is sounding', async () => {
    const { root, store } = build({ favorites: [fav(1, 11), fav(1, 22)] });
    store.setState({ playback: { kind: 'surah', surahId: 1, moshafId: 22, isPlaying: true } });
    await flush();
    expect(qsa('.fav.is-playing', root)).toHaveLength(1);
    expect(qsa('.fav', root)[1].classList.contains('is-playing')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// radio
// ---------------------------------------------------------------------------

describe('createRadioView', () => {
  const build = (over = {}) => {
    const root = document.createElement('section');
    document.body.replaceChildren(root);
    const store = storeWith({ radios: RADIOS, ...over });
    const onPlay = vi.fn();
    const view = createRadioView({ root, store, onPlay });
    return { root, store, onPlay, view };
  };

  it('renders a row per station', () => {
    const { root } = build();
    expect(qsa('.row', root)).toHaveLength(2);
    expect(qs('.row-name', root).textContent).toBe(RADIOS[0].name);
    expect(qsa('.row', root)[0].tagName).toBe('BUTTON');
  });

  it('marks the station that is playing, matched on url', async () => {
    const { root, store, onPlay } = build();
    store.setState({ playback: { kind: 'radio', url: RADIOS[1].url, isPlaying: true } });
    await flush();
    expect(qsa('.row.is-playing', root)).toHaveLength(1);
    expect(qs('.row.is-playing .row-name', root).textContent).toBe(RADIOS[1].name);
    qsa('.row', root)[0].click();
    expect(onPlay).toHaveBeenCalledWith(RADIOS[0]);
  });

  it('distinguishes "no results" from "still loading"', () => {
    expect(qs('.empty', build({ query: 'زززز' }).root).textContent).toBe('لا نتائج مطابقة');
    expect(qs('.empty', build({ radios: [] }).root).textContent).toBe('جارٍ تحميل القنوات…');
  });

  it('rebuilds for playback, which it draws, and not for keys it does not', async () => {
    // Node identity is the assertion, not the text: the rows would read exactly
    // the same either way, so only the replacement of the nodes themselves
    // reveals a render that should or should not have happened.
    const { root, store } = build();
    const first = qs('.row', root);
    store.setState({ offline: true });
    await flush();
    expect(qs('.row', root)).toBe(first);
    store.setState({ favorites: [] });
    await flush();
    expect(qs('.row', root)).toBe(first);
    // playback IS drawn here — it is what marks the sounding station — so a gate
    // that dropped it would leave a stale dot on the row that is actually on air.
    store.setState({ playback: { kind: 'radio', url: RADIOS[1].url, isPlaying: true } });
    await flush();
    expect(qs('.row', root)).not.toBe(first);
    expect(qs('.row.is-playing', root)).not.toBe(null);
    expect(qs('.row.is-playing .row-name', root).textContent).toBe(RADIOS[1].name);
    const playing = qs('.row', root);
    // A surah's playback changes no station's state, but it is still the same
    // key, so the view cannot tell them apart and must repaint.
    store.setState({ playback: { kind: 'surah', surahId: 1, moshafId: 11 } });
    await flush();
    expect(qs('.row.is-playing', root)).toBe(null);
    store.setState({ query: 'إذاعة' });
    await flush();
    expect(qs('.row', root)).not.toBe(playing);
  });

  it('never nests one button inside another', () => {
    expectNoNestedButtons(build().root);
  });
});

// ---------------------------------------------------------------------------
// main.js — the wiring
// ---------------------------------------------------------------------------

const cacheOf = (data) => ({ at: Date.now(), data });

async function boot({ keepStorage = false } = {}) {
  vi.resetModules();
  mountShellDom();
  if (!keepStorage) localStorage.clear();
  const mod = await import('../src/main.js');
  await flush();
  return mod.app;
}

/** Boots, then takes the two real taps that reach a surah list. */
async function bootWithReciter(options) {
  const app = await boot();
  await chooseMoshaf(options);
  return app;
}

describe('app wiring', () => {
  let app = null;

  beforeEach(() => {
    api.reciters = RECITERS;
    api.suwar = SUWAR;
    api.radios = RADIOS;
    api.riwayat = [{ id: 1, name: 'حفص' }];
    api.fresh = null;
    api.gate = null;
    api.open = null;
    api.failWith = null;
    api.signals = [];
  });

  afterEach(() => {
    // The player owns a 250ms ticker; leaving one per test running would keep
    // the worker's event loop alive and hide real leaks.
    if (app) app.player.destroy();
    app = null;
  });

  it('paints the reciters, surahs, favorites and radio views from one fetch', async () => {
    app = await boot();
    expect(qsa('#view-reciters .reciter')).toHaveLength(3);
    expect(qs('#view-reciters .reciter-name').textContent).toBe('أحمد العكش');
    expect(qsa('#view-radio .row')).toHaveLength(2);
    expect(api.signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

  it('renders from cache before the network answers, and never blocks on it', async () => {
    holdRequests();
    localStorage.setItem('quran.cache.v2', JSON.stringify({
      reciters: cacheOf([reciter(9, 'قارئ محفوظ', moshaf(99))]),
      suwar: cacheOf(SUWAR),
    }));
    app = await boot({ keepStorage: true });

    expect(qsa('#view-reciters .reciter-name').map((n) => n.textContent)).toEqual(['قارئ محفوظ']);
    expect(app.store.getState().reciters).toHaveLength(1);
  });

  it('resolves a saved reciter from the cache, with no network at all', async () => {
    holdRequests();
    localStorage.setItem('quran.state.v2', JSON.stringify({ selectedMoshafId: 99 }));
    localStorage.setItem('quran.cache.v2', JSON.stringify({
      reciters: cacheOf([reciter(9, 'قارئ محفوظ', moshaf(99))]),
      suwar: cacheOf(SUWAR),
    }));
    app = await boot({ keepStorage: true });
    expect(app.store.getState().selectedMoshaf.reciterName).toBe('قارئ محفوظ');
    expect(qsa('#view-surahs .surah')).toHaveLength(3);
  });

  it('clears a saved selection the refresh proves is gone', async () => {
    const open = holdRequests();
    localStorage.setItem('quran.state.v2', JSON.stringify({ selectedMoshafId: 99 }));
    localStorage.setItem('quran.cache.v2', JSON.stringify({
      reciters: cacheOf([reciter(9, 'قارئ محفوظ', moshaf(99))]),
      suwar: cacheOf(SUWAR),
    }));
    app = await boot({ keepStorage: true });
    expect(app.store.getState().selectedMoshaf.id).toBe(99);

    // The fresh payload no longer carries moshaf 99. The index is rebuilt, so
    // the selection resolves to nothing instead of pointing at a moshaf that
    // the API no longer serves.
    open();
    await flush();
    expect(app.store.getState().selectedMoshaf).toBe(null);
    expect(qs('#view-surahs .empty').textContent).toContain('اختر قارئاً');
  });

  it('falls back to the first tab when the stored tab name is not one of the four', async () => {
    localStorage.setItem('quran.state.v2', JSON.stringify({ activeTab: 'nope', theme: 'neon' }));
    app = await boot();
    expect(app.store.getState().activeTab).toBe('reciters');
    expect(app.store.getState().theme).toBe('auto');
    expect(THEMES).toContain(app.store.getState().theme);
  });

  it('survives a stored state blob that is not an object', async () => {
    localStorage.setItem('quran.state.v2', JSON.stringify({ favorites: 'not-an-array', repeat: 'sideways' }));
    app = await boot();
    expect(app.store.getState().favorites).toEqual([]);
    expect(app.store.getState().repeat).toBe('off');
  });

  it('selects a reciter, switches to its surahs and plays one', async () => {
    app = await boot();
    await chooseMoshaf();
    expect(app.store.getState().activeTab).toBe('surahs');
    expect(app.store.getState().selectedMoshafId).toBe(11);
    expect(qs('#view-reciters').hidden).toBe(true);

    qs('#view-surahs .surah-open').click();
    await flush();
    const p = app.store.getState().playback;
    expect(p).toMatchObject({ kind: 'surah', surahId: 1, moshafId: 11, isPlaying: true, seekable: true });
    expect(p.title).toBe('الفاتحة');
    expect(p.url).toBe('https://server11.example/001.mp3');
    expect(app.engine.element.getAttribute('src')).toBe('https://server11.example/001.mp3');
  });

  it('opens only the tapped riwaya’s surahs, never the reader’s first', async () => {
    // The defect this whole flow exists to prevent: one reader, two riwayas, four
    // surahs under the first and one under the second. Auto-picking moshaf[0]
    // would have shown the four and labelled them as the second's.
    app = await boot();
    qsa('#view-reciters .reciter-head')[2].click();
    await flush();
    expect(qsa('.riwaya')).toHaveLength(2);

    qsa('.riwaya')[1].click();
    await flush();
    const s = app.store.getState();
    expect(s.selectedMoshafId).toBe(32);
    expect(s.selectedMoshaf.reciterName).toBe('ياسر الدوسري');
    expect(s.selectedMoshaf.reciterId).toBe(3);
    expect(qsa('#view-surahs .surah')).toHaveLength(1);
    expect(qs('#view-surahs .surah-name').textContent).toBe('الفاتحة');
    expect(qs('#view-surahs .surah-where-riwaya').textContent).toBe('رواية حفص عن عاصم مجود');
    expect(JSON.parse(localStorage.getItem('quran.state.v2')).selectedMoshafId).toBe(32);
  });

  it('switches between the same reader’s two riwayas without re-picking the reader', async () => {
    app = await boot();
    await chooseMoshaf({ index: 2, riwaya: 0 });
    expect(qsa('#view-surahs .surah')).toHaveLength(4);

    qs('#view-surahs .btn-ghost').click();
    await flush();
    expect(app.store.getState().activeTab).toBe('reciters');
    // Back on the readers tab with that same reader already open on its riwayas.
    expect(app.store.getState().expandedReciterId).toBe(3);
    expect(qs('.reciter.is-open .reciter-name').textContent).toBe('ياسر الدوسري');
    expect(qsa('.riwaya')).toHaveLength(2);

    qsa('.riwaya')[1].click();
    await flush();
    expect(app.store.getState().selectedMoshafId).toBe(32);
    expect(qsa('#view-surahs .surah')).toHaveLength(1);
  });

  it('remembers the expanded reader across a reload', async () => {
    app = await boot();
    qsa('#view-reciters .reciter-head')[2].click();
    await flush();
    expect(JSON.parse(localStorage.getItem('quran.state.v2')).expandedReciterId).toBe(3);
    app.player.destroy();
    app = null;

    app = await boot({ keepStorage: true });
    expect(app.store.getState().expandedReciterId).toBe(3);
    expect(qs('.reciter.is-open .reciter-name').textContent).toBe('ياسر الدوسري');
  });

  it('never nests one button inside another, in any view, in any state', async () => {
    // The whole document, not one view: every card in this app pairs a tappable
    // target with a second control (a heart, a riwaya), which is exactly the shape
    // that goes wrong when the wrapper is a button. Checked with a reader open,
    // because that is the only state that adds a third.
    app = await boot();
    await chooseMoshaf({ index: 2, riwaya: 0 });
    qs('#view-surahs .surah .heart').click();
    await flush();
    qs('.tab[data-tab="favorites"]').click();
    qs('.tab[data-tab="radio"]').click();
    await flush();
    expect(qsa('.fav')).toHaveLength(1);
    expect(qsa('.riwaya')).toHaveLength(2);
    expectNoNestedButtons(document.body);
    // Sanity: the walk is looking at something, so an empty pass cannot pass.
    expect(qsa('button', document.body).length).toBeGreaterThan(10);
  });

  it('keeps exactly one audio element through every kind of playback', async () => {
    app = await boot();
    expect(qsa('audio')).toHaveLength(1);
    await chooseMoshaf();
    for (const card of qsa('#view-surahs .surah-open')) {
      card.click();
      await flush();
    }
    app.playRadio(RADIOS[0]);
    await flush();
    app.advance();
    await flush();
    expect(qsa('audio')).toHaveLength(1);
  });

  it('reports a surah the selected reciter does not have, and stops the audio', async () => {
    app = await bootWithReciter();
    qs('#view-surahs .surah-open').click();
    await flush();
    expect(app.store.getState().playback.error).toBe(null);

    // 18 is in the global list but not in moshaf 11's own surah_list.
    expect(() => app.playSurah(18)).not.toThrow();
    const p = app.store.getState().playback;
    expect(p.error).toBe('هذه السورة غير متوفرة لهذا القارئ');
    expect(p.isPlaying).toBe(false);
    expect(p.title).toBe('الكهف');
    expect(app.engine.element.paused).toBe(true);
  });

  it('advances to the next surah, and stops at the end of the moshaf', async () => {
    app = await bootWithReciter();
    qs('#view-surahs .surah-open').click();
    await flush();

    app.advance();
    await flush();
    expect(app.store.getState().playback.surahId).toBe(2);
    app.advance();
    await flush();
    expect(app.store.getState().playback.surahId).toBe(3);
    app.advance();
    await flush();
    expect(app.store.getState().playback.isPlaying).toBe(false);
    expect(app.store.getState().playback.surahId).toBe(3);
  });

  it('repeats the current surah rather than advancing when repeat is one', async () => {
    app = await bootWithReciter();
    qs('#view-surahs .surah-open').click();
    await flush();
    app.store.setState({ repeat: 'one' });
    app.advance();
    await flush();
    expect(app.store.getState().playback.surahId).toBe(1);
  });

  it('keeps the queue where it was when the background refresh lands mid-playback', async () => {
    // The refresh runs on every cold start with a cache, and resolveMoshaf()
    // rebuilds the playlist. If it left the cursor at 0, "next" would jump back
    // to the first surah in the middle of a listening session.
    const open = holdRequests();
    localStorage.setItem('quran.cache.v2', JSON.stringify({
      reciters: cacheOf(RECITERS),
      suwar: cacheOf(SUWAR),
    }));
    app = await boot({ keepStorage: true });
    await chooseMoshaf();
    qs('#view-surahs .surah-open').click();
    await flush();
    expect(app.store.getState().playback.surahId).toBe(1);

    open();
    await flush();
    expect(app.store.getState().reciters).toBe(RECITERS);

    app.advance();
    await flush();
    // Surah 2, not surah 1 again: the cursor moved with the refresh instead of
    // being reset by it.
    expect(app.store.getState().playback.surahId).toBe(2);
    app.previous();
    await flush();
    expect(app.store.getState().playback.surahId).toBe(1);
  });

  it('plays a radio station as a non-seekable stream and hides the seek row', async () => {
    app = await boot();
    qs('#view-radio .row').click();
    await flush();
    const p = app.store.getState().playback;
    expect(p).toMatchObject({ kind: 'radio', seekable: false, isPlaying: true });
    // The engine's own seek guard reads this off the item it holds, so a radio
    // stream arriving without it keeps a progress bar that cannot move.
    expect(app.engine.getCurrent().seekable).toBe(false);
    expect(qs('#player .pl-seek').hidden).toBe(true);
    expect(qs('#player .pl-back').hidden).toBe(true);
    expect(qs('#player .pl-fwd').hidden).toBe(true);
  });

  it('plays the surah, not a station that happens to share its number', async () => {
    // The queue is one flat list, and a radio station's entry carries its own id
    // in the `surahId` slot purely to place the cursor. Station ids and surah ids
    // share a number space, so a lookup by surah id alone finds the station.
    // Its entry has no `url` at all, so playing it hands the engine an undefined
    // src and the app goes silent while the player claims a track is playing.
    app = await bootWithReciter();
    qs('#view-radio .row').click();
    await flush();
    expect(app.store.getState().playback.url).toBe(RADIOS[0].url);

    app.playSurah(1);
    await flush();
    const p = app.store.getState().playback;
    expect(p).toMatchObject({ kind: 'surah', surahId: 1, moshafId: 11 });
    expect(p.url).toBe('https://server11.example/001.mp3');
    expect(app.engine.element.getAttribute('src')).toBe('https://server11.example/001.mp3');
  });

  it('does not play another reciter’s favorite while in this reciter’s surah view', async () => {
    // Same collision, from the other direction: play-all builds a queue of
    // favorites that cross reciters, and a favorite of surah 1 under moshaf 22
    // occupies the same slot as this moshaf's own surah 1. Matching on the id
    // alone would play moshaf 22's file while labelling it as moshaf 11.
    app = await bootWithReciter();
    app.toggleSurah(1, 22);
    await flush();
    app.playAllFavorites();
    await flush();
    expect(app.store.getState().playback.url).toBe('https://server22.example/001.mp3');

    app.playSurah(1);
    await flush();
    const p = app.store.getState().playback;
    expect(p.moshafId).toBe(11);
    expect(p.reciterName).toBe('أحمد العكش');
    expect(p.url).toBe('https://server11.example/001.mp3');
  });

  it('leaves the station queue alone when the background refresh lands mid-radio', async () => {
    // resolveMoshaf() rebuilds the playlist on every cold start with a cache.
    // Doing that while a station is sounding would swap the station list out from
    // under next/prev, and the next press would drop into an unrelated recitation.
    const open = holdRequests();
    localStorage.setItem('quran.cache.v2', JSON.stringify({
      reciters: cacheOf(RECITERS),
      suwar: cacheOf(SUWAR),
      // Stations from cache too, so the radio view is populated before the
      // refresh this test is about lands.
      radios: cacheOf(RADIOS),
    }));
    app = await boot({ keepStorage: true });
    await chooseMoshaf();
    qs('#view-radio .row').click();
    await flush();
    expect(app.store.getState().playback.kind).toBe('radio');

    open();
    await flush();
    expect(app.store.getState().reciters).toBe(RECITERS);

    app.advance();
    await flush();
    expect(app.store.getState().playback.kind).toBe('radio');
    expect(app.store.getState().playback.url).toBe(RADIOS[1].url);
  });

  it('walks between stations with prev/next instead of into a surah', async () => {
    // The player keeps prev/next in radio mode, so the queue behind them has to
    // be the station list.
    app = await boot();
    qs('#view-radio .row').click();
    await flush();
    expect(app.store.getState().playback.url).toBe(RADIOS[0].url);
    app.advance();
    await flush();
    expect(app.store.getState().playback.url).toBe(RADIOS[1].url);
    expect(app.store.getState().playback.kind).toBe('radio');
    app.previous();
    await flush();
    expect(app.store.getState().playback.url).toBe(RADIOS[0].url);
  });

  it('favorites a surah per reciter and repaints the heart', async () => {
    app = await boot();
    await chooseMoshaf();
    const heart = () => qs('#view-surahs .surah .heart');

    expect(heart().classList.contains('is-on')).toBe(false);
    heart().click();
    await flush();
    expect(heart().classList.contains('is-on')).toBe(true);
    expect(heart().getAttribute('aria-pressed')).toBe('true');
    const saved = JSON.parse(localStorage.getItem('quran.state.v2'));
    expect(saved.favorites).toHaveLength(1);
    expect(saved.favorites[0]).toMatchObject({
      surahId: 1, moshafId: 11, server: 'https://server11.example/',
    });

    // The same surah under the other reciter is a different favorite, and its
    // heart must not be lit.
    await chooseMoshaf({ index: 1 });
    expect(app.store.getState().selectedMoshafId).toBe(22);
    expect(heart().classList.contains('is-on')).toBe(false);
    heart().click();
    await flush();
    expect(app.store.getState().favorites).toHaveLength(2);
    expect(qsa('#view-favorites .fav')).toHaveLength(2);
  });

  it('rebuilds the moshaf index from the fresh payload, carrying reciterId', async () => {
    // A reader chosen before the reciters payload resolves only works if the
    // index is rebuilt when the payload lands, and the surah header and its change
    // button only work if reciterId rides along with the resolved moshaf.
    const open = holdRequests();
    localStorage.setItem('quran.cache.v2', JSON.stringify({
      reciters: cacheOf([reciter(9, 'قارئ محفوظ', moshaf(99))]),
      suwar: cacheOf(SUWAR),
    }));
    app = await boot({ keepStorage: true });
    expect(app.moshafOf(11)).toBe(null);

    open();
    await flush();
    expect(app.moshafOf(11)).toMatchObject({ reciterId: 1, reciterName: 'أحمد العكش' });
    expect(app.moshafOf(99)).toBe(null);
    // And the path that depends on it: pick a riwaya, then change it from the
    // surah header.
    await chooseMoshaf({ index: 2, riwaya: 1 });
    qs('#view-surahs .btn-ghost').click();
    await flush();
    expect(app.store.getState().expandedReciterId).toBe(3);
    expect(qs('.reciter.is-open .reciter-name').textContent).toBe('ياسر الدوسري');
  });

  it('hands setState a new favorites array so the change is announced', async () => {
    // setState compares with Object.is. An in-place mutation would hand it the
    // array it already holds, every view would skip the re-render, and the heart
    // would sit in its old state until some unrelated change woke them.
    app = await bootWithReciter();
    const before = app.store.getState().favorites;
    app.toggleSurah(1, 11);
    await flush();
    expect(app.store.getState().favorites).not.toBe(before);
    expect(app.store.getState().favorites).toHaveLength(1);
    expect(qs('#view-surahs .surah .heart').classList.contains('is-on')).toBe(true);
  });

  it('un-favorites through the same key rather than through a second path', async () => {
    app = await bootWithReciter();
    app.toggleSurah(1, 11);
    await flush();
    app.toggleSurah(1, 11);
    await flush();
    expect(app.store.getState().favorites).toEqual([]);
    expect(qs('#view-surahs .surah .heart').classList.contains('is-on')).toBe(false);
    expect(JSON.parse(localStorage.getItem('quran.state.v2')).favorites).toEqual([]);
  });

  it('shows the playing surah’s favorite state in the player', async () => {
    app = await bootWithReciter();
    qs('#view-surahs .surah-open').click();
    await flush();
    expect(qs('#player .pl-heart').getAttribute('aria-pressed')).toBe('false');
    app.toggleCurrentFavorite();
    await flush();
    expect(app.store.getState().playback.isFavorite).toBe(true);
    expect(qs('#player .pl-heart').getAttribute('aria-pressed')).toBe('true');
  });

  it('plays a saved favorite with its own reciter, not the selected one', async () => {
    app = await bootWithReciter();
    app.toggleSurah(1, 22);
    await flush();
    qs('#view-surahs .surah-open').click();
    await flush();

    app.playFavorite(app.store.getState().favorites[0]);
    await flush();
    const p = app.store.getState().playback;
    expect(p).toMatchObject({ surahId: 1, moshafId: 22, reciterName: 'محمود خليل الحصري' });
    expect(p.url).toBe('https://server22.example/001.mp3');
    expect(app.store.getState().selectedMoshafId).toBe(22);
  });

  it('refuses a favorite whose reciter is gone, and says so', async () => {
    app = await bootWithReciter();
    app.toggleSurah(1, 404);
    await flush();
    app.playFavorite(app.store.getState().favorites[0]);
    expect(qs('#toast').hidden).toBe(false);
    expect(qs('#toast').textContent).toBe('القارئ لم يعد متوفراً');
    expect(app.store.getState().playback).toBe(null);
  });

  it('plays favorites across reciters in playback order, one URL each', async () => {
    app = await bootWithReciter();
    app.toggleSurah(18, 11);
    app.toggleSurah(1, 22);
    app.toggleSurah(1, 11);
    await flush();

    app.playAllFavorites();
    await flush();
    let p = app.store.getState().playback;
    expect([p.surahId, p.moshafId, p.url]).toEqual([1, 11, 'https://server11.example/001.mp3']);
    expect(p.reciterName).toBe('أحمد العكش');

    app.advance();
    await flush();
    p = app.store.getState().playback;
    expect([p.surahId, p.moshafId, p.url]).toEqual([1, 22, 'https://server22.example/001.mp3']);
    expect(p.reciterName).toBe('محمود خليل الحصري');

    app.advance();
    await flush();
    p = app.store.getState().playback;
    // 18 is not in moshaf 11's own list, so this one plays from the saved URL
    // rather than being skipped: the favorite is still the user's request.
    expect(p.url).toBe('https://server11.example/018.mp3');
  });

  it('skips a favorite with no usable server instead of queueing a relative url', async () => {
    app = await boot();
    app.store.setState({
      favorites: [{
        surahId: 1, moshafId: 404, surahName: 'الفاتحة',
        reciterName: 'مgone', riwayaName: '', server: '', addedAt: 1,
      }],
    });
    await flush();
    app.playAllFavorites();
    expect(app.store.getState().playback).toBe(null);
    expect(qs('#toast').hidden).toBe(false);
  });

  it('filters every view from the one search box', async () => {
    app = await bootWithReciter();
    const input = qs('#search');
    input.value = 'الكهف';
    input.dispatchEvent(new window.Event('input'));
    await new Promise((r) => setTimeout(r, 200));

    expect(qsa('#view-radio .row')).toHaveLength(0);
    // 18 is outside moshaf 11's own surah_list, so the surah view cannot reach
    // it no matter what is typed.
    expect(qs('#view-surahs .empty').textContent).toBe('لا نتائج مطابقة');
  });

  it('publishes nothing once the page is going away', async () => {
    // A response that lands after pagehide would write a cache entry over
    // whatever the next load reads, and paint into a document nobody sees.
    const open = holdRequests();
    app = await boot();
    expect(app.store.getState().reciters).toEqual([]);

    window.dispatchEvent(new window.Event('pagehide'));
    open();
    await flush();

    expect(app.store.getState().reciters).toEqual([]);
    expect(localStorage.getItem('quran.cache.v2')).toBeNull();
    expect(qs('#banner').hidden).toBe(true);
  });

  it('does not report an abort as a failed refresh', async () => {
    holdRequests();
    api.failWith = new DOMException('Aborted', 'AbortError');
    app = await boot();

    window.dispatchEvent(new window.Event('pagehide'));
    api.open();
    await flush();

    expect(qs('#banner').hidden).toBe(true);
  });

  it('reports a failed refresh against the cache it still has', async () => {
    const open = holdRequests();
    api.failWith = new Error('انتهت مهلة الطلب');
    localStorage.setItem('quran.cache.v2', JSON.stringify({
      reciters: cacheOf([reciter(9, 'قارئ محفوظ', moshaf(99))]),
    }));
    app = await boot({ keepStorage: true });
    open();
    await flush();
    expect(qs('#banner').textContent).toBe('تعذّر التحديث — تتصفّح البيانات المحفوظة');
  });

  it('reports the API’s own message when there is no cache to fall back on', async () => {
    const open = holdRequests();
    api.failWith = new Error('الخادم غير متاح الآن');
    app = await boot();
    open();
    await flush();
    expect(qs('#banner').textContent).toBe('الخادم غير متاح الآن');
  });

  it('re-raises the offline flag through the same banner the refresh uses', async () => {
    app = await boot();
    expect(qs('#banner').hidden).toBe(true);
    window.dispatchEvent(new window.Event('offline'));
    await flush();
    expect(qs('#banner').hidden).toBe(false);
    window.dispatchEvent(new window.Event('online'));
    await flush();
    expect(qs('#banner').hidden).toBe(true);
  });

  it('keeps the search box and the store in step when tabs change', async () => {
    app = await boot();
    const input = qs('#search');
    input.value = 'احمد';
    input.dispatchEvent(new window.Event('input'));
    await new Promise((r) => setTimeout(r, 200));
    expect(qsa('#view-reciters .reciter')).toHaveLength(1);

    qs('.tab[data-tab="radio"]').click();
    await flush();
    expect(input.value).toBe('');
    expect(app.store.getState().query).toBe('');
  });
});
