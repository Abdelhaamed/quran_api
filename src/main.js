import '@fontsource/amiri/400.css';
import '@fontsource/amiri/700.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { createStore } from './state/store.js';
import { readState, readCache, writeState, writeCache } from './state/persist.js';
import { getReciters, getSuwar, getRiwayat, getRadios, buildPlaylist, surahUrl } from './api/quran.js';
import { createQueue } from './audio/queue.js';
import { createEngine } from './audio/engine.js';
import { createMediaSession } from './audio/mediaSession.js';
import { createShell, TABS, THEMES } from './ui/shell.js';
import { createSearch } from './ui/search.js';
import { createRecitersView } from './ui/reciters.js';
import { createSurahsView } from './ui/surahs.js';
import { createFavoritesView } from './ui/favorites.js';
import { createRadioView } from './ui/radio.js';
import { createPlayer } from './ui/player.js';
import { toggleFavorite, isFavorite, sortForPlayback } from './utils/favorites.js';
import { h, qs } from './utils/dom.js';

const UNAVAILABLE = 'هذه السورة غير متوفرة لهذا القارئ';
const GONE = 'القارئ لم يعد متوفراً';
// Distinct from GONE: the reciter is still listed, there is simply nothing saved
// to play. Saying the reader is gone when the favorites list is simply empty
// sends the user looking for a problem in the wrong place.
const UNPLAYABLE = 'لا يمكن التشغيل — لا يوجد رابط محفوظ لهذه السورة';
const NOTHING_SAVED = 'لا توجد سور في المفضلة';
const LOAD_FAILED = 'تعذّر تحميل السورة';
const PLAY_FAILED = 'تعذّر تحميل السورة. تحقّق من الاتصال.';
const BLOCKED = 'اضغط تشغيل للسماح بالصوت';
const STALE = 'تعذّر التحديث — تتصفّح البيانات المحفوظة';

const saved = readState();
const store = createStore({
  theme: THEMES.includes(saved.theme) ? saved.theme : 'auto',
  // Validated, not trusted: main.js passes activeTab straight to a
  // `#view-<name>` lookup, so a corrupt or hand-edited stored value would throw
  // on a bare querySelector result.
  activeTab: TABS.includes(saved.activeTab) ? saved.activeTab : TABS[0],
  query: '',
  offline: !navigator.onLine,
  reciters: [],
  suwarById: new Map(),
  riwayat: [],
  radios: [],
  selectedMoshafId: saved.selectedMoshafId ?? null,
  // The reader whose riwayas are on screen. Restored so the surahs tab's change
  // button lands on an already-expanded card, but only when the stored id is a
  // number: a hand-edited string would never match a reciter id and would leave
  // the view permanently collapsed with nothing to show for it.
  expandedReciterId: Number.isFinite(saved.expandedReciterId) ? saved.expandedReciterId : null,
  selectedMoshaf: null,
  playback: null,
  repeat: saved.repeat === 'one' ? 'one' : 'off',
  favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
});

const queue = createQueue();
const engine = createEngine();

/**
 * moshaf.id is globally unique, so one flat map resolves any saved
 * selectedMoshafId or favorite without re-walking 241 reciters on every tap.
 * Cleared and refilled rather than appended to: a reciter selected before the
 * reciters payload resolves must resolve once it lands, and a reciter the API
 * has dropped must not leave a stale moshaf behind.
 *
 * reciterId rides along because the surah list belongs to the (reader, riwaya)
 * pair — the surah header names the reader and its change button has to send
 * the user back to that reader, not just to the tab.
 */
const moshafIndex = new Map();
function indexMoshaf(reciters) {
  moshafIndex.clear();
  for (const r of reciters) {
    for (const m of r.moshaf) {
      moshafIndex.set(m.id, { ...m, reciterId: r.id, reciterName: r.name });
    }
  }
}
const moshafOf = (id) => moshafIndex.get(id) || null;

/**
 * What the queue currently holds, and for which moshaf. The queue is one flat
 * list whose items all carry a `surahId`, and that field is NOT a surah id for
 * every kind of entry: a radio station parks its own id there so setIndexBySurah
 * can place the cursor, and a favorite queue holds entries from several
 * reciters. Station ids, surah ids and moshaf-backed surah ids share one number
 * space, so `setIndexBySurah` alone cannot tell whose list it found — which is
 * why every hand-off records the owner here.
 *
 * `length` is only meaningful for kind 'favorites': one favorite played on its
 * own is a queue of exactly one, which is a different thing from a play-all run
 * that has reached its end, and advance() has to tell them apart.
 */
let queueBinding = null;

