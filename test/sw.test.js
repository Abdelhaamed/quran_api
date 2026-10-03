import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The update button posts { type: 'SKIP_WAITING' } to the waiting worker.
// With injectManifest nobody handles that unless src/sw.js does it explicitly
// (generateSW injects it automatically) — without the branch the toast button
// does nothing on phone or web, and only deleting the app clears the state.
// These assertions read the worker source because no test environment runs a
// real service worker lifecycle.
const SW = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sw.js'),
  'utf8',
);

describe('service worker update path', () => {
  it('handles the SKIP_WAITING message the update button posts', () => {
    expect(SW).toMatch(/SKIP_WAITING/);
    expect(SW).toMatch(/skipWaiting\(\)/);
  });

  it('keeps serving the audio cache with range support', () => {
    expect(SW).toMatch(/audio-v1/);
    expect(SW).toMatch(/RangeRequestsPlugin/);
  });

  it('never stores streamed audio, only explicit downloads', () => {
    expect(SW).toMatch(/cacheWillUpdate/);
  });
});
