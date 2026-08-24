/**
 * The whole client-side data layer.
 *
 * The concept sheet claims repeat visits should be cheap on mobile data. That
 * claim lives here: every GET is stored in localStorage alongside its ETag, and
 * the next request sends If-None-Match. A 304 costs a few hundred bytes of
 * headers instead of re-downloading the feed. `lastSync` records what came back
 * so the UI can honestly report how much it saved.
 */

const API = import.meta.env.PUBLIC_API_URL || 'http://localhost:4000/api';
const CACHE_PREFIX = 'utgc:cache:';
const TOKEN_KEY = 'utgc:token';
const USER_KEY = 'utgc:user';

export const auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  signIn(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  signOut() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    clearCache();
    location.href = '/';
  },
};

export const lastSync = { hits: 0, misses: 0, bytes: 0 };

export function clearCache() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
  }
}

export function cacheStats() {
  let entries = 0;
  let bytes = 0;
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(CACHE_PREFIX)) continue;
    entries++;
    bytes += (localStorage.getItem(key) || '').length;
  }
  return { entries, bytes, hits: lastSync.hits, misses: lastSync.misses };
}

class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error || `Request failed (${status})`);
    this.status = status;
    this.payload = payload || {};
  }
}
export { ApiError };

const headers = (extra = {}) => {
  const h = { ...extra };
  const t = auth.token;
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
};

/**
 * Cached GET. Returns `{ data, fromCache }`.
 * On a network failure it falls back to whatever is already on the device —
 * a spotty connection shows stale content rather than an empty screen.
 */
export async function get(path, { fresh = false } = {}) {
  const key = CACHE_PREFIX + path;
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    cached = null;
  }

  const h = headers();
  if (cached?.etag && !fresh) h['If-None-Match'] = cached.etag;

  let res;
  try {
    res = await fetch(API + path, { headers: h });
  } catch (networkError) {
    if (cached) return { data: cached.data, fromCache: true, offline: true };
    throw networkError;
  }

  if (res.status === 304 && cached) {
    lastSync.hits++;
    return { data: cached.data, fromCache: true };
  }

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) throw new ApiError(res.status, payload);

  lastSync.misses++;
  lastSync.bytes += text.length;

  const etag = res.headers.get('ETag');
  if (etag) {
    try {
      localStorage.setItem(key, JSON.stringify({ etag, data: payload, at: Date.now() }));
    } catch {
      // Storage full — drop the cache and carry on uncached rather than break.
      clearCache();
    }
  }
  return { data: payload, fromCache: false };
}

/** Uncached GET, for anything personal or fast-changing. */
export async function fetchJson(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: headers({ 'Content-Type': 'application/json', ...(options.headers || {}) }),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export const post = (path, body) => fetchJson(path, { method: 'POST', body });
export const patch = (path, body) => fetchJson(path, { method: 'PATCH', body });
export const del = (path) => fetchJson(path, { method: 'DELETE' });
export const apiBase = API;

/** A write invalidates the caches it could have changed. */
export function invalidate(...prefixes) {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(CACHE_PREFIX)) continue;
    const path = key.slice(CACHE_PREFIX.length);
    if (prefixes.some((p) => path.startsWith(p))) localStorage.removeItem(key);
  }
}
