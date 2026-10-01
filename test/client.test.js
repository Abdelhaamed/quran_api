import { describe, it, expect, afterEach, vi } from 'vitest';
import { getJSON, ApiError, messageFor } from '../src/api/client.js';

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

// One entry per status, mapping to the EXACT copy expected. Asserting the
// exact string is what catches two statuses sharing a message, or an arm
// widened so 4xx falls into the 5xx branch — both of which a
// "contains Arabic" assertion waves through.
const EXPECTED = {
  400: 'طلب غير صالح. حدِّث الصفحة وحاول مجدداً.',
  401: 'لا صلاحية للوصول إلى هذه البيانات.',
  403: 'لا صلاحية للوصول إلى هذه البيانات.',
  404: 'تعذّر العثور على البيانات المطلوبة.',
  408: 'انتهت مهلة الطلب. حاول مجدداً.',
  422: 'طلب غير صالح. حدِّث الصفحة وحاول مجدداً.',
  429: 'تم تجاوز عدد الطلبات المسموح. حاول بعد قليل.',
  500: 'الخادم غير متاح الآن. حاول بعد قليل.',
  503: 'الخادم غير متاح الآن. حاول بعد قليل.',
};

describe('messageFor', () => {
  it('maps each status to its own exact copy', () => {
    for (const [status, message] of Object.entries(EXPECTED)) {
      expect(messageFor(new ApiError('x', undefined, Number(status)))).toBe(message);
    }
  });

  it('never puts the connectivity message on a 4xx', () => {
    // A 4xx means the server answered and refused; suggesting a connection
    // check would send the user down the wrong path.
    for (const status of [400, 401, 403, 404, 408, 422, 429]) {
      expect(messageFor(new ApiError('x', undefined, status)))
        .not.toContain('تحقق من الاتصال');
    }
  });

  it('gives 404 and 403 different copy', () => {
    expect(messageFor(new ApiError('x', undefined, 404)))
      .not.toBe(messageFor(new ApiError('x', undefined, 403)));
  });

  it('uses the connectivity copy only when no response arrived', () => {
    expect(messageFor(new TypeError('failed'))).toContain('تحقق من الاتصال');
    expect(messageFor(new ApiError('x', undefined, 0))).toContain('تحقق من الاتصال');
  });

  it('returns Arabic for every reachable status', () => {
    for (const status of Object.keys(EXPECTED)) {
      expect(messageFor(new ApiError('x', undefined, Number(status)))).toMatch(ARABIC);
    }
  });
});

describe('getJSON', () => {
  it('reports status 404', async () => {
    stubFetch(withStatus(404));
    await expect(getJSON('/nope')).rejects.toMatchObject({ status: 404 });
  });

  it('reports the exact 404 copy', async () => {
    stubFetch(withStatus(404));
    await expect(getJSON('/nope')).rejects.toThrow('تعذّر العثور على البيانات المطلوبة.');
  });

  it('never leaks the literal HTTP to the user', async () => {
    for (const status of Object.keys(EXPECTED)) {
      stubFetch(withStatus(Number(status)));
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

  it('distinguishes caller cancellation from failure', async () => {
    stubFetch(withStatus(404));
    await expect(getJSON('/nope', { signal: AbortSignal.abort() }))
      .rejects.toHaveProperty('name', 'AbortError');
  });
});
