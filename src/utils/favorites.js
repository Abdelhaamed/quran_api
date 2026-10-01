export function favoriteKey(surahId, moshafId) {
  return `${surahId}:${moshafId}`;
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

export function sortForPlayback(list) {
  return [...list].sort((a, b) => Number(a.surahId) - Number(b.surahId));
}

export function removeFavorite(list, surahId, moshafId) {
  const key = favoriteKey(surahId, moshafId);
  return list.filter((f) => favoriteKey(f.surahId, f.moshafId) !== key);
}
