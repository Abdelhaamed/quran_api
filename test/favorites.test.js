import { describe, it, expect } from 'vitest';
import {
  favoriteKey, isFavorite, toggleFavorite, sortForPlayback,
} from '../src/utils/favorites.js';

const entry = (surahId, moshafId, reciter = 'الحصري') => ({
  surahId, moshafId, surahName: `سورة ${surahId}`,
  reciterName: reciter, riwayaName: 'حفص عن عاصم',
  server: 'https://server6.mp3quran.net/akdr/', addedAt: 0,
});

describe('favoriteKey', () => {
  it('composes surah and moshaf ids', () => {
    expect(favoriteKey(18, 133)).toBe('18:133');
  });
});

describe('isFavorite', () => {
  it('distinguishes the same surah across reciters', () => {
    const list = [entry(18, 1, 'الحصري')];
    expect(isFavorite(list, 18, 1)).toBe(true);
    expect(isFavorite(list, 18, 2)).toBe(false);
  });
});

describe('toggleFavorite', () => {
  it('adds when absent and returns a new array', () => {
    const list = [];
    const next = toggleFavorite(list, entry(18, 1));
    expect(next).toHaveLength(1);
    expect(list).toHaveLength(0);
  });

  it('removes when present', () => {
    const list = [entry(18, 1)];
    expect(toggleFavorite(list, entry(18, 1))).toHaveLength(0);
  });

  it('never duplicates the same surah+reciter pair', () => {
    let list = toggleFavorite([], entry(18, 1));
    list = toggleFavorite(list, entry(18, 1, 'other name'));
    expect(list).toHaveLength(0);
  });

  it('keeps different reciters for the same surah', () => {
    let list = toggleFavorite([], entry(18, 1, 'الحصري'));
    list = toggleFavorite(list, entry(18, 2, 'السديس'));
    expect(list).toHaveLength(2);
  });
});

describe('sortForPlayback', () => {
  it('sorts by surah number', () => {
    const list = [entry(18, 1), entry(2, 1), entry(36, 1)];
    expect(sortForPlayback(list).map((f) => f.surahId)).toEqual([2, 18, 36]);
  });

  it('does not mutate the input', () => {
    const list = [entry(18, 1), entry(2, 1)];
    sortForPlayback(list);
    expect(list[0].surahId).toBe(18);
  });
});
