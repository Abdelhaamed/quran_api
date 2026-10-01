import { describe, it, expect } from 'vitest';
import { createQueue } from '../src/audio/queue.js';

const item = (id) => ({ surahId: id, url: `/x/${id}.mp3`, title: `سورة ${id}` });

describe('createQueue', () => {
  it('starts empty', () => {
    const q = createQueue();
    expect(q.size).toBe(0);
    expect(q.current).toBeNull();
  });

  it('navigates forward and backward', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(2), item(3)]);
    expect(q.current.surahId).toBe(1);
    expect(q.next().surahId).toBe(2);
    expect(q.next().surahId).toBe(3);
    expect(q.next()).toBeNull();
    expect(q.prev().surahId).toBe(2);
  });

  it('does not wrap at either end', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(2)]);
    expect(q.prev()).toBeNull();
    expect(q.index).toBe(0);
  });

  it('honours a partial surah_list from the selected moshaf', () => {
    const q = createQueue();
    q.setPlaylist([item(2), item(3)]);
    expect(q.size).toBe(2);
    expect(q.next().surahId).toBe(3);
    expect(q.next()).toBeNull();
  });

  it('resets to the start when the playlist changes', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(2)]);
    q.next();
    q.setPlaylist([item(9)]);
    expect(q.index).toBe(0);
    expect(q.current.surahId).toBe(9);
  });

  it('locates an index by surah id', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(18), item(36)]);
    expect(q.setIndexBySurah(18)).toBe(1);
    expect(q.current.surahId).toBe(18);
  });

  it('returns -1 for a surah outside the playlist', () => {
    const q = createQueue();
    q.setPlaylist([item(1)]);
    expect(q.setIndexBySurah(99)).toBe(-1);
    expect(q.index).toBe(0);
  });

  it('copies the playlist instead of aliasing the caller array', () => {
    const source = [item(1), item(2)];
    const q = createQueue();
    q.setPlaylist(source);
    source.push(item(3));
    expect(q.size).toBe(2);
    expect(q.items).toHaveLength(2);
  });

  it('coerces a string surah id', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(18)]);
    expect(q.setIndexBySurah('18')).toBe(1);
  });

  it('clears back to an empty queue', () => {
    const q = createQueue();
    q.setPlaylist([item(1), item(2)]);
    q.next();
    q.clear();
    expect(q.size).toBe(0);
    expect(q.index).toBe(0);
    expect(q.current).toBeNull();
    expect(q.next()).toBeNull();
    expect(q.prev()).toBeNull();
  });

  it('degrades to empty when handed a non-array', () => {
    const q = createQueue();
    q.setPlaylist('not an array');
    expect(q.size).toBe(0);
    expect(q.current).toBeNull();
  });
});
