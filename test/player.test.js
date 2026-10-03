// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPlayer, formatTime } from '../src/ui/player.js';
import { createStore } from '../src/state/store.js';
import { createEngine } from '../src/audio/engine.js';
import { h } from '../src/utils/dom.js';

const PLAYER_H = 172;

const track = (over = {}) => ({
  kind: 'surah', title: 'الفاتحة', reciterName: 'أحمد العكش', seekable: true,
  isPlaying: false, isFavorite: false, ...over,
});

const fakeEngine = () => {
  const listeners = new Map();
  return {
    element: { currentTime: 0, duration: 0, paused: true },
    toggle: vi.fn(),
    seekBy: vi.fn(),
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev)?.delete(fn);
    },
    emit(ev, detail) { for (const fn of listeners.get(ev) || []) fn(detail); },
    listeners: (ev) => listeners.get(ev)?.size ?? 0,
  };
};

const setup = (state = {}) => {
  document.body.innerHTML = '';
  const root = h('div', { class: 'pl' });
  document.body.appendChild(root);
  const engine = fakeEngine();
  const store = createStore({ playback: null, repeat: 'off', theme: 'dark', downloadsRev: 0, ...state });
  const calls = {
    onNext: vi.fn(), onPrev: vi.fn(), onToggleFavorite: vi.fn(),
    onDownload: vi.fn(), onDeleteDownload: vi.fn(),
  };

  // happy-dom has no layout, so the measured height is stubbed. The point of the
  // stub is that it is UNRELATED to `hidden`: a measurement taken while the
  // player is hidden would return the same 172px, which is exactly the bug the
  // hidden-state assertions are there to catch.
  root.getBoundingClientRect = () => ({ height: PLAYER_H });

  const player = createPlayer({ root, store, engine, ...calls });

  const space = () => document.documentElement.style.getPropertyValue('--player-space');
  const find = (sel) => root.querySelector(sel);
  return { root, engine, store, player, calls, space, find };
};

const flush = () => Promise.resolve().then(() => {});

describe('formatTime', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(59)).toBe('0:59');
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(61)).toBe('1:01');
    expect(formatTime(3599)).toBe('59:59');
    expect(formatTime(3600)).toBe('60:00');
  });

  // The boundaries where a wrong floor/ceil or an un-padded value shows up in
  // production as a flickering last digit.
  it('truncates rather than rounds, and always pads to two digits', () => {
    expect(formatTime(0.4)).toBe('0:00');
    expect(formatTime(9.99)).toBe('0:09');
    expect(formatTime(59.999)).toBe('0:59');
    expect(formatTime(119.9)).toBe('1:59');
    expect(formatTime(600)).toBe('10:00');
  });

  // A live radio stream reports an Infinity duration and a paused element can
  // report NaN. None of these may reach the user as NaN:0 or Infinity:00.
  it('returns 0:00 for every non-finite or negative input', () => {
    for (const bad of [NaN, Infinity, -Infinity, -1, -0.5, null, undefined, '12', {}, []]) {
      expect(formatTime(bad)).toBe('0:00');
    }
  });
});

describe('player visibility and reserved space', () => {
  afterEach(() => { document.documentElement.style.removeProperty('--player-space'); });

  it('stays hidden and reserves only the safe-area inset with no track', () => {
    const t = setup();
    expect(t.root.hidden).toBe(true);
    expect(t.space()).toBe('env(safe-area-inset-bottom)');
  });

  // The reservation has to follow the real height: the player's grid is taller
  // than --player-h (88px) and shrinks again in radio mode, and grows with the
  // user's font size because every --fs-* is in rem.
  it('reserves the measured height once a track is showing', () => {
    const t = setup({ playback: track() });
    expect(t.root.hidden).toBe(false);
    expect(t.space()).toBe(`${PLAYER_H}px`);
  });

  it('releases the reservation when the track goes away', async () => {
    const t = setup({ playback: track() });
    t.store.setState({ playback: null });
    await flush();
    expect(t.root.hidden).toBe(true);
    expect(t.space()).toBe('env(safe-area-inset-bottom)');
  });

  it('adds the pl class itself rather than trusting the caller', () => {
    document.body.innerHTML = '';
    const root = h('div');
    document.body.appendChild(root);
    const store = createStore({ playback: null, repeat: 'off' });
    createPlayer({ root, store, engine: fakeEngine() }).destroy();
    expect(root.classList.contains('pl')).toBe(true);
  });
});

