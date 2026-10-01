export function favoriteKey(surahId, moshafId) {
  // Coerced so a key built from a string id read out of storage still matches
  // one built from the numeric id the API returns.
  return `${Number(surahId)}:${Number(moshafId)}`;
}

export function isFavorite(list, surahId, moshafId) {
  const key = favoriteKey(surahId, moshafId);
  return list.some((f) => favoriteKey(f.surahId, f.moshafId) === key);
}

export function toggleFavorite(list, entry) {
  const key = favoriteKey(entry.surahId, entry.moshafId);
  const exists = list.some((f) => favoriteKey(f.surahId, f.moshafId) === key);
  if (exists) return list.filter((f) => favoriteKey(f.surahId, f.moshafId) !== key);
  return [...list, { ...entry, addedAt: Date.now() }];
}

/**
 * Two favorites of the same surah by different reciters are a supported shape,
 * so moshafId breaks the tie. Without it the comparator is not total and the
 * order falls to Array#sort stability rather than to a rule.
 */
export function sortForPlayback(list) {
  return [...list].sort((a, b) =>
    Number(a.surahId) - Number(b.surahId) || Number(a.moshafId) - Number(b.moshafId));
}