function bindMoshafQueue({ force = false } = {}) {
  const s = store.getState();
  const moshaf = s.selectedMoshaf;
  if (!moshaf) return;
  const listKey = `${moshaf.id}:${(moshaf.surahList ?? []).join(',')}`;

  if (!force) {
    if (queueBinding?.kind === 'moshaf' && queueBinding.listKey === listKey) return;
    // A station list or a cross-reciter favorites run is a sequence the user put
    // together; the background refresh must not replace it under them. Both
    // re-assert themselves the moment the user picks a track again.
    if (queueBinding?.kind === 'radio' || queueBinding?.kind === 'favorites') return;
  }

  queue.setPlaylist(buildPlaylist(moshaf, s.suwarById));
  queueBinding = { kind: 'moshaf', moshafId: moshaf.id, listKey };
  // setPlaylist parks the cursor on the first track, and this runs again on every
  // background refresh — so without this, "next" would jump back to surah 1 in
  // the middle of a listening session. The playing surah is the only position
  // worth restoring.
  const p = s.playback;
  if (p?.kind === 'surah' && p.moshafId === moshaf.id) queue.setIndexBySurah(p.surahId);
}

function resolveMoshaf() {
  store.setState({ selectedMoshaf: moshafOf(store.getState().selectedMoshafId) });
  bindMoshafQueue();
}

let toastTimer = 0;
function showToast(message, { action = '', onAction = null, ms = 1800 } = {}) {
  const toast = qs('#toast');
  const kids = [h('span', {}, message)];
  if (action) {
    kids.push(h('button', {
      class: 'btn-primary', type: 'button', onclick: onAction,
    }, action));
  }
  toast.replaceChildren(...kids);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
    toast.replaceChildren();
  }, ms);
}

function playSurah(surahId) {
  const s = store.getState();
  const moshaf = s.selectedMoshaf;
  if (!moshaf) return;

  // Rebind when the queue is holding someone else's list — a station list or a
  // cross-reciter favorites run. Both use the same `surahId` field, so without
  // this the lookup below would find an entry that is not this moshaf's surah.
  const listKey = `${moshaf.id}:${(moshaf.surahList ?? []).join(',')}`;
  if (queueBinding?.kind !== 'moshaf' ||
      queueBinding.moshafId !== moshaf.id || queueBinding.listKey !== listKey) {
    bindMoshafQueue({ force: true });
  }

  // A surah outside this moshaf's own surah_list has no URL to play, which a
  // favorite pointing at another reciter's moshaf can ask for. Reported as a
  // playback error rather than thrown, and the current track is stopped: an
  // error message over audio that is still playing would be a lie about what
  // the user is hearing.
  if (queue.setIndexBySurah(surahId) === -1) {
    engine.pause();
    store.setState({
      playback: {
        kind: 'surah', surahId, moshafId: moshaf.id, url: '',
        title: s.suwarById.get(surahId)?.name || `سورة ${surahId}`,
        reciterName: moshaf.reciterName, riwayaName: moshaf.name,
        isPlaying: false, isFavorite: isFavorite(s.favorites, surahId, moshaf.id),
        seekable: true, error: UNAVAILABLE,
      },
    });
    return;
  }

  const cur = queue.current;
  store.setState({
    playback: {
      kind: 'surah', surahId, moshafId: moshaf.id, url: cur.url,
      title: cur.title, reciterName: moshaf.reciterName,
      riwayaName: moshaf.name, isPlaying: true,
      isFavorite: isFavorite(s.favorites, surahId, moshaf.id),
      seekable: true, error: null,
    },
  });
  engine.play({
    url: cur.url, title: cur.title, artist: moshaf.reciterName,
    album: moshaf.name, kind: 'surah', seekable: true,
  });
}

/**
 * Plays one entry of whatever the queue currently holds, using that entry's own
 * metadata. The queue is not always one reciter's playlist — play-all-favorites
 * crosses reciters and radio holds stations — so the item's shape decides how it
 * is played rather than a single reciter being assumed.
 */
function playQueueItem(item) {
  if (!item) return;

  if (item.station) return playRadio(item.station);

  if (item.fav) {
    const fav = item.fav;
    store.setState({
      playback: {
        kind: 'surah', surahId: fav.surahId, moshafId: fav.moshafId, url: item.url,
        title: fav.surahName, reciterName: fav.reciterName, riwayaName: fav.riwayaName,
        // Read from the store, never assumed. A favorites queue is a snapshot
        // taken when it was built, and the user can delete a still-queued entry
        // from the favorites tab before the queue reaches it — so a hard-coded
        // true lights the player's heart over a track they just un-favorited.
        isPlaying: true,
        isFavorite: isFavorite(store.getState().favorites, fav.surahId, fav.moshafId),
        seekable: true, error: null,
      },
    });
    engine.play({
      url: item.url, title: item.title, artist: fav.reciterName,
      album: fav.riwayaName, kind: 'surah', seekable: true,
    });
    return;
  }

  playSurah(item.surahId);
}