describe('player radio mode', () => {
  // getRadios() returns a LIST of stations, the queue navigates it, and
  // mediaSession already registers previoustrack/nexttrack for radio. Hiding
  // prev/next would leave a station player with only play and pause. `repeat`
  // is not a seek control either: repeat-one applies to whatever is playing,
  // so it stays too (R24).
  const RADIO = { kind: 'radio', seekable: false };

  it('hides the seek row and both seek buttons for radio', () => {
    const t = setup({ playback: track(RADIO) });
    for (const sel of ['.pl-seek', '.pl-back', '.pl-fwd']) {
      expect(t.find(sel).hidden, sel).toBe(true);
    }
  });

  it('keeps every non-seek control available for radio', () => {
    const t = setup({ playback: track(RADIO) });
    for (const sel of ['.pl-play', '.pl-prev', '.pl-next', '.pl-repeat', '.pl-heart']) {
      expect(t.find(sel).hidden, sel).toBe(false);
    }
  });

  it('routes prev and next to the queue in radio mode', () => {
    const t = setup({ playback: track(RADIO) });
    t.find('.pl-next').click();
    t.find('.pl-prev').click();
    expect(t.calls.onNext).toHaveBeenCalledOnce();
    expect(t.calls.onPrev).toHaveBeenCalledOnce();
  });

  // Repeat is a queue mode, not a seek, so it stays live in radio mode and must
  // keep reporting its state: a visible control that never updates is worse
  // than a hidden one.
  it('keeps the repeat state in sync in radio mode', async () => {
    const t = setup({ playback: track({ ...RADIO, isPlaying: true }) });
    const repeat = t.find('.pl-repeat');
    expect(repeat.hidden).toBe(false);
    expect(repeat.getAttribute('aria-pressed')).toBe('false');
    expect(repeat.classList.contains('is-on')).toBe(false);

    repeat.click();
    await flush();
    expect(t.store.getState().repeat).toBe('one');
    expect(repeat.getAttribute('aria-pressed')).toBe('true');
    expect(repeat.classList.contains('is-on')).toBe(true);

    repeat.click();
    await flush();
    expect(t.store.getState().repeat).toBe('off');
    expect(repeat.getAttribute('aria-pressed')).toBe('false');
    expect(repeat.classList.contains('is-on')).toBe(false);
  });

  it('shows every control for a seekable surah', () => {
    const t = setup({ playback: track() });
    for (const sel of ['.pl-seek', '.pl-back', '.pl-fwd', '.pl-prev', '.pl-next', '.pl-repeat']) {
      expect(t.find(sel).hidden, sel).toBe(false);
    }
  });

  // A seek control must never be visible for an item the engine's own guard will
  // refuse to seek, whichever way the item was flagged.
  it('hides the seek controls for any unseekable item, not only for kind=radio', () => {
    const t = setup({ playback: track({ kind: 'surah', seekable: false }) });
    expect(t.find('.pl-seek').hidden).toBe(true);
    expect(t.find('.pl-fwd').hidden).toBe(true);
    expect(t.find('.pl-back').hidden).toBe(true);
  });
});

