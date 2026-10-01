import { createEngine } from './audio/engine.js';
import { createMediaSession } from './audio/mediaSession.js';

const engine = createEngine();
const session = createMediaSession({
  // getCurrent() is null before anything has played; calling play() with it
  // would throw on `item.url`.
  onPlay: () => { const c = engine.getCurrent(); if (c) engine.play(c); },
  onPause: () => engine.pause(),
  onStop: () => engine.pause(),
  onSeekBy: (d) => engine.seekBy(d),
  // Wired to nothing yet: Task 6 attaches the queue. The device gate expects
  // these lock-screen buttons to be inert, not to advance the queue.
  onNext: () => document.dispatchEvent(new CustomEvent('quran:next')),
  onPrev: () => document.dispatchEvent(new CustomEvent('quran:prev')),
});

engine.on('track', (item) => session.update({ ...item, isPlaying: !engine.element.paused }));
engine.on('play', () => session.setState(true));
engine.on('pause', () => session.setState(false));
engine.on('time', ({ currentTime, duration }) =>
  session.setPosition(currentTime, duration, engine.element.playbackRate || 1));

// TEMPORARY device probe (Task 4). Removed once the Android gate passes.
const SURAH = {
  url: 'https://server6.mp3quran.net/akdr/001.mp3',
  title: 'الفاتحة',
  artist: 'أحمد العكش',
  kind: 'surah',
  seekable: true,
};
const RADIO = {
  url: 'https://backup.qurango.net/radio/ibrahim_alakdar',
  title: 'إذاعة إبراهيم العكش',
  kind: 'radio',
  seekable: false,
};

const probe = document.createElement('div');
probe.id = 'probe';
probe.style.cssText = 'position:fixed;inset:auto 0 0 0;z-index:9999;padding:12px;display:flex;gap:8px;background:#241f1f';
for (const [label, item] of [['Surah 1', SURAH], ['Radio', RADIO]]) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.onclick = () => engine.play(item);
  probe.appendChild(btn);
}
const next = document.createElement('button');
next.textContent = 'Next surah';
next.onclick = () => engine.play({ ...SURAH, surahId: 2, url: 'https://server6.mp3quran.net/akdr/002.mp3', title: 'البقرة' });
probe.appendChild(next);
document.body.appendChild(probe);