function playRadio(radio) {
  // The queue becomes the station list: the player keeps prev/next in radio mode
  // (R26), and with a surah playlist behind them those buttons would jump into
  // an unrelated recitation. surahId carries the station id purely so
  // setIndexBySurah can place the cursor — a station has no surah of its own.
  queue.setPlaylist(store.getState().radios.map((r) => ({
    surahId: r.id, title: r.name, station: r,
  })));
  queue.setIndexBySurah(radio.id);
  queueBinding = { kind: 'radio' };

  // seekable: false, not just kind: 'radio'. The engine's own seek guard and the
  // player's dead-control check both read the capability flag, and a radio
  // stream answers Accept-Ranges: none — so without it the progress bar stays
  // and a seek silently does nothing.
  store.setState({
    playback: {
      kind: 'radio', url: radio.url, title: radio.name,
      reciterName: 'بث مباشر', isPlaying: true, isFavorite: false,
      seekable: false, error: null,
    },
  });
  engine.play({
    url: radio.url, title: radio.name, artist: 'بث مباشر',
    kind: 'radio', seekable: false,
  });
}

/**
 * Plays a saved favorite on its own, and moves the session to that reciter.
 *
 * Deliberately NOT routed through playSurah: that requires the surah to be in the
 * moshaf's CURRENT surah_list, which a favorite saved against an older list does
 * not have to be — the API's list shrinks between releases and caches predate it.
 * Routing it there made one tap refuse a track that "تشغيل الكل" happily played,
 * from the same entry, in the same session. Both now build the same item and go
 * through the same playQueueItem, so there is one rule and not two.
 */
function playFavorite(fav) {
  if (!moshafOf(fav.moshafId)) {
    showToast(GONE);
    return;
  }
  const url = favoriteUrl(fav);
  if (!url) {
    showToast(UNPLAYABLE);
    return;
  }

  store.setState({ selectedMoshafId: fav.moshafId });
  writeState({ selectedMoshafId: fav.moshafId });
  resolveMoshaf();

  queue.setPlaylist([{ surahId: fav.surahId, title: fav.surahName, url, fav }]);
  queueBinding = { kind: 'favorites', length: 1 };
  playQueueItem(queue.current);
}

/**
 * A favorite saved before its moshaf was known carries no server, and one whose
 * reciter the API has dropped resolves to nothing. surahUrl('') would produce
 * the relative path "018.mp3", which resolves against the app's own origin and
 * 404s — so an entry with no usable server is left out of the queue instead.
 */
function favoriteUrl(fav) {
  const server = fav.server || moshafOf(fav.moshafId)?.server;
  return server ? surahUrl(server, fav.surahId) : '';
}

function playAllFavorites() {
  const favs = store.getState().favorites;
  // Checked before the queue is built, so an empty list says so plainly instead
  // of blaming the readers.
  if (favs.length === 0) {
    showToast(NOTHING_SAVED, { ms: 2600 });
    return;
  }
  const ordered = sortForPlayback(favs)
    .map((fav) => ({ fav, url: favoriteUrl(fav) }))
    .filter((entry) => entry.url);
  if (ordered.length === 0) {
    showToast(UNPLAYABLE, { ms: 2600 });
    return;
  }

  // One queue built from the saved URLs, because these entries cross reciters
  // and no single moshaf's playlist can hold them.
  queue.setPlaylist(ordered.map(({ fav, url }) => ({
    surahId: fav.surahId, title: fav.surahName, url, fav,
  })));
  queueBinding = { kind: 'favorites', length: ordered.length };
  playQueueItem(queue.current);
}

function advance() {
  const s = store.getState();
  if (s.repeat === 'one' && s.playback?.kind === 'surah') {
    engine.restart();
    return;
  }
  const nextItem = queue.next();
  if (!nextItem) {
    // One favorite played on its own is a queue of exactly one, so reaching its
    // end is not the end of anything the user asked for: fall back to the
    // selected reciter's own playlist so "next" keeps going, as it did before
    // playFavorite stopped sharing playSurah's queue. Gated on length === 1 so a
    // play-all run that has genuinely finished, and a recitation that has reached
    // the end of the moshaf's surah_list, still stop.
    if (queueBinding?.kind === 'favorites' && queueBinding.length === 1) {
      bindMoshafQueue({ force: true });
      const carried = queue.current;
      if (carried && carried.surahId !== s.playback?.surahId) {
        playQueueItem(carried);
        return;
      }
    }
    // End of the queue: the player keeps the last track's title and shows it
    // paused, rather than blanking to a state with no track in it.
    if (s.playback) store.setState({ playback: { ...s.playback, isPlaying: false } });
    engine.pause();
    return;
  }
  playQueueItem(nextItem);
}

