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
    if (el.ended) return;
    emit('pause', current);
  });

  el.addEventListener('timeupdate', () => {
    emit('time', { currentTime: el.currentTime, duration: el.duration || 0 });
  });

  el.addEventListener('ended', () => {
    const now = Date.now();
    if (now - endedAt < ENDED_GUARD_MS) return;
    endedAt = now;
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
    emit('track', current);

if (changing) {
        retryUsed = false;
        el.src = item.url;
        el.load();
      }

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
      const max = Number.isFinite(el.duration) ? el.duration : Infinity;
      el.currentTime = Math.min(Math.max(el.currentTime + delta, 0), max);
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
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
      listeners.clear();
    },
  };
}
