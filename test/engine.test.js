// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEngine } from '../src/audio/engine.js';
import { createMediaSession } from '../src/audio/mediaSession.js';

const surah = (n) => ({
  surahId: n, url: `https://x/${n}.mp3`, title: `سورة ${n}`,
  kind: 'surah', seekable: true,
});

describe('engine', () => {
  let engine;
  let proto;
  let realPlay;
  let realPause;
  let realLoad;

  beforeEach(() => {
    proto = window.HTMLMediaElement.prototype;
    realPlay = proto.play;
    realPause = proto.pause;
    realLoad = proto.load;

    // happy-dom 20.14.5 DOES implement play()/pause()/load(): play() clears
    // `paused` and dispatches 'play' then 'playing'. These spies therefore
    // delegate to the real methods and only count calls. A stub that merely set
    // a flag would leave `paused === true` forever and never fire 'play', so the
    // event-order assertions below could not fail for the reason they name.
    vi.spyOn(proto, 'play').mockImplementation(function mockPlay() {
      this._playCalls = (this._playCalls || 0) + 1;
      return realPlay.call(this);
    });
    vi.spyOn(proto, 'pause').mockImplementation(function mockPause() {
      this._pauseCalls = (this._pauseCalls || 0) + 1;
      return realPause.call(this);
    });
    vi.spyOn(proto, 'load').mockImplementation(function mockLoad() {
      this._loadCalls = (this._loadCalls || 0) + 1;
      return realLoad.call(this);
    });

    engine = createEngine();
  });

  afterEach(() => { engine.destroy(); vi.restoreAllMocks(); });

  it('creates exactly one audio element and keeps it in the DOM', () => {
    expect(document.querySelectorAll('audio')).toHaveLength(1);
    expect(engine.element.isConnected).toBe(true);
    expect(document.body.contains(engine.element)).toBe(true);
  });

  it('emits track then play and does not create a new element', async () => {
    const events = [];
    engine.on('track', () => events.push('track'));
    engine.on('play', () => events.push('play'));
    await engine.play(surah(1));
    expect(events).toEqual(['track', 'play']);
    expect(document.querySelectorAll('audio')).toHaveLength(1);
  });

  // The load-bearing guarantee. It also asserts that both plays actually took
  // effect on the element, so it cannot pass while play() silently no-ops.
  it('reuses the same element when switching tracks', async () => {
    await engine.play(surah(1));
    const first = engine.element;
    await engine.play(surah(2));

    expect(engine.element).toBe(first);
    expect(first.isConnected).toBe(true);
    expect(document.querySelectorAll('audio')).toHaveLength(1);
    expect(first.src).toContain('/2.mp3');
    expect(first._playCalls).toBe(2);
    expect(first._loadCalls).toBe(2);
  });

  // A radio stream sends `Accept-Ranges: none`, so seeking it is meaningless.
  // Each half starts from a NON-zero currentTime, or a restart that leaves the
  // clock at 0 would be indistinguishable from a restart that was skipped.
  it('skips seek and restart when the item is not seekable', async () => {
    await engine.play({ ...surah(1), seekable: false, kind: 'radio' });
    engine.element.currentTime = 0;
    engine.seekBy(10);
    expect(engine.element.currentTime).toBe(0);

    engine.element.currentTime = 42;
    engine.restart();
    expect(engine.element.currentTime).toBe(42);
  });

  // The mirror of the above: when the item IS seekable, restart must rewind.
  it('rewinds to zero on restart when the item is seekable', async () => {
    await engine.play(surah(1));
    engine.element.currentTime = 42;
    engine.restart();
    expect(engine.element.currentTime).toBe(0);
  });

  it('seeks by the requested delta when seekable', async () => {
    await engine.play(surah(1));
    engine.element.currentTime = 30;
    engine.seekBy(-10);
    expect(engine.element.currentTime).toBeCloseTo(20, 1);
  });

  it('clamps a backwards seek at zero', async () => {
    await engine.play(surah(1));
    engine.element.currentTime = 5;
    engine.seekBy(-30);
    expect(engine.element.currentTime).toBe(0);
  });

  it('emits ended once for repeated ended events', () => {
    let count = 0;
    engine.on('ended', () => { count += 1; });
    engine.element.dispatchEvent(new Event('ended'));
    engine.element.dispatchEvent(new Event('ended'));
    expect(count).toBe(1);
  });

  // B1. A real browser fires `ended` and then QUEUES a `pause` task. An
  // auto-advance listener runs synchronously inside the `ended` dispatch and
  // its src=/load() resets el.ended to false, so a `pause` handler that reads
  // el.ended lets that queued pause through and reports the new track as
  // paused. Reproduced here by dispatching `pause` immediately after `ended`,
  // with el.ended forced true-and-then-reset exactly as load() would do it.
  it('suppresses the pause a browser queues right after ended', async () => {
    const pauses = [];
    engine.on('pause', () => pauses.push('pause'));

    Object.defineProperty(engine.element, 'ended', { configurable: true, value: true });
    engine.element.dispatchEvent(new Event('ended'));
    // The auto-advance: load() clears `ended` before the queued pause lands.
    Object.defineProperty(engine.element, 'ended', { configurable: true, value: false });
    engine.element.dispatchEvent(new Event('pause'));

    expect(pauses).toEqual([]);
  });

  // The complement: the flag must not swallow a genuine pause forever. The
  // setTimeout backstop clears it on the next macrotask.
  it('still emits a pause that happens after the ended backstop clears', async () => {
    const pauses = [];
    engine.on('pause', () => pauses.push('pause'));

    engine.element.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 1));
    engine.element.dispatchEvent(new Event('pause'));

    expect(pauses).toEqual(['pause']);
  });

  // A resume during the suppression window must re-enable pause reporting,
  // otherwise a subsequent real pause would be swallowed too.
  it('re-arms pause reporting when play() is called during suppression', async () => {
    const pauses = [];
    engine.on('pause', () => pauses.push('pause'));

    await engine.play(surah(1));
    engine.element.dispatchEvent(new Event('ended'));
    engine.element.dispatchEvent(new Event('pause'));
    expect(pauses).toEqual([]);

    await engine.play(surah(1));
    engine.pause();
    expect(pauses).toEqual(['pause']);
  });

  // B4. Without the re-arm, one failed URL would burn the retry budget for the
  // whole session and every later track would fail on its first error.
  it('re-arms the retry budget on each track change', () => {
    const onError = vi.fn();
    engine.on('error', onError);

    engine.play(surah(1));
    engine.element.dispatchEvent(new Event('error'));
    engine.element.dispatchEvent(new Event('error'));
    expect(onError).toHaveBeenCalledTimes(1);

    onError.mockClear();
    engine.play(surah(2));
    engine.element.dispatchEvent(new Event('error'));
    expect(onError).not.toHaveBeenCalled();
    engine.element.dispatchEvent(new Event('error'));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  // B3. play() emits loading itself, so a same-URL resume — where the browser
  // fires no loadstart — still reports loading to a subscriber.
  it('emits loading from play, including on a same-URL resume', async () => {
    const seen = [];
    engine.on('loading', (v) => seen.push(v));

    await engine.play(surah(1));
    await engine.play(surah(1));

    expect(seen.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(seen).toContain(true);
  });

  // B5. A forward delta past the end must stop at the duration, not past it.
  it('clamps a forward seek at the duration', async () => {
    await engine.play(surah(1));
    Object.defineProperty(engine.element, 'duration', { configurable: true, value: 100 });
    engine.element.currentTime = 90;
    engine.seekBy(50);
    expect(engine.element.currentTime).toBe(100);
  });

  it('resumes playback when restart is called on a paused element', async () => {
    await engine.play(surah(1));
    engine.pause();
    expect(engine.element.paused).toBe(true);

    engine.element.currentTime = 42;
    engine.restart();

    expect(engine.element.currentTime).toBe(0);
    expect(engine.element.paused).toBe(false);
  });

  // B6. happy-dom's currentTime setter throws on a non-finite value, so an
  // unguarded seekBy(NaN) throws out of the engine rather than being ignored.
  it('ignores a non-finite seek delta instead of throwing', async () => {
    await engine.play(surah(1));
    engine.element.currentTime = 30;

    expect(() => engine.seekBy(NaN)).not.toThrow();
    expect(engine.element.currentTime).toBe(30);

    expect(() => engine.seekBy(Infinity)).not.toThrow();
    expect(engine.element.currentTime).toBe(30);

    expect(() => engine.seekBy()).not.toThrow();
    expect(engine.element.currentTime).toBe(30);
  });

  it('seeks to an absolute time, clamped to the known duration', async () => {
    await engine.play(surah(1));
    engine.element.currentTime = 10;

    engine.seekTo(45);
    expect(engine.element.currentTime).toBe(45);

    expect(() => engine.seekTo(NaN)).not.toThrow();
    expect(engine.element.currentTime).toBe(45);
  });

  it('ignores an absolute seek on a non-seekable stream', async () => {
    await engine.play({ ...surah(1), seekable: false, kind: 'radio' });
    engine.element.currentTime = 0;
    engine.seekTo(60);
    expect(engine.element.currentTime).toBe(0);
  });

  it('retries a failed load once before reporting an error', () => {
    const onError = vi.fn();
    engine.on('error', onError);
    engine.element.dispatchEvent(new Event('error'));
    expect(engine.element._loadCalls).toBe(1);
    expect(onError).not.toHaveBeenCalled();
    engine.element.dispatchEvent(new Event('error'));
    expect(onError).toHaveBeenCalledOnce();
  });

  it('reports blocked playback instead of throwing', async () => {
    window.HTMLMediaElement.prototype.play.mockRejectedValueOnce(new Error('NotAllowedError'));
    const blocked = vi.fn();
    engine.on('blocked', blocked);
    await engine.play(surah(1));
    expect(blocked).toHaveBeenCalledOnce();
  });

  it('emits time from the media element clock', async () => {
    const times = [];
    engine.on('time', (t) => times.push(t));
    await engine.play(surah(1));
    engine.element.currentTime = 12;
    engine.element.dispatchEvent(new Event('timeupdate'));
    expect(times).toEqual([{ currentTime: 12, duration: 0 }]);
  });

  it('destroy removes the element and detaches listeners', async () => {
    const onTrack = vi.fn();
    engine.on('track', onTrack);
    engine.destroy();
    expect(document.querySelectorAll('audio')).toHaveLength(0);
    await engine.play(surah(1));
    expect(onTrack).not.toHaveBeenCalled();
  });

  // play() leaves the element playing, so the first toggle() must pause it and
  // the second must resume. A this-bound `this.play(current)` would throw a
  // TypeError on the second call, because a destructured `this` is undefined.
  it('toggle survives destructuring, which a this-bound call would not', async () => {
    const { toggle } = engine;
    await engine.play(surah(1));
    expect(engine.element.paused).toBe(false);
    toggle();
    expect(engine.element.paused).toBe(true);
    toggle();
    expect(engine.element.paused).toBe(false);
  });
});

// happy-dom implements neither navigator.mediaSession nor MediaMetadata, so
// this block supplies a fake that records what was registered. The contract
// under test is the registration itself, not happy-dom's media support.
describe('mediaSession', () => {
  let registered;
  let actions;

  const install = (impl = {}) => {
    registered = {};
    actions = new Map();
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        metadata: null,
        playbackState: 'none',
        // NotSupportedError, matching what the real API throws for an
        // unsupported action — a TypeError would model a different browser.
        // `...impl.extra` is spread FIRST so a future extra cannot silently
        // replace this recorder and make the assertions vacuous.
        ...impl.extra,
        setActionHandler: (action, fn) => {
          if (impl.unsupported?.includes(action)) {
            throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
          }
          actions.set(action, fn);
          registered[action] = fn;
        },
      },
    });
    vi.stubGlobal('MediaMetadata', class {
      constructor(init) { Object.assign(this, init); }
    });
  };

  const handlers = () => ({
    onPlay: vi.fn(), onPause: vi.fn(), onStop: vi.fn(),
    onSeekBy: vi.fn(), onSeekTo: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(),
  });

  beforeEach(install);
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaSession');
  });

  // The load-bearing claim: handlers exist before any audio has played.
  it('registers every lock-screen handler at bootstrap, before any play', () => {
    const h = handlers();
    createMediaSession(h);
    expect(Object.keys(registered).sort()).toEqual([
      'nexttrack', 'pause', 'play', 'previoustrack',
      'seekbackward', 'seekforward', 'seekto', 'stop',
    ]);
    expect(registered.play).toBe(h.onPlay);
    expect(registered.nexttrack).toBe(h.onNext);
    expect(registered.previoustrack).toBe(h.onPrev);
  });

  it('negates seekOffset for a backward seek and honours a custom one', () => {
    const h = handlers();
    createMediaSession(h);
    registered.seekbackward({ seekOffset: 15 });
    expect(h.onSeekBy).toHaveBeenLastCalledWith(-15);
    registered.seekbackward();
    expect(h.onSeekBy).toHaveBeenLastCalledWith(-10);
    // An explicit 0 is a real offset, not a missing one.
    registered.seekbackward({ seekOffset: 0 });
    expect(h.onSeekBy).toHaveBeenLastCalledWith(-0);
  });

  it('passes a forward seekOffset through unchanged', () => {
    const h = handlers();
    createMediaSession(h);
    registered.seekforward({ seekOffset: 5 });
    expect(h.onSeekBy).toHaveBeenCalledWith(5);
    registered.seekforward({ seekOffset: 0 });
    expect(h.onSeekBy).toHaveBeenLastCalledWith(0);
  });

  it('routes an absolute seekTo to its own handler, ignoring a missing time', () => {
    // The notification shade's seek bar sends `seekto`, never seekbackward or
    // seekforward, so without this the shade's bar is dead on arrival.
    const h = handlers();
    createMediaSession(h);
    registered.seekto({ seekToTime: 42 });
    expect(h.onSeekTo).toHaveBeenCalledWith(42);
    registered.seekto({});
    registered.seekto();
    expect(h.onSeekTo).toHaveBeenCalledTimes(1);
  });

  it('routes play, pause and stop to their own handlers', () => {
    const h = handlers();
    createMediaSession(h);
    registered.play(); registered.pause(); registered.stop();
    expect(h.onPlay).toHaveBeenCalledOnce();
    expect(h.onPause).toHaveBeenCalledOnce();
    expect(h.onStop).toHaveBeenCalledOnce();
  });

  // Registration must not abort because one action is unsupported: a browser
  // lacking nexttrack should still get play/pause.
  it('skips only the unsupported action and keeps the rest', () => {
    install({ unsupported: ['nexttrack'] });
    const h = handlers();
    expect(() => createMediaSession(h)).not.toThrow();
    expect(registered.nexttrack).toBeUndefined();
    expect(registered.play).toBe(h.onPlay);
  });

  // The artwork array is asserted in full: a missing 512 entry or a repointed
  // icon path both left the lock screen blank or low-res without failing
  // anything that only checked title and artist.
  it('publishes metadata including both artwork sizes on update', () => {
    const s = createMediaSession(handlers());
    s.update({ title: 'الفاتحة', artist: 'أبو بكر', isPlaying: true });

    expect(navigator.mediaSession.metadata.title).toBe('الفاتحة');
    expect(navigator.mediaSession.metadata.artist).toBe('أبو بكر');
    expect(navigator.mediaSession.metadata.artwork).toEqual([
      { src: '/quran_api/icons/icon-512.png', sizes: '192x192', type: 'image/png' },
      { src: '/quran_api/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ]);
    expect(navigator.mediaSession.playbackState).toBe('playing');

    s.update({ title: 'البقرة' });
    expect(navigator.mediaSession.playbackState).toBe('paused');
  });

  // B2. setState drives the lock-screen glyph, so each direction is asserted
  // rather than only the one the other tests happened to exercise.
  it('maps setState to the matching playbackState in both directions', () => {
    const s = createMediaSession(handlers());
    s.setState(true);
    expect(navigator.mediaSession.playbackState).toBe('playing');
    s.setState(false);
    expect(navigator.mediaSession.playbackState).toBe('paused');
  });

  it('clamps position to duration so a mid-seek overshoot cannot throw', () => {
    const setPositionState = vi.fn();
    install({ extra: { setPositionState } });
    const s = createMediaSession(handlers());
    s.setPosition(300, 100);
    expect(setPositionState).toHaveBeenCalledWith({
      duration: 100, position: 100, playbackRate: 1,
    });
  });

  // Chrome throws a TypeError on a negative position and the production catch
  // would swallow it, leaving the lock-screen position silently stale.
  it('clamps a negative position to zero', () => {
    const setPositionState = vi.fn();
    install({ extra: { setPositionState } });
    const s = createMediaSession(handlers());
    s.setPosition(-5, 100);
    expect(setPositionState).toHaveBeenCalledWith({
      duration: 100, position: 0, playbackRate: 1,
    });
  });

  it('skips setPosition when the duration is unknown, as for a radio stream', () => {
    const setPositionState = vi.fn();
    install({ extra: { setPositionState } });
    const s = createMediaSession(handlers());
    s.setPosition(0, NaN);
    s.setPosition(0, Infinity);
    s.setPosition(0, 0);
    expect(setPositionState).not.toHaveBeenCalled();
  });

  // The size assertion comes first: `every` on an empty Map is true, so
  // without it the test passes whenever nothing was registered at all.
  it('clears every handler it bound on destroy', () => {
    const s = createMediaSession(handlers());
    expect(actions.size).toBe(8);
    s.destroy();
    expect(actions.size).toBe(8);
    expect([...actions.values()].every((fn) => fn === null)).toBe(true);
  });

  it('degrades to no-ops when the browser has no mediaSession', () => {
    Reflect.deleteProperty(navigator, 'mediaSession');
    const s = createMediaSession(handlers());
    expect(() => { s.update({ title: 'x' }); s.setState(true); s.setPosition(1, 2); s.destroy(); }).not.toThrow();
  });
});
