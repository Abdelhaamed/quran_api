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
        setActionHandler: (action, fn) => {
          if (impl.unsupported?.includes(action)) throw new TypeError('unsupported');
          actions.set(action, fn);
          registered[action] = fn;
        },
        ...impl.extra,
      },
    });
    vi.stubGlobal('MediaMetadata', class {
      constructor(init) { Object.assign(this, init); }
    });
  };

  const handlers = () => ({
    onPlay: vi.fn(), onPause: vi.fn(), onStop: vi.fn(),
    onSeekBy: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(),
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
      'seekbackward', 'seekforward', 'stop',
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
  });

  it('passes a forward seekOffset through unchanged', () => {
    const h = handlers();
    createMediaSession(h);
    registered.seekforward({ seekOffset: 5 });
    expect(h.onSeekBy).toHaveBeenCalledWith(5);
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

  it('publishes metadata and playbackState on update', () => {
    const s = createMediaSession(handlers());
    s.update({ title: 'الفاتحة', artist: 'أبو بكر', isPlaying: true });
    expect(navigator.mediaSession.metadata.title).toBe('الفاتحة');
    expect(navigator.mediaSession.metadata.artist).toBe('أبو بكر');
    expect(navigator.mediaSession.playbackState).toBe('playing');
    s.update({ title: 'البقرة' });
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

  it('skips setPosition when the duration is unknown, as for a radio stream', () => {
    const setPositionState = vi.fn();
    install({ extra: { setPositionState } });
    const s = createMediaSession(handlers());
    s.setPosition(0, NaN);
    s.setPosition(0, Infinity);
    s.setPosition(0, 0);
    expect(setPositionState).not.toHaveBeenCalled();
  });

  it('clears every handler it bound on destroy', () => {
    const s = createMediaSession(handlers());
    s.destroy();
    expect([...actions.values()].every((fn) => fn === null)).toBe(true);
  });

  it('degrades to no-ops when the browser has no mediaSession', () => {
    Reflect.deleteProperty(navigator, 'mediaSession');
    const s = createMediaSession(handlers());
    expect(() => { s.update({ title: 'x' }); s.setState(true); s.setPosition(1, 2); s.destroy(); }).not.toThrow();
  });
});
