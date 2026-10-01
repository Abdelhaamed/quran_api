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
 * A 4xx means the request REACHED the server and was rejected, so telling the
 * user to check their internet connection would be actively misleading — that
 * message belongs only to the paths where no response arrived at all.
 *
 * `navigator` is absent outside browsers, so it is guarded: a ReferenceError
 * here would replace the Arabic message with an opaque crash.
 *
 * Exported so its per-status mapping can be asserted directly. Testing only
 * "the message contains Arabic" cannot catch two statuses sharing copy, or an
 * arm widened so that 4xx falls into the 5xx branch. The arm order below is
 * load-bearing in both directions: the specific statuses come first, then the
 * 5xx range, then the generic 4xx range, so neither class can reach the other's
 * copy. Reordering those two range arms reintroduces the exact bug above.
 */
export function messageFor(err) {
  if (!(err instanceof ApiError)) {
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'لا يوجد اتصال بالإنترنت. البيانات المحفوظة متاحة.'
      : 'تعذّر جلب البيانات. تحقق من الاتصال وحاول مجدداً.';
  }
  // Ordered most-specific first, and the 5xx arm ahead of the generic 4xx arm so
  // that neither class can fall into the other's copy.
  if (err.status === 404) return 'تعذّر العثور على البيانات المطلوبة.';
  if (err.status === 401 || err.status === 403) return 'لا صلاحية للوصول إلى هذه البيانات.';
  if (err.status === 429) return 'تم تجاوز عدد الطلبات المسموح. حاول بعد قليل.';
  if (err.status === 408) return 'انتهت مهلة الطلب. حاول مجدداً.';
  if (err.status >= 500) return 'الخادم غير متاح الآن. حاول بعد قليل.';
  // Bounded above at 500 as well as below: an unbounded `>= 400` would swallow
  // every 5xx if this line were ever moved above the server-down arm.
  if (err.status >= 400) return 'طلب غير صالح. حدِّث الصفحة وحاول مجدداً.';
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
