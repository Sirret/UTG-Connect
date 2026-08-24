import crypto from 'node:crypto';
import { run, all } from './db.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const forbidden = (msg = 'Not allowed') => new HttpError(403, msg);

/** Wraps a route so thrown errors reach the error middleware. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function need(body, ...fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw bad(`Missing required field(s): ${missing.join(', ')}`);
}

export const oneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw bad(`${label} must be one of: ${allowed.join(', ')}`);
  return value;
};

export const token = () => crypto.randomBytes(24).toString('hex');

/**
 * SQLite's datetime('now') yields "YYYY-MM-DD HH:MM:SS", so every timestamp we
 * store must use that exact shape or string comparisons in ORDER BY / WHERE
 * silently misbehave against ISO strings with a "T" and a "Z".
 */
export function toSqlTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw bad(`Not a valid date/time: ${value}`);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Turns a stored "YYYY-MM-DD HH:MM:SS" (UTC) back into a real ISO string. */
export const toIso = (sqlTime) => (sqlTime ? `${sqlTime.replace(' ', 'T')}Z` : null);

export const notify = (userId, kind, text, link = '') =>
  run('INSERT INTO notifications (user_id, kind, text, link) VALUES (?, ?, ?, ?)', [userId, kind, text, link]);

export const notifyMany = (userIds, kind, text, link = '') => {
  for (const id of userIds) notify(id, kind, text, link);
};

export const followerIdsOf = (sellerId) =>
  all('SELECT follower_id FROM follows WHERE seller_id = ?', [sellerId]).map((r) => r.follower_id);

/** Days until an ISO timestamp, or null. Powers the countdown badges. */
export function daysUntil(when) {
  if (!when) return null;
  const iso = when.includes('T') ? when : toIso(when);
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.ceil((then - Date.now()) / 86_400_000);
}

export function countdownLabel(when) {
  const d = daysUntil(when);
  if (d === null) return null;
  if (d < 0) return 'passed';
  if (d === 0) return 'today';
  if (d === 1) return '1 day left';
  return `${d} days left`;
}

/**
 * Weak ETag over a payload. The frontend caches responses in localStorage and
 * sends If-None-Match, so a repeat visit costs a 304 instead of a full download
 * — the low-data behaviour the concept sheet is built around.
 */
export function etagOf(payload) {
  return `W/"${crypto.createHash('sha1').update(JSON.stringify(payload)).digest('base64')}"`;
}

/**
 * `volatile` holds fields that change on every request (a server clock, say).
 * They ride along in the body but stay out of the ETag — otherwise the hash
 * would differ every time and the client would never get a 304.
 */
export function sendCached(req, res, payload, maxAge = 30, volatile = null) {
  const etag = etagOf(payload);
  res.set('ETag', etag);
  res.set('Cache-Control', `private, max-age=${maxAge}, stale-while-revalidate=300`);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  return res.json(volatile ? { ...payload, ...volatile } : payload);
}
