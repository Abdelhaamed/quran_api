const ENDED_GUARD_MS = 400;

/**
 * Owns the single <audio> element for the whole session.
 *
 * Creating a fresh media element per track makes mobile browsers treat each
 * one as a fresh autoplay request and block it. Reusing one element preserves
 * the user's activation, so later tracks start without another tap.
 *
 * Playback is deliberately NOT routed through the Web Audio graph: the OS
 * suspends that graph's processing when the screen locks, killing playback
 * seconds later. Native element output plus MediaSession survives lock.
 * This is also why the element carries no CORS attribute: a direct
 * <audio src> needs none, and setting one only adds a failure mode.
 */
export function createEngine() {
  const el = document.createElement('audio');
  el.preload = 'auto';
  el.playsInline = true;
  el.setAttribute('aria-hidden', 'true');
  el.style.display = 'none';
  document.body.appendChild(el);

  const listeners = new Map();
  let current = null;
  let retryUsed = false;
  let endedAt = 0;
  let suppressPause = false;

  const emit = (event, detail) => {
    const set = listeners.get(event);
    if (set) for (const fn of set) fn(detail);
  };

  const setLoading = (value) => {
    if (current) current.loading = value;
    emit('loading', value);
  };

  el.addEventListener('loadstart', () => setLoading(true));
  el.addEventListener('waiting', () => setLoading(true));
  el.addEventListener('canplay', () => setLoading(false));
  el.addEventListener('playing', () => setLoading(false));

  el.addEventListener('play', () => emit('play', current));
  el.addEventListener('pause', () => {
    if (suppressPause) return;
    emit('pause', current);
  });

  el.addEventListener('timeupdate', () => {
    emit('time', { currentTime: el.currentTime, duration: el.duration || 0 });
  });

  el.addEventListener('ended', () => {
    const now = Date.now();
    if (now - endedAt < ENDED_GUARD_MS) return;
    endedAt = now;
    // Browsers fire `ended` and then QUEUE a separate `pause` task. A listener
    // that auto-advances runs synchronously inside this dispatch, and the
    // src=/load() it performs resets el.ended to false before that queued pause
    // arrives — so reading el.ended in the pause handler would let the pause
    // through and report the freshly-started track as paused. A local flag,
    // cleared by play() and by the next macrotask as a backstop, survives it.
    suppressPause = true;
    setTimeout(() => { suppressPause = false; }, 0);
    emit('ended', current);
  });

  el.addEventListener('error', () => {
    if (retryUsed) {
      setLoading(false);
      emit('error', current);
      return;
    }
    retryUsed = true;
    setLoading(true);
    el.load();
    el.play().catch(() => {
      setLoading(false);
      emit('error', current);
    });
  });

  // Declared as standalone functions rather than inline `this.play(...)`:
  // the returned object is designed to be destructured by the UI layer, and a
  // destructured `toggle` has `this === undefined` and would throw.
  async function play(item) {
    const changing = !current || current.url !== item.url;
    current = { ...item, loading: true };
    suppressPause = false;
    emit('track', current);

    if (changing) {
      // Re-arms the one-retry budget: without this, a single failed URL would
      // disable retry for the rest of the session.
      retryUsed = false;
      el.src = item.url;
      el.load();
    }

    // Emitted here rather than left to the browser's loadstart, so a same-URL
    // resume still reports loading to a subscriber.
    setLoading(true);

    try {
      await el.play();
    } catch (err) {
      setLoading(false);
      emit('blocked', { item: current, error: err });
    }
  }

  function toggle() {
    if (el.paused) {
      if (current) play(current);
    } else {
      el.pause();
    }
  }

  return {
    element: el,
    play,

    pause() { el.pause(); },

    toggle,

    seekBy(delta) {
      if (!current || current.seekable === false) return;
      // A NaN or undefined delta would reach the currentTime setter and throw
      // a TypeError on the non-finite value.
      if (!Number.isFinite(delta)) return;
      const max = Number.isFinite(el.duration) ? el.duration : Infinity;
      el.currentTime = Math.min(Math.max(el.currentTime + delta, 0), max);
    },

    // Absolute seek, driven by the notification shade's seek bar through the
    // `seekto` media action. The shade never sends seekbackward/seekforward,
    // so without this its bar is dead even though the audio is seekable.
    seekTo(time) {
      if (!current || current.seekable === false) return;
      if (!Number.isFinite(time)) return;
      const max = Number.isFinite(el.duration) ? el.duration : Infinity;
      el.currentTime = Math.min(Math.max(time, 0), max);
    },

    restart() {
      if (!current || current.seekable === false) return;
      el.currentTime = 0;
      if (el.paused) el.play().catch(() => {});
    },

    setVolume(v) { el.volume = Math.min(Math.max(v, 0), 1); },
    getVolume() { return el.volume; },
    getCurrent() { return current; },

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },

    destroy() {
      // Listeners cleared BEFORE el.pause(): pausing emits `pause`, so the
      // other order would run every registered handler during teardown.
      listeners.clear();
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
    },
  };
}