function previous() {
  const item = queue.prev();
  if (item) playQueueItem(item);
}

function toggleSurah(surahId, moshafId) {
  if (moshafId == null) return;
  const s = store.getState();
  const moshaf = moshafOf(moshafId);
  const meta = s.suwarById.get(surahId);
  // toggleFavorite returns a new array. Mutating in place would hand setState
  // the same reference it already holds, which it compares with Object.is and
  // so treats as unchanged — every view would then skip the re-render and the
  // heart would sit there in its old state until the next unrelated change.
  const next = toggleFavorite(s.favorites, {
    surahId, moshafId,
    surahName: meta?.name || `سورة ${surahId}`,
    reciterName: moshaf?.reciterName || '',
    riwayaName: moshaf?.name || '',
    server: moshaf?.server || '',
  });
  const stillFav = isFavorite(next, surahId, moshafId);
  writeState({ favorites: next });
  store.setState({
    favorites: next,
    playback: s.playback?.surahId === surahId && s.playback?.moshafId === moshafId
      ? { ...s.playback, isFavorite: stillFav }
      : s.playback,
  });
  showToast(stillFav ? 'أُضيفت إلى المفضلة' : 'أُزيلت من المفضلة');
}

function toggleCurrentFavorite() {
  const p = store.getState().playback;
  if (!p || p.kind !== 'surah') return;
  toggleSurah(p.surahId, p.moshafId);
}

// The player owns its own 250ms ticker, so its destroy() is the one teardown
// that matters in a whole-session app.
const player = createPlayer({
  root: qs('#player'), store, engine,
  onNext: advance,
  onPrev: previous,
  onToggleFavorite: toggleCurrentFavorite,
});

const shell = createShell({ store });
createSearch({ store });

const reciters = createRecitersView({
  root: qs('#view-reciters'),
  store,
  // Explicit riwaya choice, per the user: the surah list depends on which riwaya
  // is selected — the same reader ships 114 surahs under one and 38 under
  // another — so the reader's first riwaya is never auto-selected here.
  onSelectMoshaf(_reciter, moshaf) {
    store.setState({ selectedMoshafId: moshaf.id, activeTab: 'surahs' });
    writeState({ selectedMoshafId: moshaf.id });
    resolveMoshaf();
  },
});

createSurahsView({
  root: qs('#view-surahs'), store,
  onPlay: (id) => playSurah(id),
  onToggleFavorite: (id) => toggleSurah(id, store.getState().selectedMoshafId),
  onChangeReciter(reciterId) {
    // Back to the readers tab with that reader already expanded, so switching
    // riwaya is one tap instead of hunting for the reader among 241 cards again.
    store.setState({ expandedReciterId: reciterId, activeTab: 'reciters' });
    reciters.reveal();
  },
});

createFavoritesView({
  root: qs('#view-favorites'), store,
  onPlay: playFavorite,
  onRemove: (fav) => toggleSurah(fav.surahId, fav.moshafId),
  onPlayAll: playAllFavorites,
  onBrowse: () => store.setState({ activeTab: 'surahs' }),
});

createRadioView({ root: qs('#view-radio'), store, onPlay: playRadio });

// Registered at bootstrap, not after the first play, so the lock-screen buttons
// exist before any audio has started.
const session = createMediaSession({
  // getCurrent() is null before anything has played; play() would throw on
  // item.url.
  onPlay: () => { const current = engine.getCurrent(); if (current) engine.play(current); },
  onPause: () => engine.pause(),
  onStop: () => engine.pause(),
  onSeekBy: (d) => engine.seekBy(d),
  onNext: advance,
  onPrev: previous,
});

// The engine is the authority on whether audio is actually running, so its
// events — not an optimistic write at call time — are what mirror into the
// store. Patching a null playback is skipped rather than spread into `{}`,
// which the player would read as a track with no kind.
function patchPlaying(isPlaying) {
  const p = store.getState().playback;
  if (!p) return;
  store.setState({ playback: { ...p, isPlaying } });
}

engine.on('track', (item) => session.update({ ...item, isPlaying: !engine.element.paused }));
engine.on('play', () => {
  session.setState(true);
  patchPlaying(true);
});
engine.on('pause', () => {
  session.setState(false);
  patchPlaying(false);
});
engine.on('time', ({ currentTime, duration }) =>
  session.setPosition(currentTime, duration, engine.element.playbackRate || 1));