describe('player store rendering', () => {
  it('renders the track title and reciter', () => {
    const t = setup({ playback: track() });
    expect(t.find('.pl-title').textContent).toBe('الفاتحة');
    expect(t.find('.pl-sub').textContent).toBe('أحمد العكش');
  });

  it('survives a track with no title or reciter', () => {
    const t = setup({ playback: { kind: 'surah' } });
    expect(t.find('.pl-title').textContent).toBe('');
    expect(t.find('.pl-sub').textContent).toBe('');
  });

  it('flips the play glyph and its accessible name with isPlaying', async () => {
    const t = setup({ playback: track({ isPlaying: true }) });
    expect(t.find('.pl-play').getAttribute('aria-label')).toBe('إيقاف');
    expect(t.find('.pl-play .ic').dataset.icon).toBe('pause');

    t.store.setState({ playback: track({ isPlaying: false }) });
    await flush();
    expect(t.find('.pl-play').getAttribute('aria-label')).toBe('تشغيل');
    expect(t.find('.pl-play .ic').dataset.icon).toBe('play');
  });

  it('re-renders on a playback write', async () => {
    const t = setup({ playback: track() });
    t.store.setState({ playback: track({ title: 'البقرة' }) });
    await flush();
    expect(t.find('.pl-title').textContent).toBe('البقرة');
  });

  // The store announces only the keys that changed, so an unrelated write must
  // not cost a render. The spy is on setAttribute because render() rewrites the
  // play button's aria-label on every pass: a render is observable.
  it('does not re-render for a key it does not read', async () => {
    const t = setup({ playback: track() });
    const spy = vi.spyOn(t.find('.pl-play'), 'setAttribute');

    t.store.setState({ theme: 'light' });
    await flush();
    expect(spy).not.toHaveBeenCalled();

    t.store.setState({ repeat: 'one' });
    await flush();
    expect(spy).toHaveBeenCalled();
  });

  it('toggles repeat from off to one and back, reporting it to assistive tech', async () => {
    const t = setup({ playback: track() });
    const repeat = t.find('.pl-repeat');
    expect(repeat.getAttribute('aria-pressed')).toBe('false');

    repeat.click();
    expect(t.store.getState().repeat).toBe('one');
    await flush();
    expect(repeat.getAttribute('aria-pressed')).toBe('true');
    expect(repeat.classList.contains('is-on')).toBe(true);

    repeat.click();
    await flush();
    expect(t.store.getState().repeat).toBe('off');
    expect(repeat.getAttribute('aria-pressed')).toBe('false');
  });

  it('reflects isFavorite and asks to toggle it', async () => {
    const t = setup({ playback: track() });
    const heart = t.find('.pl-heart');
    expect(heart.getAttribute('aria-pressed')).toBe('false');
    expect(heart.querySelector('.ic').dataset.icon).toBe('heart');

    heart.click();
    expect(t.calls.onToggleFavorite).toHaveBeenCalledOnce();

    t.store.setState({ playback: track({ isFavorite: true }) });
    await flush();
    expect(heart.getAttribute('aria-pressed')).toBe('true');
    expect(heart.classList.contains('is-on')).toBe(true);
    expect(heart.querySelector('.ic').dataset.icon).toBe('heartOn');
  });
});

