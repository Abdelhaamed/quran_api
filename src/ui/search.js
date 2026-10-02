import { qs } from '../utils/dom.js';

// Long enough that a fast typist produces one render per word rather than one
// per keystroke, short enough that the list still feels live.
const DEBOUNCE_MS = 120;

export function createSearch({ store }) {
  const input = qs('#search');
  let timer = 0;

  const onInput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => store.setState({ query: input.value.trim() }), DEBOUNCE_MS);
  };
  input.addEventListener('input', onInput);

  // Painted once at construction, not only on a later change: a query restored
  // into the store before this runs would otherwise sit behind an empty box.
  input.value = store.getState().query;

  const unsubscribe = store.subscribe((s, keys) => {
    // The query SURVIVES a tab change, deliberately. One box filtering four views
    // is only "unified" if the same query reaches all of them: clearing it on
    // every switch meant the box answered for whichever tab happened to be open,
    // and on المفضلة it was inert. Gated on the key, and on no leading truthiness
    // test — a `s.query &&` guard skips the empty case, so clearing the query
    // programmatically would leave the old text in the box over an unfiltered list.
    if (keys.has('query') && input.value.trim() !== s.query) {
      input.value = s.query;
    }
  });

  return {
    input,
    destroy() {
      clearTimeout(timer);
      input.removeEventListener('input', onInput);
      unsubscribe();
    },
  };
}
