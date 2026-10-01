const BASE = 'https://mp3quran.net/api/v3';
const DEFAULT_TIMEOUT = 3000;

export class ApiError extends Error {
  constructor(message, cause, status) {
    super(message);
    this.name = 'ApiError';
    this.cause = cause;
    // status 0 means the request never produced a response (offline, DNS,
    // timeout); 4xx/5xx carry the real code so callers can tell a bad path
    // from a dead server.
    this.status = status ?? 0;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A 4xx is deterministic, so replaying it only spends 400ms to reach the same answer. */
function isRetryable(err) {
  return !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
}

export async function getJSON(path, { signal, timeoutMs = DEFAULT_TIMEOUT, retries = 1 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${BASE}${path}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new ApiError(`HTTP ${res.status}`, undefined, res.status);
      return await res.json();
    } catch (err) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      lastError = err;
      // break, not a skipped sleep: the loop condition alone would still spend
      // another round trip reaching the same answer.
      if (!isRetryable(err)) break;
      if (attempt < retries) await sleep(400);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  if (lastError instanceof ApiError) throw lastError;
  // `navigator` is absent outside browsers, and `onLine` is undefined in some
  // runtimes, so this must not throw: a ReferenceError here would replace the
  // Arabic message the UI shows with an opaque crash.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('لا يوجد اتصال بالإنترنت. البيانات المحفوظة متاحة.', lastError);
  }
  throw new ApiError('تعذّر جلب البيانات. تحقق من الاتصال وحاول مجدداً.', lastError);
}