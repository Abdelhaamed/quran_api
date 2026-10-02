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
  // `?? 10`, not `|| 10`: an explicit seekOffset of 0 is a real offset, and
  // `||` would silently turn it into 10.
  set('seekbackward', (e) => handlers.onSeekBy(-(e?.seekOffset ?? 10)));
  set('seekforward', (e) => handlers.onSeekBy(e?.seekOffset ?? 10));
  // The notification shade's seek bar sends `seekto`, never the two actions
  // above, so this is what makes dragging that bar do anything at all.
  set('seekto', (e) => {
    if (e && Number.isFinite(e.seekToTime)) handlers.onSeekTo(e.seekToTime);
  });
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
          // Both ends clamped: Chrome throws a TypeError on a negative
          // position, and the catch would swallow it, leaving the lock-screen
          // position silently stale.
          position: Math.min(Math.max(currentTime, 0), duration),
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
