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

/**
 * The Arabic copy is the only user-facing text this layer produces, so every
 * failure path must map to it — including HTTP statuses. Rethrowing the raw
 * `HTTP 404` would surface English in an Arabic interface.
 *
 * `navigator` is absent outside browsers, so it is guarded: a ReferenceError
 * here would replace the Arabic message with an opaque crash.
 */
function messageFor(err) {
  if (!(err instanceof ApiError)) {
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'لا يوجد اتصال بالإنترنت. البيانات المحفوظة متاحة.'
      : 'تعذّر جلب البيانات. تحقق من الاتصال وحاول مجدداً.';
  }
  if (err.status >= 500) return 'الخادم غير متاح الآن. حاول بعد قليل.';
  if (err.status === 404) return 'تعذّر العثور على البيانات المطلوبة.';
  if (err.status === 403) return 'لا صلاحية للوصول إلى هذه البيانات.';
  return 'تعذّر جلب البيانات. تحقق من الاتصال وحاول مجدداً.';
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

  throw new ApiError(messageFor(lastError), lastError, lastError?.status ?? 0);
}