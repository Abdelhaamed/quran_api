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
import rewindFill from 'bootstrap-icons/icons/rewind-fill.svg?raw';
import fastForwardFill from 'bootstrap-icons/icons/fast-forward-fill.svg?raw';
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

const ICONS = {
  play: playFill,
  pause: pauseFill,
  prev: skipEndFill,
  next: skipStartFill,
  back: rewindFill,
  fwd: fastForwardFill,
  repeat: repeatIcon,
  heart: heartIcon,
  heartOn: heartFill,
  search: searchIcon,
  moon: moonFill,
  sun: sunFill,
  install: downloadIcon,
  chevronDown,
  chevronUp,
  broadcast: broadcastIcon,
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
