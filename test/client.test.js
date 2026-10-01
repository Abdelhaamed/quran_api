import { describe, it, expect, afterEach, vi } from 'vitest';
import { getJSON, ApiError } from '../src/api/client.js';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; vi.restoreAllMocks(); });

function stubFetch(response) {
  const spy = vi.fn().mockResolvedValue(response);
  globalThis.fetch = spy;
  return spy;
}

const withStatus = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({}),
});

const ARABIC = /[\u0600-\u06FF]/;

describe('getJSON error messages', () => {
  it('maps 404 to Arabic', async () => {
    stubFetch(withStatus(404));
    await expect(getJSON('/nope')).rejects.toMatchObject({ status: 404 });
    await expect(getJSON('/nope')).rejects.toThrow(ARABIC);
  });

  it('maps 5xx to Arabic', async () => {
    stubFetch(withStatus(503));
    await expect(getJSON('/boom')).rejects.toMatchObject({ status: 503 });
    await expect(getJSON('/boom')).rejects.toThrow(ARABIC);
  });

  it('maps 403 to Arabic', async () => {
    stubFetch(withStatus(403));
    await expect(getJSON('/secret')).rejects.toMatchObject({ status: 403 });
    await expect(getJSON('/secret')).rejects.toThrow(ARABIC);
  });

  it('never leaks the literal HTTP to the user', async () => {
    for (const status of [400, 403, 404, 429, 500, 503]) {
      stubFetch(withStatus(status));
      await expect(getJSON(`/x/${status}`)).rejects.toSatisfy(
        (e) => ARABIC.test(e.message) && !e.message.includes('HTTP'),
      );
    }
  });

  it('does not retry a 4xx', async () => {
    const spy = stubFetch(withStatus(404));
    await getJSON('/nope').catch(() => {});
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx exactly once', async () => {
    const spy = stubFetch(withStatus(503));
    await getJSON('/boom').catch(() => {});
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('returns parsed JSON on success', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ ok: 1 }) });
    await expect(getJSON('/fine')).resolves.toEqual({ ok: 1 });
  });

  it('reports status 0 for a network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('failed'));
    await expect(getJSON('/x', { retries: 0 })).rejects.toMatchObject({ status: 0 });
  });

  it('surfaces ApiError with a name', async () => {
    stubFetch(withStatus(404));
    await expect(getJSON('/nope')).rejects.toBeInstanceOf(ApiError);
    await expect(getJSON('/nope')).rejects.toHaveProperty('name', 'ApiError');
  });
});