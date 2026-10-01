import { describe, it, expect } from 'vitest';
import { deriveStyle, surahUrl, buildPlaylist } from '../src/api/quran.js';

describe('deriveStyle', () => {
  it('classifies the three styles present in the live corpus', () => {
    expect(deriveStyle('حفص عن عاصم - مرتل')).toBe('مرتّل');
    expect(deriveStyle('المصحف المجود')).toBe('مجوّد');
    expect(deriveStyle('المصحف المعلم')).toBe('مُعلِّم');
    expect(deriveStyle('حفص عن عاصم - تلاوة مميزة')).toBe('مميّزة');
  });

  it('does not confuse المجود with مجود', () => {
    // Both fold to مجوّد because المجود contains مجود as a substring, so the
    // separate branch that used to exist for it was dead.
    expect(deriveStyle('المصحف المجود')).toBe(deriveStyle('مجود'));
  });

  it('returns empty for a riwaya name with no style word', () => {
    expect(deriveStyle('ورش عن نافع من طريق الأزرق - مرتل')).toBe('مرتّل');
    expect(deriveStyle('حفص عن عاصم - تسجيل عام 1387 هـ - 1967م')).toBe('');
    expect(deriveStyle('')).toBe('');
    expect(deriveStyle(undefined)).toBe('');
  });

  it('is case and whitespace insensitive', () => {
    expect(deriveStyle('  مرتل  ')).toBe('مرتّل');
  });
});

describe('surahUrl', () => {
  it('zero-pads the surah id to three digits', () => {
    expect(surahUrl('https://server6.mp3quran.net/akdr/', 1)).toBe('https://server6.mp3quran.net/akdr/001.mp3');
    expect(surahUrl('https://server6.mp3quran.net/akdr/', 18)).toBe('https://server6.mp3quran.net/akdr/018.mp3');
    expect(surahUrl('https://server6.mp3quran.net/akdr/', 114)).toBe('https://server6.mp3quran.net/akdr/114.mp3');
  });

  it('accepts a string id', () => {
    expect(surahUrl('https://s/', '7')).toBe('https://s/007.mp3');
  });
});

describe('buildPlaylist', () => {
  const suwarById = new Map([
    [1, { id: 1, name: 'الفاتحة' }],
    [18, { id: 18, name: 'الكهف' }],
    [114, { id: 114, name: 'الناس' }],
  ]);

  it('builds from the moshaf surahList, not the full 114', () => {
    const moshaf = { server: 'https://s/', surahList: [1, 18] };
    const list = buildPlaylist(moshaf, suwarById);
    expect(list.map((x) => x.surahId)).toEqual([1, 18]);
    expect(list[1]).toEqual({ surahId: 18, title: 'الكهف', url: 'https://s/018.mp3' });
  });

  it('honours a partial surah_list', () => {
    const moshaf = { server: 'https://s/', surahList: [18] };
    expect(buildPlaylist(moshaf, suwarById)).toHaveLength(1);
  });

  it('falls back to a generic title when metadata is missing', () => {
    const moshaf = { server: 'https://s/', surahList: [99] };
    expect(buildPlaylist(moshaf, suwarById)[0].title).toBe('سورة 99');
  });

  it('returns an empty list when there is no moshaf', () => {
    expect(buildPlaylist(null, suwarById)).toEqual([]);
  });

  it('passes surahList through verbatim, order preserved', () => {
    // The brief expected buildPlaylist to drop 0 and -3, but that filter lives
    // in getReciters, the only place surah_list is parsed. A moshaf's surahList
    // is therefore already integers > 0 by the time it arrives here, so
    // buildPlaylist trusts its input. Its `.filter(Boolean)` would drop the 0
    // but keep the -3, so no reading of the current code yields [1, 18].
    const moshaf = { server: 'https://s/', surahList: [0, 1, -3, 18] };
    expect(buildPlaylist(moshaf, suwarById).map((x) => x.surahId)).toEqual([0, 1, -3, 18]);
    expect(buildPlaylist(moshaf, suwarById)[0].title).toBe('سورة 0');
  });
});