describe('player controls', () => {
  it('routes each control to its own handler', () => {
    const t = setup({ playback: track() });
    t.find('.pl-play').click();
    t.find('.pl-back').click();
    t.find('.pl-fwd').click();
    t.find('.pl-next').click();
    t.find('.pl-prev').click();

    expect(t.engine.toggle).toHaveBeenCalledOnce();
    expect(t.engine.seekBy.mock.calls).toEqual([[-10], [10]]);
    expect(t.calls.onNext).toHaveBeenCalledOnce();
    expect(t.calls.onPrev).toHaveBeenCalledOnce();
  });

  // Task 6 supplies the queue; until then a missing callback must not throw out
  // of the click handler, which would surface as an uncaught error per tap.
  it('does not throw when the queue callbacks are absent', () => {
    document.body.innerHTML = '';
    const root = h('div');
    document.body.appendChild(root);
    const store = createStore({ playback: track(), repeat: 'off' });
    createPlayer({ root, store, engine: fakeEngine() });
    expect(() => {
      root.querySelector('.pl-next').click();
      root.querySelector('.pl-prev').click();
      root.querySelector('.pl-heart').click();
    }).not.toThrow();
  });

  // Exact values, per control. A truthy check cannot tell a swapped pair apart:
  // the heart and repeat buttons carried each other's wording for one whole
  // commit and every test still passed.
  it('names every control with its own exact label', () => {
    const t = setup({ playback: track() });
    const labels = {};
    for (const b of t.root.querySelectorAll('button')) {
      labels[b.className.split(' ').pop()] = b.getAttribute('aria-label');
    }
    expect(labels).toEqual({
      'pl-heart': 'إضافة إلى المفضلة',
      'pl-dl': 'تحميل السورة للاستماع بلا إنترنت',
      'pl-play': 'تشغيل',
      'pl-prev': 'السورة السابقة',
      'pl-next': 'السورة التالية',
      'pl-back': 'تأخير 10 ثوانٍ',
      'pl-fwd': 'تقديم 10 ثوانٍ',
      'pl-repeat': 'تكرار السورة',
    });
  });

  // Icon identity per control. The mapping lives in src/ui/icons.js, and each
  // slot's data-icon is the only assertion that can catch a revert — the SVG
  // markup itself is an implementation detail of the library.
  it('puts the mirrored arrow glyph on each arrow control', () => {
    const t = setup({ playback: track() });
    const glyph = (sel) => t.find(sel).querySelector('.ic').dataset.icon;
    expect(glyph('.pl-prev')).toBe('prev');
    expect(glyph('.pl-next')).toBe('next');
    expect(glyph('.pl-back')).toBe('back');
    expect(glyph('.pl-fwd')).toBe('fwd');
    expect(glyph('.pl-play')).toBe('play');
    expect(glyph('.pl-repeat')).toBe('repeat');
    expect(glyph('.pl-heart')).toBe('heart');
  });

  it('swaps the play glyph and the heart glyph on state, keeping identity exact', async () => {
    const t = setup({ playback: track({ isFavorite: true }) });
    expect(t.find('.pl-heart .ic').dataset.icon).toBe('heartOn');
    expect(t.find('.pl-play .ic').dataset.icon).toBe('play');

    t.store.setState({ playback: track({ isPlaying: true, isFavorite: false }) });
    await flush();
    expect(t.find('.pl-play .ic').dataset.icon).toBe('pause');
    expect(t.find('.pl-play').getAttribute('aria-label')).toBe('إيقاف');
    expect(t.find('.pl-heart .ic').dataset.icon).toBe('heart');
  });

  it('keeps every glyph hidden from assistive tech', () => {
    const t = setup({ playback: track() });
    const buttons = [...t.root.querySelectorAll('button')];
    expect(buttons).toHaveLength(8);
    for (const b of buttons) {
      // The icon is an inline SVG, so the button's text content is empty and
      // the assertion is on the SVG's presence and its hiding, not on text.
      expect(b.querySelector('.ic svg'), b.className).not.toBeNull();
      expect(b.querySelector('.ic').getAttribute('aria-hidden'), b.className).toBe('true');
    }
  });
});

