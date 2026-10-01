import { getJSON } from './client.js';

/**
 * moshaf_type holds opaque codes (11, 222, 213, ...) that do NOT match the
 * 1/2/3 mapping in older api_2 docs, so the style is read from the name.
 * Returned labels carry diacritics for display; matching is on the plain form.
 */
export function deriveStyle(moshafName) {
  const n = moshafName || '';
  if (n.includes('المجود')) return 'مجوّد';
  if (n.includes('المعلم')) return 'مُعلِّم';
  if (n.includes('مرتل')) return 'مرتّل';
  if (n.includes('مجود')) return 'مجوّد';
  return '';
}

export async function getReciters(signal) {
  const data = await getJSON('/reciters?language=ar', { signal, timeoutMs: 6000 });
  return (data.reciters || []).map((r) => ({
    id: r.id,
    name: r.name,
    letter: r.letter || '',
    moshaf: (r.moshaf || []).map((m) => ({
      id: m.id,
      name: m.name,
      style: deriveStyle(m.name),
      server: m.server,
      surahTotal: Number(m.surah_total) || 0,
      surahList: String(m.surah_list || '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    })),
  }));
}

export async function getSuwar(signal) {
  const data = await getJSON('/suwar?language=ar', { signal });
  // Verified field names: id, name, start_page, end_page, makkia, type.
  // makkia is 1 for Meccan / 0 for Medinan. `type` is its exact inverse, so
  // it is ignored. The endpoint carries no ayah count — see utils/ayah-counts.js.
  return (data.suwar || []).map((s) => ({
    id: Number(s.id),
    name: s.name,
    isMeccan: Number(s.makkia) === 1,
    pageStart: Number(s.start_page),
    pageEnd: Number(s.end_page),
  }));
}

export async function getRiwayat(signal) {
  const data = await getJSON('/riwayat?language=ar', { signal });
  return (data.riwayat || []).map((r) => ({ id: Number(r.id), name: r.name }));
}

export async function getRadios(signal) {
  const data = await getJSON('/radios?language=ar', { signal, timeoutMs: 6000 });
  return (data.radios || []).map((r) => ({ id: Number(r.id), name: r.name, url: r.url }));
}

export function surahUrl(server, surahId) {
  return `${server}${String(surahId).padStart(3, '0')}.mp3`;
}

/** Playlist is built from the moshaf's own surah_list, never the global list. */
export function buildPlaylist(moshaf, suwarById) {
  if (!moshaf) return [];
  return moshaf.surahList
    .map((id) => {
      const meta = suwarById.get(id);
      return {
        surahId: id,
        title: meta?.name || `سورة ${id}`,
        url: surahUrl(moshaf.server, id),
      };
    })
    .filter(Boolean);
}