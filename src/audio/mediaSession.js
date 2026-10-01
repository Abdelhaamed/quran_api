const ICON = '/quran_api/icons/icon-512.png';

/**
 * Handlers are registered at bootstrap rather than after the first play,
 * otherwise lock-screen controls are absent until audio has already started.
 * Each action is guarded independently because support varies by browser.
 */
export function createMediaSession(handlers) {
  const ms = navigator.mediaSession;
  const bound = new Map();

  const set = (action, fn) => {
    if (!ms || typeof ms.setActionHandler !== 'function') return;
    try {
      ms.setActionHandler(action, fn);
      bound.set(action, fn);
    } catch {
      /* action unsupported in this browser */
    }
  };

  set('play', handlers.onPlay);
  set('pause', handlers.onPause);
  set('stop', handlers.onStop);
  set('seekbackward', (e) => handlers.onSeekBy(-(e?.seekOffset || 10)));
  set('seekforward', (e) => handlers.onSeekBy(e?.seekOffset || 10));
  set('previoustrack', handlers.onPrev);
  set('nexttrack', handlers.onNext);

  return {
    update(item) {
      if (!ms) return;
      try {
        ms.metadata = new MediaMetadata({
          title: item.title,
          artist: item.artist || '',
          album: item.album || '',
          artwork: [
            { src: `${ICON}`, sizes: '192x192', type: 'image/png' },
            { src: `${ICON}`, sizes: '512x512', type: 'image/png' },
          ],
        });
        ms.playbackState = item.isPlaying ? 'playing' : 'paused';
      } catch {
        /* MediaMetadata unavailable */
      }
    },

    setState(isPlaying) {
      if (ms) ms.playbackState = isPlaying ? 'playing' : 'paused';
    },

    setPosition(currentTime, duration, rate = 1) {
      if (!ms?.setPositionState || !Number.isFinite(duration) || duration <= 0) return;
      try {
        ms.setPositionState({
          duration,
          position: Math.min(currentTime, duration),
          playbackRate: rate,
        });
      } catch {
        /* ignore: browsers throw when position exceeds duration mid-seek */
      }
    },

    destroy() {
      if (!ms) return;
      for (const action of bound.keys()) {
        try { ms.setActionHandler(action, null); } catch { /* ignore */ }
      }
    },
  };
}