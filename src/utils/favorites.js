// A favorite is one playable item, either a surah by a reciter or a live
// station. The two shapes share only `kind` and `url`:
//
//   surah: { kind: 'surah', surahId, moshafId, surahName, reciterName,
//            riwayaName, server }
//   radio: { kind: 'radio', url, stationName }
//
// Older entries saved before `kind` existed have no kind field and are surahs;
// every helper below treats a missing kind as 'surah' so stored favorites
// keep working after the upgrade.
export function entryKind(entry) {
  return entry.kind || 'surah';
}

export function favoriteKey(surahId, moshafId) {
  // Coerced so a key built from a string id read out of storage still matches
  // one built from the numeric id the API returns.
  return `${Number(surahId)}:${Number(moshafId)}`;
}

export function radioKey(url) {
  return `radio:${url}`;
}

export function entryKey(entry) {
  return entryKind(entry) === 'radio'
    ? radioKey(entry.url)
    : favoriteKey(entry.surahId, entry.moshafId);
}

export function isFavorite(list, surahId, moshafId) {
  const key = favoriteKey(surahId, moshafId);
  return list.some((f) => entryKey(f) === key);
}

export function isRadioFavorite(list, url) {
  const key = radioKey(url);
  return list.some((f) => entryKey(f) === key);
}

export function toggleFavorite(list, entry) {
  const key = entryKey({ ...entry, kind: entry.kind });
  const exists = list.some((f) => entryKey(f) === key);
  if (exists) return list.filter((f) => entryKey(f) !== key);
  return [...list, { ...entry, kind: entryKind(entry), addedAt: Date.now() }];
}

/**
 * Surahs sort by number, then reciter; stations have no number, so they follow
 * in the order they were saved. Two favorites of the same surah by different
 * reciters are a supported shape, so moshafId breaks the surah tie. Without
 * it the comparator is not total and the order falls to Array#sort stability
 * rather than to a rule.
 */
export function sortForPlayback(list) {
  return [...list].sort((a, b) => {
    const ka = entryKind(a);
    const kb = entryKind(b);
    if (ka !== kb) return ka === 'surah' ? -1 : 1;
    if (ka === 'radio') return (a.addedAt || 0) - (b.addedAt || 0);
    return Number(a.surahId) - Number(b.surahId) || Number(a.moshafId) - Number(b.moshafId);
  });
}