describe('player progress', () => {
  it('paints the clock and the bar from a time event', () => {
    const t = setup({ playback: track() });
    t.engine.emit('time', { currentTime: 30, duration: 120 });

    expect(t.find('.pl-time').textContent).toBe('0:30 / 2:00');
    expect(t.find('.pl-bar-fill').style.inlineSize).toBe('25%');
    expect(t.find('.pl-progress').getAttribute('aria-valuenow')).toBe('30');
    expect(t.find('.pl-progress').getAttribute('aria-valuemax')).toBe('120');
  });

  // A radio stream's duration is Infinity, so the percentage and both halves of
  // the label must degrade instead of rendering Infinity% or NaN.
  it('shows a zeroed bar and 0:00 for a non-finite duration', () => {
    const t = setup({ playback: track({ kind: 'radio', seekable: false }) });
    t.engine.emit('time', { currentTime: 12, duration: Infinity });
    expect(t.find('.pl-time').textContent).toBe('0:12 / 0:00');
    expect(t.find('.pl-bar-fill').style.inlineSize).toBe('0%');
  });

  it('clamps the bar at 100% when the clock overshoots the duration', () => {
    const t = setup({ playback: track() });
    t.engine.emit('time', { currentTime: 200, duration: 120 });
    expect(t.find('.pl-bar-fill').style.inlineSize).toBe('100%');
  });

  it('publishes no range at all until a duration is known', () => {
    const t = setup({ playback: track() });
    const bar = t.find('.pl-progress');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-label')).toBeTruthy();
    // A progressbar seeded with max=0 is degenerate, and it is the state every
    // fresh player and every live stream sits in.
    expect(bar.hasAttribute('aria-valuemin')).toBe(false);
    expect(bar.hasAttribute('aria-valuemax')).toBe(false);
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('drops the range again when the duration becomes unknown', () => {
    const t = setup({ playback: track() });
    t.engine.emit('time', { currentTime: 30, duration: 120 });
    const bar = t.find('.pl-progress');
    expect(bar.getAttribute('aria-valuemax')).toBe('120');

    // A new track: the previous track's range must not be left standing.
    t.engine.emit('track', {});
    t.engine.element.duration = 0;
    t.store.setState({ playback: track({ title: 'البقرة' }) });
    return flush().then(() => {
      expect(bar.hasAttribute('aria-valuemax')).toBe(false);
      expect(bar.hasAttribute('aria-valuenow')).toBe(false);
      expect(bar.hasAttribute('aria-valuemin')).toBe(false);
    });
  });
});

describe('player progress ticker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // The load-bearing reason the ticker exists: nothing fires a `time` event, and
  // the bar must still advance from the element's own clock.
  it('advances the bar on its own while audio plays', async () => {
    const t = setup({ playback: track({ isPlaying: true }) });
    t.engine.element.duration = 100;
    t.engine.element.currentTime = 10;
    t.engine.emit('play', {});
    expect(t.find('.pl-bar-fill').style.inlineSize).toBe('10%');

    t.engine.element.currentTime = 25;
    await vi.advanceTimersByTimeAsync(250);
    expect(t.find('.pl-time').textContent).toBe('0:25 / 1:40');
    expect(t.find('.pl-bar-fill').style.inlineSize).toBe('25%');
  });

  it('stops on pause and does not start before play', async () => {
    const t = setup({ playback: track({ isPlaying: true }) });
    t.engine.element.duration = 100;
    t.engine.element.currentTime = 50;

    await vi.advanceTimersByTimeAsync(1000);
    expect(t.find('.pl-bar-fill').style.inlineSize).toBe('0%');

    t.engine.emit('play', {});
    expect(t.find('.pl-bar-fill').style.inlineSize).toBe('50%');
    t.engine.emit('pause', {});
    t.engine.element.currentTime = 90;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.find('.pl-bar-fill').style.inlineSize).toBe('50%');
  });

  // A live 4Hz interval that outlives its view is a permanent CPU/battery cost
  // on the phone this app is built for.
  it('clears the interval on destroy', async () => {
    const t = setup({ playback: track({ isPlaying: true }) });
    t.engine.element.duration = 100;
    t.engine.element.currentTime = 30;
    t.engine.emit('play', {});
    expect(t.find('.pl-bar-fill').style.inlineSize).toBe('30%');

    t.player.destroy();
    t.engine.element.currentTime = 80;
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops the interval when the track goes away', async () => {
    const t = setup({ playback: track({ isPlaying: true }) });
    t.engine.emit('play', {});
    t.store.setState({ playback: null });
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('player teardown', () => {
  // All six registrations, not a sample. Checking only `time` and `play` let
  // `ended`, `pause` and `blocked` stay subscribed for a whole commit while the
  // test's name claimed otherwise: a leaked handler writes to a detached node
  // on every engine event, forever.
  it('detaches the root, the store listener and every engine listener', async () => {
    const t = setup({ playback: track() });
    const spy = vi.spyOn(t.find('.pl-play'), 'setAttribute');

    const EVENTS = ['time', 'track', 'ended', 'pause', 'blocked', 'play'];
    for (const ev of EVENTS) {
      expect(t.engine.listeners(ev), ev).toBe(1);
    }

    t.player.destroy();

    expect(t.root.isConnected).toBe(false);
    for (const ev of EVENTS) {
      expect(t.engine.listeners(ev), ev).toBe(0);
    }

    t.store.setState({ playback: track({ title: 'البقرة' }) });
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });

  // A leaked `play` handler would restart the interval after teardown, which is
  // the one leak that costs battery rather than a wasted write.
  it('leaves nothing that can restart the ticker', async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ playback: track({ isPlaying: true }) });
      t.engine.emit('play', {});
      expect(vi.getTimerCount()).toBe(1);
      t.player.destroy();
      expect(vi.getTimerCount()).toBe(0);

      t.engine.emit('play', {});
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('player with the real engine', () => {
  afterEach(() => { document.documentElement.style.removeProperty('--player-space'); });

  // The device gate proved the single-element design on hardware; this is the
  // regression guard that keeps the view from quietly reintroducing a second one.
  it('creates no audio element of its own and drives the engine it is given', async () => {
    document.body.innerHTML = '';
    const engine = createEngine();
    const root = h('div');
    document.body.appendChild(root);
    const store = createStore({ playback: track({ isPlaying: false }), repeat: 'off' });
    const player = createPlayer({ root, store, engine, onNext: vi.fn() });

    expect(document.querySelectorAll('audio')).toHaveLength(1);

    await engine.play({ ...track(), url: 'https://x/1.mp3' });
    expect(document.querySelectorAll('audio')).toHaveLength(1);
    expect(root.querySelector('.pl-play').getAttribute('aria-label')).toBe('تشغيل');

    root.querySelector('.pl-play').click();
    expect(engine.element.paused).toBe(true);
    expect(document.querySelectorAll('audio')).toHaveLength(1);

    root.querySelector('.pl-fwd').click();
    expect(engine.element.paused).toBe(true);

    player.destroy();
    engine.destroy();
    expect(document.querySelectorAll('audio')).toHaveLength(0);
  });
});

describe('h', () => {
  it('sets class and boolean attributes and skips false or null', () => {
    const el = h('input', { class: 'a b', type: 'text', required: true, disabled: false, value: null });
    expect(el.getAttribute('class')).toBe('a b');
    expect(el.type).toBe('text');
    expect(el.hasAttribute('required')).toBe(true);
    expect(el.hasAttribute('disabled')).toBe(false);
    expect(el.hasAttribute('value')).toBe(false);
  });

  // The `dataset` branch was removed from dom.js and every test still passed
  // while this test's name claimed coverage, so it is asserted directly.
  it('assigns a dataset object onto the element dataset', () => {
    const el = h('div', { dataset: { surahId: 18, reciter: 'akdr' } });
    expect(el.dataset.surahId).toBe('18');
    expect(el.dataset.reciter).toBe('akdr');
    expect(el.getAttribute('data-surah-id')).toBe('18');
    // dataset must not leak through as a literal attribute.
    expect(el.hasAttribute('dataset')).toBe(false);
  });

  it('merges dataset with other attributes', () => {
    const el = h('li', { class: 'x', dataset: { k: 'v' } });
    expect(el.getAttribute('class')).toBe('x');
    expect(el.getAttribute('data-k')).toBe('v');
  });

  // Same story for the `html` branch: nothing in the player uses it, so nothing
  // else in the suite reaches it either. Asserted through the parsed result,
  // since happy-dom decodes entities when it serialises innerHTML back.
  it('sets innerHTML from the html attribute', () => {
    const el = h('div', { html: '<span class="ic">&#10073;</span>' });
    expect(el.childElementCount).toBe(1);
    expect(el.firstElementChild.tagName).toBe('SPAN');
    expect(el.firstElementChild.className).toBe('ic');
    expect(el.textContent).toBe('❙');
  });

  it('applies html in attribute order and leaves textContent for children', () => {
    const el = h('div', { html: '<b>markup</b>' }, 'child');
    expect(el.querySelector('b').textContent).toBe('markup');
    expect(el.textContent).toBe('markupchild');
  });

  it('binds on* attributes as listeners and flattens one level of children', () => {
    const clicks = [];
    const el = h('div', { onClick: () => clicks.push(1) }, [h('b', {}, 'x'), 'y', 0, false, null]);
    el.click();
    expect(clicks).toEqual([1]);
    expect(el.textContent).toBe('xy0');
  });
});
