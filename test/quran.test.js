import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deriveStyle, surahUrl, buildPlaylist, getReciters, getSuwar } from '../src/api/quran.js';

describe('deriveStyle', () => {
  it('classifies every style present in the live corpus', () => {
    expect(deriveStyle('حفص عن عاصم - مرتل')).toBe('مرتّل');
    expect(deriveStyle('المصحف المجود')).toBe('مجوّد');
    expect(deriveStyle('المصحف المعلم')).toBe('مُعلِّم');
    expect(deriveStyle('حفص عن عاصم - تلاوة مميزة')).toBe('مميّزة');
  });

  it('matches مجود without requiring the definite article', () => {
    // Asserted against the branch's return value, not equality between two
    // inputs: comparing 'المصحف المجود' to 'مجود' would still pass with the
    // whole branch deleted, since both would fall through to ''.
    expect(deriveStyle('مجود')).toBe('مجوّد');
    expect(deriveStyle('المصحف المجود')).toBe('مجوّد');
  });

  it('returns empty for a riwaya name with no style word', () => {
    expect(deriveStyle('حفص عن عاصم - تسجيل عام 1387 هـ - 1967م')).toBe('');
    expect(deriveStyle('')).toBe('');
    expect(deriveStyle(undefined)).toBe('');
  });

  it('ignores surrounding whitespace', () => {
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

  it('returns an empty list when the moshaf has no surahList', () => {
    // A moshaf cached by an older build carries no surahList, so `?? []` is the
    // only thing between that cache and a TypeError on `.map`. `null` and
    // missing are both pinned: `||` and `??` differ here only for falsy-but-set
    // values, and an absent field is the realistic case.
    expect(() => buildPlaylist({ server: 'https://s/' }, suwarById)).not.toThrow();
    expect(buildPlaylist({ server: 'https://s/' }, suwarById)).toEqual([]);
    expect(buildPlaylist({ server: 'https://s/', surahList: null }, suwarById)).toEqual([]);
    expect(buildPlaylist({ server: 'https://s/', surahList: undefined }, suwarById)).toEqual([]);
  });

  it('passes surahList through verbatim, in order', () => {
    // buildPlaylist does NOT filter. It receives an already-parsed list from
    // getReciters, which owns the validation. See the getReciters suite below
    // for where the filtering is pinned.
    const moshaf = { server: 'https://s/', surahList: [114, 1, 18] };
    expect(buildPlaylist(moshaf, suwarById).map((x) => x.surahId)).toEqual([114, 1, 18]);
  });
});

describe('getReciters parsing', () => {
  // The surah_list filter lives in getReciters, so it is pinned here rather
  // than by asserting it in buildPlaylist, which does not do it.
  //
  // The hooks live in the describe body, never inside a helper called from an
  // `it`: Vitest silently ignores a beforeEach registered once a test body is
  // already running, which left these tests reading the live API and passing
  // for the wrong reason.
  const original = globalThis.fetch;
  let payload = null;
  let status = 200;

  beforeEach(() => {
    payload = null;
    status = 200;
    // Built fresh on every call so a test can flip the status mid-suite and the
    // spy can still count round trips.
    globalThis.fetch = vi.fn().mockImplementation(async () => (
      status >= 200 && status < 300
        ? { ok: true, status, json: async () => payload }
        : { ok: false, status, json: async () => ({}) }
    ));
  });
  afterEach(() => { globalThis.fetch = original; vi.restoreAllMocks(); });

  const fetchStub = (p) => { payload = p; };
  const fetchStatus = (s) => { status = s; };

  it('drops non-numeric and out-of-range surah_list entries', async () => {
    fetchStub({
      reciters: [{
        id: 1, name: 'اختبار', letter: 'ا',
        moshaf: [{ id: 5, name: 'حفص عن عاصم - مرتل', server: 'https://s/', surah_total: '4', surah_list: '0, 1, -3, x, 18,, 114' }],
      }],
    });
    const [r] = await getReciters();
    expect(r.moshaf[0].surahList).toEqual([1, 18, 114]);
  });

  it('derives style from the moshaf name, not moshaf_type', async () => {
    fetchStub({
      reciters: [{
        id: 1, name: 'اختبار', letter: 'ا',
        moshaf: [
          { id: 5, name: 'حفص عن عاصم - مرتل', server: 'https://s/', surah_total: '114', surah_list: '1', moshaf_type: 11 },
          { id: 6, name: 'المصحف المجود', server: 'https://s/', surah_total: '114', surah_list: '1', moshaf_type: 222 },
        ],
      }],
    });
    const [r] = await getReciters();
    // 11 and 222 are opaque codes, so a numeric classification would be wrong.
    expect(r.moshaf.map((m) => m.style)).toEqual(['مرتّل', 'مجوّد']);
  });

  it('tolerates a missing moshaf array', async () => {
    fetchStub({ reciters: [{ id: 1, name: 'اختبار', letter: 'ا' }] });
    const [r] = await getReciters();
    expect(r.moshaf).toEqual([]);
  });

  describe('retry policy', () => {
    // retries: 0 on /reciters is not an optimisation, it is the difference
    // between 6s and ~12.4s of silence before anything renders. Pinning it
    // separately from the getJSON default keeps the two from drifting together.
    it('issues exactly one fetch for reciters, even on a server error', async () => {
      fetchStatus(503);
      const spy = globalThis.fetch;
      await getReciters().catch(() => {});
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('keeps the default retry on the smaller payloads', async () => {
      // The other fetchers stay on getJSON's retries: 1, so a 503 costs two
      // round trips. Without this the test above would also pass if retries: 0
      // leaked into the default rather than being set per call site.
      fetchStatus(503);
      const spy = globalThis.fetch;
      await getSuwar().catch(() => {});
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
