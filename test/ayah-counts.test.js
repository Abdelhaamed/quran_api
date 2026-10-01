import { describe, it, expect } from 'vitest';
import { AYAH_COUNTS, ayahCount } from '../src/utils/ayah-counts.js';

describe('AYAH_COUNTS', () => {
  it('covers all 114 surahs', () => {
    expect(Object.keys(AYAH_COUNTS)).toHaveLength(114);
  });

  it('sums to the canonical total of 6236 ayat', () => {
    const total = Object.values(AYAH_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(6236);
  });

  it('has known values for landmark surahs', () => {
    expect(ayahCount(1)).toBe(7);
    expect(ayahCount(2)).toBe(286);
    expect(ayahCount(18)).toBe(110);
    expect(ayahCount(114)).toBe(6);
  });

  it('never returns zero for a real surah', () => {
    for (let id = 1; id <= 114; id += 1) expect(ayahCount(id)).toBeGreaterThan(0);
  });

  it('returns 0 for an unknown surah', () => {
    expect(ayahCount(0)).toBe(0);
    expect(ayahCount(115)).toBe(0);
  });

  it('is frozen so no module can mutate the table', () => {
    expect(Object.isFrozen(AYAH_COUNTS)).toBe(true);
  });
});
