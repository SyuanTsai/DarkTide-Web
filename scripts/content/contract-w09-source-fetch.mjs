const SOURCE_API_AUTHORITY = 'api.github.com';
const SOURCE_REPOSITORY_PATH = '/repos/SyuanTsai/DarkTide-Source-Data/';
const SOURCE_READ_PATHS = [
  /^\/repos\/SyuanTsai\/DarkTide-Source-Data\/releases\/tags\/w09-source-w09-[a-f0-9]{32}$/u,
  /^\/repos\/SyuanTsai\/DarkTide-Source-Data\/git\/ref\/tags\/w09-source-w09-[a-f0-9]{32}$/u,
  /^\/repos\/SyuanTsai\/DarkTide-Source-Data\/git\/tags\/[a-f0-9]{40}$/u,
  /^\/repos\/SyuanTsai\/DarkTide-Source-Data\/releases\/assets\/[1-9][0-9]*$/u,
];
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9._~+\-/]+=*$/u;

function isFixedSourceRead(input, init) {
  // The pinned Source resolver uses literal URL strings. Other RequestInfo forms fail closed.
  if (typeof input !== 'string') return false;
  const authorityMatch = /^https:\/\/([^/?#]*)/u.exec(input);
  if (!authorityMatch || authorityMatch[1] !== SOURCE_API_AUTHORITY) return false;

  let url;
  try { url = new URL(input); }
  catch { return false; }
  if (url.protocol !== 'https:' || url.hostname !== SOURCE_API_AUTHORITY
      || url.username || url.password || url.port || url.search || url.hash) return false;
  if (!url.pathname.startsWith(SOURCE_REPOSITORY_PATH)
      || !SOURCE_READ_PATHS.some(pattern => pattern.test(url.pathname))) return false;

  const method = String(init?.method ?? 'GET').toUpperCase();
  return method === 'GET';
}

function safeRateLimitValue(headers, name) {
  let raw;
  try { raw = headers?.get?.(name); }
  catch { return null; }
  if (typeof raw !== 'string' || !/^\d{1,16}$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function httpFailureDiagnostic(response) {
  const details = [];
  const remaining = safeRateLimitValue(response?.headers, 'x-ratelimit-remaining');
  const reset = safeRateLimitValue(response?.headers, 'x-ratelimit-reset');
  if (remaining !== null) details.push(`remaining=${remaining}`);
  if (reset !== null) details.push(`reset=${reset}`);
  return `W09 Source API request returned HTTP ${response.status}`
    + (details.length ? ` (rate-limit ${details.join(', ')})` : '');
}

/**
 * Add the existing workflow token only to the pinned Source repository's HTTPS read APIs.
 * Manual archive redirects remain the pinned resolver's responsibility; CDN requests are untouched.
 */
export function createW09SourceFetch({ fetchImpl = globalThis.fetch, token } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof token !== 'string' || !BEARER_TOKEN_PATTERN.test(token)) {
    throw new Error('W09_GIT_TOKEN is required and must use a valid Bearer token format');
  }

  return async function fetchW09Source(input, init) {
    if (!isFixedSourceRead(input, init)) return fetchImpl(input, init);

    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const authenticatedInit = { ...(init ?? {}), headers };
    let response;
    try { response = await fetchImpl(input, authenticatedInit); }
    catch { throw new Error('W09 Source API GET transport failed before receiving a response'); }
    if (response?.status === 403 || response?.status === 429) {
      throw new Error(httpFailureDiagnostic(response));
    }
    return response;
  };
}
