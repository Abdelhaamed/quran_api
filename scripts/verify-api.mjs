import { getReciters, getSuwar, getRiwayat, getRadios, buildPlaylist } from '../src/api/quran.js';

const reciters = await getReciters();
const suwar = await getSuwar();
const riwayat = await getRiwayat();
const radios = await getRadios();

const moshafCount = reciters.reduce((n, r) => n + r.moshaf.length, 0);
const ids = reciters.flatMap((r) => r.moshaf.map((m) => m.id));
const unique = new Set(ids);

console.log('reciters        :', reciters.length, reciters.length === 241 ? 'OK' : 'MISMATCH');
console.log('moshaf          :', moshafCount, moshafCount === 287 ? 'OK' : 'MISMATCH');
console.log('unique moshaf id:', unique.size, unique.size === moshafCount ? 'OK (globally unique)' : 'COLLISION');
console.log('suwar           :', suwar.length, suwar.length === 114 ? 'OK' : 'MISMATCH');
console.log('riwayat         :', riwayat.length, riwayat.length === 20 ? 'OK' : 'MISMATCH');
console.log('radios          :', radios.length, radios.length === 177 ? 'OK' : 'MISMATCH');
const styled = new Set(reciters.flatMap((r) => r.moshaf.map((m) => m.style)));
console.log('styles seen     :', [...styled].join(' | '));

// Every radio URL must be a plain audio stream the <audio> element can take
// directly, and no moshaf may be left unclassified by accident.
if (radios.some((r) => !r.url)) throw new Error('a radio entry has no url');
console.log('unstyled moshaf :',
  reciters.flatMap((r) => r.moshaf).filter((m) => m.style === '').length,
  '(names are "<reciter> - <riwaya>", which carry no style word)');

const byId = new Map(suwar.map((s) => [s.id, s]));
const maaher = reciters.find((r) => r.moshaf.some((m) => m.surahTotal === 38));
if (!maaher) throw new Error('expected a reciter with a 38-surah moshaf');
const partial = maaher.moshaf.find((m) => m.surahTotal === 38);
const built = buildPlaylist(partial, byId);
console.log('partial playlist:', maaher.name, '->', built.length, 'surahs');
if (built.length !== 38) throw new Error(`expected 38 surahs, got ${built.length}`);
console.log('partial url     :', built[0].title, built[0].url);

// Every built playlist entry must resolve to a real surah and a zero-padded URL.
for (const moshaf of [partial]) {
  for (const entry of buildPlaylist(moshaf, byId)) {
    if (!byId.has(entry.surahId)) throw new Error(`unknown surah ${entry.surahId}`);
    if (!/\/\d{3}\.mp3$/.test(entry.url)) throw new Error(`bad url ${entry.url}`);
  }
}
console.log('all playlist urls well-formed');