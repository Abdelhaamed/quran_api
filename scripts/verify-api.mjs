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
console.log('radios          :', radios.length);
console.log('styles seen     :', [...new Set(reciters.flatMap((r) => r.moshaf.map((m) => m.style)))].join(' | '));

// Fixed from the brief, which referenced an undeclared `surah` here; the local
// name is `suwar`.
const byId = new Map(suwar.map((s) => [s.id, s]));
const maaher = reciters.find((r) => r.moshaf.some((m) => m.surahTotal === 38));
const partial = maaher.moshaf.find((m) => m.surahTotal === 38);
console.log('partial playlist:', maaher.name, '->', buildPlaylist(partial, byId).length, 'surahs');