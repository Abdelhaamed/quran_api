/**
 * Live survey of the data layer, run before the UI work so field-name and
 * classification mistakes surface here rather than in a component. Not shipped
 * and not part of the build.
 *
 * Every count below is ENFORCED with a throw, not merely printed. A printed
 * MISMATCH with exit 0 is worse than no check: the workflow would go green
 * while the data layer silently changed shape. These are facts about the
 * upstream API, not preferences — if one fails, report it, do not edit it.
 */
import { getReciters, getSuwar, getRiwayat, getRadios, buildPlaylist, deriveStyle } from '../src/api/quran.js';

const reciters = await getReciters();
const suwar = await getSuwar();
const riwayat = await getRiwayat();
const radios = await getRadios();

const moshafCount = reciters.reduce((n, r) => n + r.moshaf.length, 0);
const ids = reciters.flatMap((r) => r.moshaf.map((m) => m.id));
const unique = new Set(ids);

const expect = (label, actual, wanted) => {
  const ok = actual === wanted;
  console.log(`${label.padEnd(17)}:`, actual, ok ? 'OK' : `MISMATCH (expected ${wanted})`);
  if (!ok) throw new Error(`${label}: got ${actual}, expected ${wanted}`);
};

expect('reciters', reciters.length, 241);
expect('moshaf', moshafCount, 287);
// The whole favorites key is `${surahId}:${moshafId}`, so this invariant is
// load-bearing: a collision would silently merge two reciters' entries.
expect('unique moshaf id', unique.size, moshafCount);
expect('suwar', suwar.length, 114);
expect('riwayat', riwayat.length, 20);
expect('radios', radios.length, 177);
expect('meccan suwar', suwar.filter((s) => s.isMeccan).length, 86);

// Every radio URL must be a plain audio stream the <audio> element can take
// directly. deriveStyle is called here rather than trusted from the precomputed
// m.style, so the harness actually exercises the classifier.
if (radios.some((r) => !r.url)) throw new Error('a radio entry has no url');

const styles = new Set(reciters.flatMap((r) => r.moshaf.map((m) => deriveStyle(m.name))));
for (const required of ['مرتّل', 'مجوّد', 'مميّزة'])
  if (!styles.has(required)) throw new Error(`deriveStyle lost the ${required} branch`);
console.log('styles seen     :', [...styles].join(' | '));

// Checked after the required branches so a deleted branch reports the specific
// loss rather than the generic count. Only one live moshaf has no style word
// (a 1387 AH historical recording), where '' is correct.
const unstyled = reciters.flatMap((r) => r.moshaf)
  .filter((m) => deriveStyle(m.name) === '');
console.log('unstyled moshaf :', unstyled.length, '→', unstyled.map((m) => m.name).join(' | '));
if (unstyled.length !== 1) throw new Error(`${unstyled.length} unstyled moshaf; extend deriveStyle`);

// makkia must be read, not type: they are exact inverses, so reading the wrong
// one inverts Meccan and Medinan for all 114 surahs.
expect('medinan suwar', suwar.filter((s) => !s.isMeccan).length, 28);

const byId = new Map(suwar.map((s) => [s.id, s]));
const maaher = reciters.find((r) => r.moshaf.some((m) => m.surahTotal === 38));
if (!maaher) throw new Error('expected a reciter with a 38-surah moshaf');
const partial = maaher.moshaf.find((m) => m.surahTotal === 38);
const built = buildPlaylist(partial, byId);
console.log('partial playlist:', maaher.name, '->', built.length, 'surahs');
if (built.length !== 38) throw new Error(`expected 38 surahs, got ${built.length}`);
console.log('partial url     :', built[0].title, built[0].url);

// Every built entry must resolve to a real surah and a zero-padded URL, so a
// dead link can never reach the player.
for (const entry of built) {
  if (!byId.has(entry.surahId)) throw new Error(`unknown surah ${entry.surahId}`);
  if (!/\/\d{3}\.mp3$/.test(entry.url)) throw new Error(`bad url ${entry.url}`);
}
console.log('all playlist urls well-formed');
