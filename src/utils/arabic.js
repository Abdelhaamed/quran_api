const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const ALEF = /[\u0622\u0623\u0625\u0671\u0672\u0673\u0675]/g;
const WAW_HAMZA = /\u0624/g;
const YEH_HAMZA = /\u0626/g;
const HAMZA = /\u0621/g;
const ALEF_MAKSURA = /\u0649/g;
const TA_MARBUTA = /\u0629/g;
const ARABIC_INDIC = /[\u0660-\u0669]/g;
const WHITESPACE = /\s+/g;

export function normalize(text) {
  if (!text) return '';
  return String(text)
    .replace(TASHKEEL, '')
    .replace(ALEF, '\u0627')
    .replace(WAW_HAMZA, '\u0648')
    .replace(YEH_HAMZA, '\u064A')
    .replace(HAMZA, '')
    .replace(ALEF_MAKSURA, '\u064A')
    .replace(TA_MARBUTA, '\u0647')
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(WHITESPACE, ' ')
    .trim();
}

export function matchesAll(haystack, query) {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const text = normalize(haystack);
  return tokens.every((t) => text.includes(t));
}
