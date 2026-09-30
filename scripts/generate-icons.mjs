import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
await mkdir(outDir, { recursive: true });

const svg = await readFile(join(outDir, 'icon.svg'));
const square = await sharp(svg).resize(512, 512).png().toBuffer();

// Maskable icons are cropped to a circle of half the canvas, so the glyph is
// scaled to 360px and re-centred, leaving ~15% padding per side.
const maskable = await sharp(svg)
  .resize(360, 360)
  .extend({
    top: 76, bottom: 76, left: 76, right: 76,
    background: { r: 36, g: 31, b: 31, alpha: 1 },
  })
  .png()
  .toBuffer();

await Promise.all([
  writeFile(join(outDir, 'icon-192.png'), await sharp(square).resize(192, 192).toBuffer()),
  writeFile(join(outDir, 'icon-512.png'), square),
  writeFile(join(outDir, 'maskable-512.png'), maskable),
  writeFile(join(outDir, 'apple-touch-icon.png'), await sharp(square).resize(180, 180).toBuffer()),
]);
console.log('icons written to public/icons');
