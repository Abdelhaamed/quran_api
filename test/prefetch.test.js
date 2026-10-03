// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { preconnectServer, preloadNext, clearPreload } from '../src/audio/prefetch.js';

beforeEach(() => {
  document.head.innerHTML = '';
});

describe('preconnectServer', () => {
  it('adds preconnect and dns-prefetch for the server origin', () => {
    preconnectServer('https://server6.mp3quran.net/akdr/');
    const pre = document.getElementById('quran-preconnect');
    expect(pre?.getAttribute('rel')).toBe('preconnect');
    expect(pre?.getAttribute('href')).toBe('https://server6.mp3quran.net');
    const dns = document.getElementById('quran-preconnect-dns');
    expect(dns?.getAttribute('rel')).toBe('dns-prefetch');
  });

  it('reuses one element across reciter changes instead of piling links', () => {
    preconnectServer('https://server6.mp3quran.net/akdr/');
    preconnectServer('https://server11.mp3quran.net/husr/');
    const els = [...document.head.querySelectorAll('#quran-preconnect')];
    expect(els).toHaveLength(1);
    expect(els[0].getAttribute('href')).toBe('https://server11.mp3quran.net');
  });

  it('ignores a malformed server without throwing', () => {
    expect(() => preconnectServer('not a url')).not.toThrow();
    expect(() => preconnectServer(null)).not.toThrow();
    expect(document.getElementById('quran-preconnect')).toBeNull();
  });
});

describe('preloadNext', () => {
  it('emits a preload link for the next surah', () => {
    preloadNext('https://server6.mp3quran.net/akdr/002.mp3');
    const el = document.getElementById('quran-preload-next');
    expect(el?.getAttribute('rel')).toBe('preload');
    expect(el?.getAttribute('as')).toBe('audio');
    expect(el?.getAttribute('href')).toBe('https://server6.mp3quran.net/akdr/002.mp3');
  });

  it('updates the same link rather than adding another', () => {
    preloadNext('https://x/001.mp3');
    preloadNext('https://x/002.mp3');
    expect(document.head.querySelectorAll('#quran-preload-next')).toHaveLength(1);
    expect(document.getElementById('quran-preload-next').getAttribute('href'))
      .toBe('https://x/002.mp3');
  });

  it('does nothing without a url', () => {
    preloadNext(null);
    preloadNext('');
    expect(document.getElementById('quran-preload-next')).toBeNull();
  });

  it('clearPreload removes the hint', () => {
    preloadNext('https://x/001.mp3');
    clearPreload();
    expect(document.getElementById('quran-preload-next')).toBeNull();
  });
});
