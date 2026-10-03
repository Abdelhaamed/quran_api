// Single source for every icon in the app: inline Bootstrap Icons SVGs.
//
// Why inline SVG instead of a font or the previous Unicode glyphs:
// - a font ships hundreds of unused glyphs and needs its own download;
// - Unicode media glyphs render differently per OS font and forced the
//   project through two separate glyph-direction regressions;
// - `?raw` imports inline only the icons actually referenced, so the bundle
//   pays for ~1KB per icon and nothing else.
//
// Bootstrap's shapes already match the settled RTL mapping (prev points
// right, next points left, rewind/fast-forward encode time direction), so no
// mirroring transform is needed. If a glyph ever needs flipping, do it here
// once — never per call site.
import playFill from 'bootstrap-icons/icons/play-fill.svg?raw';
import pauseFill from 'bootstrap-icons/icons/pause-fill.svg?raw';
import skipEndFill from 'bootstrap-icons/icons/skip-end-fill.svg?raw';
import skipStartFill from 'bootstrap-icons/icons/skip-start-fill.svg?raw';
import repeatIcon from 'bootstrap-icons/icons/repeat.svg?raw';
import heartIcon from 'bootstrap-icons/icons/heart.svg?raw';
import heartFill from 'bootstrap-icons/icons/heart-fill.svg?raw';
import searchIcon from 'bootstrap-icons/icons/search.svg?raw';
import moonFill from 'bootstrap-icons/icons/moon-fill.svg?raw';
import sunFill from 'bootstrap-icons/icons/sun-fill.svg?raw';
import downloadIcon from 'bootstrap-icons/icons/download.svg?raw';
import chevronDown from 'bootstrap-icons/icons/chevron-down.svg?raw';
import chevronUp from 'bootstrap-icons/icons/chevron-up.svg?raw';
import broadcastIcon from 'bootstrap-icons/icons/broadcast.svg?raw';
import trashIcon from 'bootstrap-icons/icons/trash.svg?raw';

// YouTube-style circular 10-second buttons: a stroked circular arrow around a
// "10" label. Bootstrap has no "number in a circle" glyph, so these two are
// hand-drawn here in the same 24-unit grid. The numeral inherits the page
// font, so it tracks the UI typeface automatically.
const rewind10 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 8.5A8 8 0 1 1 4 15"/><path d="M4.5 3.8v4.7h4.7"/><text x="12.4" y="16.2" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">10</text></svg>`;
const forward10 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(24,0) scale(-1,1)"><path d="M4.6 8.5A8 8 0 1 1 4 15"/><path d="M4.5 3.8v4.7h4.7"/></g><text x="11.6" y="16.2" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">10</text></svg>`;

const ICONS = {
  play: playFill,
  pause: pauseFill,
  prev: skipEndFill,
  next: skipStartFill,
  back: rewind10,
  fwd: forward10,
  repeat: repeatIcon,
  heart: heartIcon,
  heartOn: heartFill,
  search: searchIcon,
  moon: moonFill,
  sun: sunFill,
  install: downloadIcon,
  download: downloadIcon,
  downloaded: downloadIcon,
  chevronDown,
  chevronUp,
  broadcast: broadcastIcon,
  delete: trashIcon,
};

export function icon(name) {
  const svg = ICONS[name];
  if (!svg) throw new Error(`unknown icon: ${name}`);
  const span = document.createElement('span');
  span.className = 'ic';
  span.setAttribute('aria-hidden', 'true');
  span.dataset.icon = name;
  span.innerHTML = svg;
  return span;
}

export function setIcon(slot, name) {
  const svg = ICONS[name];
  if (!svg) throw new Error(`unknown icon: ${name}`);
  if (slot.dataset.icon !== name) {
    slot.dataset.icon = name;
    slot.innerHTML = svg;
  }
}
