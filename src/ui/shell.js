import { qs, qsa } from '../utils/dom.js';
import { writeState } from '../state/persist.js';
import { icon } from './icons.js';

export const TABS = ['reciters', 'surahs', 'favorites', 'radio'];
export const THEMES = ['auto', 'light', 'dark'];

const OFFLINE_COPY = 'لا يوجد اتصال — تتصفّح البيانات المحفوظة';

// The pre-paint script in index.html resolves a saved theme the same way.
// Exported so the test can compare the two rather than trust that they match.
export function resolveDark(theme, prefersDark) {
  return theme === 'dark' || (theme === 'auto' && prefersDark);
}

export function createShell({ store }) {
  const banner = qs('#banner');
  const toggle = qs('#theme-toggle');
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const panels = new Map(TABS.map((t) => [t, qs(`#view-${t}`)]));
  const buttons = new Map(TABS.map((t) => [t, qs(`.tab[data-tab="${t}"]`)]));

  // The app's own notice (a failed refresh) and the ambient offline flag write
  // the same element. One painter, so the second writer cannot silently discard
  // the first one's message.
  let notice = '';

  function paintBanner() {
    const text = notice || (store.getState().offline ? OFFLINE_COPY : '');
    banner.textContent = text;
    banner.hidden = !text;
  }

  function applyTheme(theme) {
    const dark = resolveDark(theme, darkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    // Replaced rather than text-swapped, so the button always holds exactly
    // one icon node and never accumulates stale SVGs across toggles.
    toggle.replaceChildren(icon(dark ? 'moon' : 'sun'));
    toggle.setAttribute('aria-label', dark ? 'الوضع الليلي مفعّل' : 'الوضع النهاري مفعّل');
  }

  function paintTabs(active) {
    for (const name of TABS) {
      panels.get(name).hidden = name !== active;
      const btn = buttons.get(name);
      const selected = name === active;
      btn.setAttribute('aria-selected', String(selected));
      // Roving tabindex, so Tab leaves the tablist in one step instead of
      // walking four tabs (WAI-ARIA tabs pattern). Arrow keys move instead.
      btn.tabIndex = selected ? 0 : -1;
    }
  }

  function switchTab(name) {
    if (name === store.getState().activeTab) return;
    store.setState({ activeTab: name });
    writeState({ activeTab: name });
  }

  for (const btn of qsa('.tab')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }

  toggle.addEventListener('click', () => {
    // Two visible states, not three: cycling auto → light → dark → auto made
    // the auto stop look like a dead press, because auto renders exactly like
    // the system mode the user was already seeing. The button always lands on
    // an explicit mode. 'auto' survives only as the never-yet-touched default.
    const isDark = resolveDark(store.getState().theme, darkQuery.matches);
    const next = isDark ? 'light' : 'dark';
    store.setState({ theme: next });
    writeState({ theme: next });
    applyTheme(next);
  });

  // Automatic activation: a focus-driven tab pattern that requires a second
  // activation press is worse on a phone, where the arrow keys are the only
  // way past a widget and a missed second press is invisible.
  qs('.tabs').addEventListener('keydown', (e) => {
    const btn = e.target.closest?.('.tab');
    if (!btn) return;
    const at = TABS.indexOf(btn.dataset.tab);
    if (at === -1) return;

    let to = null;
    // The document is permanently RTL (<html dir="rtl">), so a key press that
    // moves the highlight visually LEFT advances the tab order.
    if (e.key === 'ArrowLeft') to = at + 1;
    else if (e.key === 'ArrowRight') to = at - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = TABS.length - 1;
    if (to === null) return;

    e.preventDefault();
    const next = TABS[(to + TABS.length) % TABS.length];
    switchTab(next);
    buttons.get(next).focus();
  });

  // The OS flipping to light mid-session must follow through while the theme
  // is 'auto' — that is the whole meaning of the option — and must be ignored
  // otherwise, or it would override an explicit choice.
  darkQuery.addEventListener('change', () => {
    if (store.getState().theme === 'auto') applyTheme('auto');
  });

  const unsubscribe = store.subscribe((s, keys) => {
    // Scrolled from the subscription, not from switchTab, so a tab change made
    // from CODE lands at the top as well: picking a riwaya opens the surahs and
    // the surah header's change button opens the readers. Coming out of a readers
    // list that is hundreds of cards long, the browser would otherwise keep the
    // old scroll offset and open a much shorter grid already scrolled past its end.
    if (keys.has('activeTab')) {
      paintTabs(s.activeTab);
      scrollTo({ top: 0, behavior: 'instant' });
    }
    if (keys.has('offline')) paintBanner();
  });

  applyTheme(store.getState().theme);
  paintTabs(store.getState().activeTab);
  paintBanner();

  return {
    banner(message) {
      notice = message;
      paintBanner();
    },
    destroy: unsubscribe,
  };
}
