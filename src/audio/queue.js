export function createQueue() {
  let items = [];
  let at = 0;

  const clamp = () => {
    if (items.length === 0) { at = 0; return; }
    if (at < 0) at = 0;
    if (at >= items.length) at = items.length - 1;
  };

  return {
    setPlaylist(list) {
      items = Array.isArray(list) ? list.slice() : [];
      at = 0;
      clamp();
    },
    setIndexBySurah(surahId) {
      const found = items.findIndex((i) => Number(i.surahId) === Number(surahId));
      if (found === -1) return -1;
      at = found;
      return at;
    },
    current() { return items.length ? items[at] : null; },
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
    index() { return at; },
    // size is a live getter rather than a method: callers read it alongside the
    // playlist length it mirrors, and every other accessor here is a method, so
    // the asymmetry is deliberate to keep `q.size` cheap to read in render paths.
    get size() { return items.length; },
    items() { return items.slice(); },
    clear() { items = []; at = 0; },
  };
}
