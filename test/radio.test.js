import { describe, it, expect } from 'vitest';
import { categorize, categoryLabel } from '../src/ui/radio.js';

describe('categorize', () => {
  it('leaves reciter streams in tilawa', () => {
    expect(categorize('أحمد العجمي')).toBe('tilawa');
    expect(categorize('شيخ أبو بكر الشاطري')).toBe('tilawa');
    expect(categorize('ماهر المعيقلي')).toBe('tilawa');
  });

  it('detects tafsir channels', () => {
    expect(categorize('تفسير القران الكريم')).toBe('tafsir');
    expect(categorize('المختصر في تفسير القرآن الكريم')).toBe('tafsir');
    expect(categorize('تفسير غريب القرآن')).toBe('tafsir');
  });

  it('detects adhkar channels through normalized folding', () => {
    // أذكار normalizes to اذكار, so the keyword matches with or without hamza.
    expect(categorize('أذكار الصباح')).toBe('adhkar');
    expect(categorize('أذكار المساء')).toBe('adhkar');
    expect(categorize('الرقية الشرعية')).toBe('adhkar');
  });

  it('detects sira channels', () => {
    expect(categorize('قصص الأنبياء')).toBe('sira');
    expect(categorize('المختصر في السيرة النبوية')).toBe('sira');
    expect(categorize('الشمائل المحمدية')).toBe('sira');
  });

  it('detects fatawa channels', () => {
    expect(categorize('الفتاوى العامة')).toBe('fatawa');
  });

  it('detects broadcast stations', () => {
    expect(categorize('إذاعة القرآن الكريم - السعودية')).toBe('stations');
  });

  it('detects translations', () => {
    expect(categorize('ترجمة معاني القرآن باللغة الأوردية')).toBe('tarjama');
  });

  it('falls back to tilawa for an unknown or empty name', () => {
    expect(categorize('قناة جديدة تماما')).toBe('tilawa');
    expect(categorize('')).toBe('tilawa');
    expect(categorize(null)).toBe('tilawa');
    expect(categorize(undefined)).toBe('tilawa');
  });

  // Exact-name overrides beat keywords. هيثم الجدعاني contains the دعا
  // sequence ("الجدعاني"), so keywords alone put a reciter in أذكار.
  it('applies user-requested placements ahead of keywords', () => {
    expect(categorize('هيثم الجدعاني')).toBe('tilawa');
    expect(categorize('تكبيرات العيد')).toBe('adhkar');
    expect(categorize('كتاب الاختيارات الفقهية في مسائل العبادات والمعاملات')).toBe('fatawa');
    expect(categorize('صحيح البخاري')).toBe('sira');
    expect(categorize('صحيح مسلم')).toBe('sira');
    expect(categorize('رياض الصالحين')).toBe('sira');
    expect(categorize('فضل شهر رمضان')).toBe('fatawa');
  });

  it('resolves a label for every category id', () => {
    for (const id of ['all', 'tilawa', 'tafsir', 'adhkar', 'sira', 'fatawa', 'stations', 'tarjama']) {
      expect(categoryLabel(id).length).toBeGreaterThan(0);
    }
    expect(categoryLabel('nope')).toBe(categoryLabel('all'));
  });
});
