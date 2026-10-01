export function createQueue() {
  let items = [];
  let at = 0;

  return {
    setPlaylist(list) {
      items = Array.isArray(list) ? list.slice() : [];
      at = 0;
    },
    setIndexBySurah(surahId) {
      const found = items.findIndex((i) => Number(i.surahId) === Number(surahId));
      if (found === -1) return -1;
      at = found;
      return at;
    },
    // Reads are getters and actions are methods. Mixing the two made `size` a
    // property while `index` stayed a method, which is a call-site trap.
    get size() { return items.length; },
    get index() { return at; },
    get current() { return items.length ? items[at] : null; },
    get items() { return items.slice(); },
    next() {
      if (at >= items.length - 1) return null;
      at += 1;
      return items[at];
    },
    prev() {
      if (at <= 0) return null;
      at -= 1;
      return items[at];
    },
    clear() { items = []; at = 0; },
  };
}
