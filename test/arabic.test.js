import { describe, it, expect } from 'vitest';
import { normalize, matchesAll } from '../src/utils/arabic.js';

describe('normalize', () => {
  it('folds alef variants onto bare alef', () => {
    for (const input of ['أحمد', 'احمد', 'إحمد', 'آحمد', 'ٱحمد'])
      expect(normalize(input)).toBe('احمد');
  });

  it('strips tashkeel and tatweel', () => {
    expect(normalize('بِسْمِ')).toBe('بسم');
    expect(normalize('ٱللَّـهِ')).toBe('الله');
  });

  it('folds alef maksura to ya and ta marbuta to ha', () => {
    expect(normalize('على')).toBe('علي');
    expect(normalize('فاطمة')).toBe('فاطمه');
  });

  it('folds hamza carriers', () => {
    expect(normalize('مؤمن')).toBe('مومن');
    expect(normalize('سؤال')).toBe('سوال');
  });

  it('drops a standalone hamza', () => {
    // A real reciter name in the live corpus carries one, inside
    // "قراءة يعقوب الحضرمي بروايتي رويس وروح".
    expect(normalize('قراءة')).toBe('قراه');
  });

  it('normalizes non-strings without swallowing them', () => {
    expect(normalize(0)).toBe('0');
    expect(normalize(18)).toBe('18');
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });

  it('converts Arabic-Indic digits and lowercases latin', () => {
    expect(normalize('سورة ١٨')).toBe('سوره 18');
    expect(normalize('AlKahf')).toBe('alkahf');
  });

  it('collapses whitespace and trims', () => {
    expect(normalize('  杨   李  ')).toBe('杨 李');
    expect(normalize('  الحصري  ')).toBe('الحصري');
  });

  it('is idempotent', () => {
    const once = normalize('أَحْمَدُ الكِتَاب');
    expect(normalize(once)).toBe(once);
  });

  it('handles empty input', () => {
    expect(normalize('')).toBe('');
    expect(normalize('   ')).toBe('');
  });
});

describe('matchesAll', () => {
  // This is the function search actually calls, so it needs coverage of its
  // own: normalize() being correct does not prove matching is correct.
  it('folds the query, not just the haystack', () => {
    // Every natural query a user types is UNFOLDED. If normalize(query) were
    // dropped, all of these would return false and search would silently break
    // for every real input while a suite using pre-folded queries stayed green.
    expect(matchesAll('احمد العجمي', 'أحمد')).toBe(true);
    expect(matchesAll('محمد إبراهيم الحضرمي', 'إبراهيم')).toBe(true);
    expect(matchesAll('أبو بكر الشاطري', 'ابو بكر')).toBe(true);
    expect(matchesAll('فاطمة', 'فاطمة')).toBe(true);
    expect(matchesAll('مؤمن', 'مؤمن')).toBe(true);
  });

  it('folds both sides identically', () => {
    expect(matchesAll('أحمد العجمي', 'احمد')).toBe(true);
    expect(matchesAll('احمد العجمي', 'أحمد')).toBe(true);
  });

  it('requires every token to match', () => {
    expect(matchesAll('أحمد بن علي العجمي', 'احمد')).toBe(true);
    expect(matchesAll('أحمد بن علي العجمي', 'احمد عجمي')).toBe(true);
    expect(matchesAll('أحمد بن علي العجمي', 'احمد sudais')).toBe(false);
    expect(matchesAll('عبد الرحمن السديس', 'السديس عبد')).toBe(true);
  });

  it('treats an empty query as a match', () => {
    expect(matchesAll('الحصري', '')).toBe(true);
    expect(matchesAll('الحصري', '   ')).toBe(true);
  });

  it('rejects a token absent from the haystack', () => {
    expect(matchesAll('محمد', 'احمد')).toBe(false);
  });
});
