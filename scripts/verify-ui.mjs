// Task 8 automated verification. Drives the real system Chrome against the
// production preview server. Run: node scripts/verify-ui.mjs
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:4173/quran_api/';
const WIDTHS = [360, 390, 768, 1280, 1920];

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox'],
});

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`[${width}] no horizontal scroll`, scrollW <= width + 1, `scrollWidth=${scrollW}`);

  const small = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('button, input, a, [role="button"]')) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) bad.push(`${el.className || el.id} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad.slice(0, 5);
  });
  check(`[${width}] touch targets >= 44px`, small.length === 0, small.join('; '));

  const reciters = await page.locator('.reciter').count();
  check(`[${width}] reciter cards render`, reciters > 10, `${reciters} cards`);

  check(`[${width}] no page errors`, errors.length === 0, errors.join('; '));
  await page.close();
}

// Functional: pick a reciter, pick first moshaf, play, switch tabs.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.reciter', { timeout: 20000 });
  await page.locator('.reciter').first().click();
  await page.waitForTimeout(800);
  const surahs = await page.locator('#view-surahs .surah').count();
  check('[flow] surah grid opens after reciter tap', surahs > 0, `${surahs} surahs`);
  await page.locator('#view-surahs .surah-open').first().click();
  await page.waitForTimeout(2500);
  const audioCount = await page.evaluate(() => document.querySelectorAll('audio').length);
  check('[flow] exactly one <audio> element', audioCount === 1, `found ${audioCount}`);
  const playerVisible = await page.locator('#player:not([hidden])').count();
  check('[flow] sticky player visible', playerVisible === 1);
  for (const tab of ['favorites', 'radio', 'reciters']) {
    await page.locator(`.tab[data-tab="${tab}"]`).click();
    await page.waitForTimeout(400);
  }
  const stillOne = await page.evaluate(() => document.querySelectorAll('audio').length);
  check('[flow] still one <audio> after tab switches', stillOne === 1);
  const paused = await page.evaluate(() => document.querySelector('audio')?.paused);
  check('[flow] audio object exists', paused !== undefined);
  check('[flow] no page errors during flow', errors.length === 0, errors.join('; '));
  await page.close();
}

await browser.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