engine.on('ended', advance);
engine.on('error', () => {
  const p = store.getState().playback;
  if (p) store.setState({ playback: { ...p, isPlaying: false, error: PLAY_FAILED } });
  showToast(LOAD_FAILED, { action: 'تخطّي', onAction: () => advance(), ms: 6000 });
});
engine.on('blocked', () => {
  patchPlaying(false);
  showToast(BLOCKED, {
    action: 'تشغيل',
    onAction: () => {
      const p = store.getState().playback;
      if (!p?.url) return;
      // spread, not a hand-built item: the engine's own seekBy/restart guards
      // read `seekable` off the item it is holding, and this is the same
      // object with one field flipped.
      engine.play({ ...engine.getCurrent(), ...p, seekable: p.seekable !== false });
    },
    ms: 6000,
  });
});

addEventListener('online', () => store.setState({ offline: false }));
addEventListener('offline', () => store.setState({ offline: true }));

// Both written from here rather than at each call site: a tab change and an
// expansion each reach the store from more than one place — a tab button, a riwaya
// tap, the surah header's change button — and shell.js only knows about its own
// tab buttons. Without this, picking a riwaya then reloading lands on القرّاء
// with the reader the user had just chosen sitting there collapsed. shell.js
// still writes activeTab on a click, which is the same key with the same value:
// writeState merges, so the duplicate write is idempotent.
store.subscribe((s, keys) => {
  if (keys.has('activeTab')) writeState({ activeTab: s.activeTab });
  if (keys.has('expandedReciterId')) writeState({ expandedReciterId: s.expandedReciterId });
});

const dataAbort = new AbortController();
// A navigation away discards the in-flight 191KB reciters payload: publishing
// it into a document that is going away buys nothing, and a response that lands
// after the abort would write a cache entry over whatever the next load reads.
addEventListener('pagehide', () => dataAbort.abort(), { once: true });

/**
 * Cached copy first, then a refresh. getJSON gives the reciters payload a 6s
 * timeout and no retry, so making first paint wait for it would make the whole
 * app depend on the network; the cache is what a repeat visit renders from, and
 * the fetch below still replaces it when it lands.
 */
async function loadData() {
  const cachedReciters = readCache('reciters');
  const cachedSuwar = readCache('suwar');
  const cachedRadios = readCache('radios');
  const cachedRiwayat = readCache('riwayat');

  if (cachedSuwar) store.setState({ suwarById: new Map(cachedSuwar.map((s) => [s.id, s])) });
  if (cachedReciters) store.setState({ reciters: cachedReciters });
  if (cachedRadios) store.setState({ radios: cachedRadios });
  if (cachedRiwayat) store.setState({ riwayat: cachedRiwayat });
  // Indexed before resolving, so a saved reciter paints on the first frame
  // instead of after the network.
  indexMoshaf(cachedReciters || []);
  resolveMoshaf();

  try {
    const [reciters, suwar, radios, riwayat] = await Promise.all([
      getReciters(dataAbort.signal), getSuwar(dataAbort.signal),
      getRadios(dataAbort.signal), getRiwayat(dataAbort.signal),
    ]);
    if (dataAbort.signal.aborted) return;
    writeCache('reciters', reciters);
    writeCache('suwar', suwar);
    writeCache('radios', radios);
    writeCache('riwayat', riwayat);
    store.setState({
      reciters, radios, riwayat,
      suwarById: new Map(suwar.map((s) => [s.id, s])),
    });
    indexMoshaf(reciters);
    resolveMoshaf();
  } catch (err) {
    // An abort is this page's own doing, not a failure to report. Without this
    // check a normal navigation would raise a "could not update" banner on the
    // way out, and write a cache entry from a response nobody is waiting for.
    if (dataAbort.signal.aborted) return;
    shell.banner(store.getState().reciters.length > 0 ? STALE : err.message);
  }
}

loadData();

/**
 * Exported so test/ui.test.js can drive the wiring — the store, the queue, and
 * the playback handlers — and prove the behaviour by mutating it. The wiring is
 * where the reciter/surah/favorite cross-references live, and a test that
 * re-implements it would be testing its own copy instead.
 */
export const app = {
  store, queue, engine, player, shell, session,
  indexMoshaf, moshafOf, resolveMoshaf, showToast,
  playSurah, playQueueItem, playRadio, playFavorite, playAllFavorites,
  advance, previous, toggleSurah, toggleCurrentFavorite, loadData,
};
