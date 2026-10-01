import { h } from '../utils/dom.js';

// The engine's `time` event rides the element's `timeupdate`, whose cadence the
// browser chooses and throttles: it is not guaranteed while a page is
// backgrounded, and a stream may never fire it. Polling the element on our own
// interval makes the bar advance regardless, and is the only way to get a
// guaranteed update in this repo's test environment.
const TICK_MS = 250;

// Unicode rather than the brief's HTML entities, so the glyph is set as text and
// inherits colour like any other text. `prev` and `next` are swapped relative to
// the brief: the document is dir=rtl, so "previous" sits to the RIGHT of play
// and must be the right-pointing glyph.
const GLYPH = {
  play: '\u25B6', pause: '\u23F8', prev: '\u23ED', next: '\u23EE',
  back: '\u23EA', fwd: '\u23E9', repeat: '\u1F501', heart: '\u2661', heartOn: '\u2665',
};

// With the player hidden there is nothing to reserve for it, but the home
// indicator still overlaps the last card, so the inset stays.
const HIDDEN_RESERVE = 'env(safe-area-inset-bottom)';

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function createPlayer({
  root,
  store,
  engine,
  onNext = () => {},
  onPrev = () => {},
  onToggleFavorite = () => {},
}) {
  // The positioning, not the caller's business: the caller may pass a bare div
  // and the fixed-player CSS still has to apply.
  root.classList.add('pl');

  const icon = (name) => h('span', { class: 'ic', 'aria-hidden': 'true' }, GLYPH[name]);

  const els = {
    heart: h('button', { class: 'pl-btn pl-heart', type: 'button', 'aria-label': 'إضافة إلى المفضلة', 'aria-pressed': 'false' }, icon('heart')),
    title: h('div', { class: 'pl-title' }),
    sub: h('div', { class: 'pl-sub' }),
    time: h('span', { class: 'pl-time', dir: 'ltr' }, '0:00'),
    bar: h('div', { class: 'pl-bar-fill' }),
    play: h('button', { class: 'pl-btn pl-play', type: 'button', 'aria-label': 'تشغيل' }, icon('play')),
    prev: h('button', { class: 'pl-btn pl-prev', type: 'button', 'aria-label': 'السورة السابقة' }, icon('prev')),
    next: h('button', { class: 'pl-btn pl-next', type: 'button', 'aria-label': 'السورة التالية' }, icon('next')),
    back: h('button', { class: 'pl-btn pl-back', type: 'button', 'aria-label': 'تأخير 10 ثوانٍ' }, icon('back')),
    fwd: h('button', { class: 'pl-btn pl-fwd', type: 'button', 'aria-label': 'تقديم 10 ثوانٍ' }, icon('fwd')),
    repeat: h('button', { class: 'pl-btn pl-repeat', type: 'button', 'aria-label': 'تكرار السورة', 'aria-pressed': 'false' }, icon('repeat')),
  };

  const progress = h('div', {
    class: 'pl-progress',
    role: 'progressbar',
    'aria-label': 'موضع التشغيل',
    'aria-valuemin': '0',
    'aria-valuenow': '0',
    'aria-valuemax': '0',
  }, els.bar);

  const seekRow = h('div', { class: 'pl-seek' }, progress, els.time);
  const controls = h('div', { class: 'pl-controls' },
    els.repeat, els.prev, els.back, els.play, els.fwd, els.next);

  root.append(
    h('div', { class: 'pl-inner' },
      h('div', { class: 'pl-head' },
        h('div', { class: 'pl-names' }, els.title, els.sub),
        els.heart),
      seekRow, controls),
  );
  root.hidden = true;

  els.play.addEventListener('click', () => engine.toggle());
  els.back.addEventListener('click', () => engine.seekBy(-10));
  els.fwd.addEventListener('click', () => engine.seekBy(10));
  els.prev.addEventListener('click', () => onPrev());
  els.next.addEventListener('click', () => onNext());
  els.repeat.addEventListener('click', () => {
    const next = store.getState().repeat === 'one' ? 'off' : 'one';
    store.setState({ repeat: next });
  });
  els.heart.addEventListener('click', () => onToggleFavorite());

  const readClock = () => {
    const el = engine.element;
    return {
      currentTime: Number.isFinite(el?.currentTime) ? el.currentTime : 0,
      duration: Number.isFinite(el?.duration) && el.duration > 0 ? el.duration : 0,
    };
  };

  const paintClock = ({ currentTime, duration }) => {
    const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const now = Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
    els.time.textContent = `${formatTime(now)} / ${formatTime(total)}`;
    els.bar.style.inlineSize = `${total > 0 ? Math.min(now / total, 1) * 100 : 0}%`;
    if (total > 0) {
      progress.setAttribute('aria-valuenow', String(Math.round(now)));
      progress.setAttribute('aria-valuemax', String(Math.round(total)));
    }
  };

  const setGlyph = (btn, name) => {
    const slot = btn.firstChild;
    if (slot && slot.textContent !== GLYPH[name]) slot.textContent = GLYPH[name];
  };

  // The reserved space is measured rather than guessed at a fixed --player-h:
  // the player is a grid whose height depends on which controls are visible
  // (radio hides the seek row) and on the user's font size, so any constant in
  // the stylesheet is either too small, covering the last card, or too large,
  // leaving dead space. A hidden element measures zero, so the inset has to be
  // reserved explicitly here — the observer reports a 0x0 box for it.
  const reserve = (value) => root.ownerDocument.documentElement.style.setProperty('--player-space', value);

  const measure = () => {
    if (root.hidden) {
      reserve(HIDDEN_RESERVE);
      return;
    }
    const height = root.getBoundingClientRect().height || 0;
    reserve(`${height}px`);
  };

  let ticker = 0;
  const stopTicker = () => {
    if (!ticker) return;
    clearInterval(ticker);
    ticker = 0;
  };
  // Driven by the engine's own events rather than by the store: the engine is
  // the authority on whether audio is advancing, so the ticker cannot disagree
  // with `playback.isPlaying` while Task 6's mirror is still being wired.
  const startTicker = () => {
    if (ticker) return;
    paintClock(readClock());
    ticker = setInterval(() => paintClock(readClock()), TICK_MS);
  };

  const off = [
    engine.on('time', paintClock),
    engine.on('track', () => paintClock(readClock())),
    engine.on('ended', stopTicker),
    engine.on('pause', stopTicker),
    engine.on('blocked', stopTicker),
    engine.on('play', startTicker),
  ];

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  if (observer) observer.observe(root);

  function render() {
    const s = store.getState();
    const p = s.playback;

    if (!p || !p.kind) {
      root.hidden = true;
      measure();
      stopTicker();
      return;
    }

    root.hidden = false;

    els.title.textContent = p.title || '';
    els.sub.textContent = p.reciterName || '';

    // A radio stream answers `Accept-Ranges: none`, so the bar and every skip
    // control are hidden rather than shown as dead buttons. `seekable: false` is
    // checked too, because that is the capability the engine's own guard reads:
    // a control must never be visible for an item the engine will refuse to seek.
    const unseekable = p.kind === 'radio' || p.seekable === false;
    seekRow.hidden = unseekable;
    els.back.hidden = unseekable;
    els.fwd.hidden = unseekable;
    els.prev.hidden = unseekable;
    els.next.hidden = unseekable;
    els.repeat.hidden = unseekable;

    const playing = Boolean(p.isPlaying);
    setGlyph(els.play, playing ? 'pause' : 'play');
    els.play.setAttribute('aria-label', playing ? 'إيقاف' : 'تشغيل');

    const repeating = s.repeat === 'one';
    els.repeat.classList.toggle('is-on', repeating);
    els.repeat.setAttribute('aria-pressed', String(repeating));

    const favorite = Boolean(p.isFavorite);
    setGlyph(els.heart, favorite ? 'heartOn' : 'heart');
    els.heart.classList.toggle('is-on', favorite);
    els.heart.setAttribute('aria-pressed', String(favorite));

    paintClock(readClock());
    measure();
  }

  const unsubscribe = store.subscribe((_state, keys) => {
    if (keys.has('playback') || keys.has('repeat')) render();
  }, { immediate: true });

  function destroy() {
    stopTicker();
    for (const offOne of off) offOne();
    unsubscribe();
    if (observer) observer.disconnect();
    root.remove();
    reserve(HIDDEN_RESERVE);
  }

  return { render, destroy, root };
}
