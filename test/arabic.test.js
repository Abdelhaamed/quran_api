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
  it('matches through Arabic folding', () => {
    expect(matchesAll('أحمد العجمي', 'احمد')).toBe(true);
    expect(matchesAll('فاطمة', 'فاطمه')).toBe(true);
    expect(matchesAll('محمود خليل الحصري', 'الحصري')).toBe(true);
  });

  it('requires every token to match', () => {
    expect(matchesAll('أحمد بن علي العجمي', 'احمد')).toBe(true);
    expect(matchesAll('أحمد بن علي العجمي', 'احمد عجمي')).toBe(true);
    expect(matchesAll('أحمد بن علي العجمي', 'احمد sudais')).toBe(false);
  });

  it('treats an empty query as a match', () => {
    expect(matchesAll('الحصري', '')).toBe(true);
    expect(matchesAll('الحصري', '   ')).toBe(true);
  });

  it('does not match a substring of a shorter word', () => {
    expect(matchesAll('محمد', 'احمد')).toBe(false);
  });
});
