import { Router } from 'express';
import { config } from '../config.js';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { assertCanPostTo, findSchool } from './schools.js';
import {
  bad,
  countdownLabel,
  daysUntil,
  need,
  notFound,
  notifyMany,
  oneOf,
  sendCached,
  toIso,
  toSqlTime,
  wrap,
} from '../util.js';

export const postRoutes = Router();

const KINDS = ['event', 'deadline', 'payment', 'announcement'];

export const shapePost = (p, opts = {}) => ({
  id: p.id,
  title: p.title,
  body: p.body,
  kind: p.kind,
  startsAt: toIso(p.starts_at),
  endsAt: toIso(p.ends_at),
  location: p.location,
  imageUrl: p.image_url,
  documentUrl: p.document_url,
  documentName: p.document_name,
  status: p.status,
  createdAt: toIso(p.created_at),
  updatedAt: toIso(p.updated_at),
  school: { id: p.school_id, code: p.school_code, name: p.school_name, color: p.school_color },
  author: { id: p.author_id, name: p.author_name },
  daysLeft: daysUntil(p.starts_at),
  countdown: countdownLabel(p.starts_at),
  timeSensitive: p.kind !== 'announcement' && !!p.starts_at,
  interested: !!opts.interested,
});

/** Which of these post ids the signed-in viewer has already added to their
 * personal calendar — same shape as `saves`' per-viewer flag in listings.js. */
const interestedSet = (req) =>
  req.user
    ? new Set(all('SELECT post_id FROM post_interests WHERE user_id = ?', [req.user.id]).map((r) => r.post_id))
    : new Set();

const SELECT_POST = `
  SELECT p.*, s.code AS school_code, s.name AS school_name, s.color AS school_color,
         u.name AS author_name
  FROM posts p
  JOIN schools s ON s.id = p.school_id
  JOIN users u   ON u.id = p.author_id
`;

/**
 * "All Schools" view: anything still ahead of us comes first, soonest deadline
 * at the top; everything undated or past falls back to newest-first.
 */
const URGENCY_ORDER = `
  ORDER BY
    CASE WHEN p.starts_at IS NOT NULL AND p.starts_at >= datetime('now') THEN 0 ELSE 1 END,
    CASE WHEN p.starts_at IS NOT NULL AND p.starts_at >= datetime('now') THEN p.starts_at END ASC,
    p.created_at DESC
`;

postRoutes.get(
  '/',
  wrap((req, res) => {
    const { school, kind, status = 'published', since, limit = 50 } = req.query;
    const where = ['p.deleted = 0'];
    const params = [];

    if (status === 'pending') {
      // Only the owning council or an admin should see an unapproved queue.
      if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'council')) {
        throw bad('Only council and admin accounts can list pending posts');
      }
      where.push("p.status = 'pending'");
      if (req.user.role === 'council') {
        where.push('p.school_id = ?');
        params.push(req.user.school_id);
      }
    } else {
      where.push("p.status = 'published'");
    }

    if (school && school !== 'all') {
      const s = findSchool(school);
      if (!s) throw notFound('No such school page');
      where.push('p.school_id = ?');
      params.push(s.id);
    }
    if (kind) {
      where.push('p.kind = ?');
      params.push(oneOf(kind, KINDS, 'kind'));
    }
    // Incremental sync: only hand back what changed since the client's last pull.
    if (since) {
      where.push('p.updated_at > ?');
      params.push(toSqlTime(since));
    }

    const rows = all(
      `${SELECT_POST} WHERE ${where.join(' AND ')} ${URGENCY_ORDER} LIMIT ?`,
      [...params, Math.min(Number(limit) || 50, 200)],
    );
    const interested = interestedSet(req);
    sendCached(req, res, { posts: rows.map((p) => shapePost(p, { interested: interested.has(p.id) })) }, 30, {
      syncedAt: new Date().toISOString(),
    });
  }),
);

/** "This Week at UTG" — one digest across every school. */
postRoutes.get(
  '/digest',
  wrap((req, res) => {
    const weekly = all(
      `${SELECT_POST}
       WHERE p.deleted = 0 AND p.status = 'published'
         AND p.starts_at IS NOT NULL
         AND p.starts_at BETWEEN datetime('now') AND datetime('now', '+7 days')
       ORDER BY p.starts_at ASC`,
    );
    // Quiet week? Stretch the window to a month rather than send a thin digest.
    const window = weekly.length >= 3 ? 'week' : 'month';
    const rows =
      window === 'week'
        ? weekly
        : all(
            `${SELECT_POST}
             WHERE p.deleted = 0 AND p.status = 'published'
               AND p.starts_at IS NOT NULL
               AND p.starts_at BETWEEN datetime('now') AND datetime('now', '+30 days')
             ORDER BY p.starts_at ASC`,
          );
    const interested = interestedSet(req);
    sendCached(req, res, {
      window,
      title: window === 'week' ? 'This Week at UTG' : 'This Month at UTG',
      count: rows.length,
      items: rows.map((p) => shapePost(p, { interested: interested.has(p.id) })),
    }, 300);
  }),
);

postRoutes.get(
  '/:id',
  wrap((req, res) => {
    const post = get(`${SELECT_POST} WHERE p.id = ? AND p.deleted = 0`, [req.params.id]);
    if (!post) throw notFound('Post not found');
    const interested = req.user
      ? !!get('SELECT 1 AS x FROM post_interests WHERE user_id = ? AND post_id = ?', [req.user.id, post.id])
      : false;
    res.json({ post: shapePost(post, { interested }) });
  }),
);

/** Toggle this post on/off the signed-in student's personal calendar. */
postRoutes.post(
  '/:id/interest',
  requireAuth,
  wrap((req, res) => {
    const post = get('SELECT id FROM posts WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!post) throw notFound('Post not found');
    const existing = get('SELECT 1 AS x FROM post_interests WHERE user_id = ? AND post_id = ?', [req.user.id, post.id]);
    if (existing) {
      run('DELETE FROM post_interests WHERE user_id = ? AND post_id = ?', [req.user.id, post.id]);
      return res.json({ interested: false });
    }
    run('INSERT INTO post_interests (user_id, post_id) VALUES (?, ?)', [req.user.id, post.id]);
    res.json({ interested: true });
  }),
);

/** One-tap "Add to Calendar" — a plain .ics file, no third-party service. */
postRoutes.get(
  '/:id/calendar.ics',
  wrap((req, res) => {
    const post = get(`${SELECT_POST} WHERE p.id = ? AND p.deleted = 0`, [req.params.id]);
    if (!post) throw notFound('Post not found');
    if (!post.starts_at) throw bad('This post has no date to add');

    const stamp = (v) => new Date(toIso(v)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const escape = (v) => String(v || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//UTG Connect//MVP//EN',
      'BEGIN:VEVENT',
      `UID:utg-connect-post-${post.id}@utg.edu.gm`,
      `DTSTAMP:${stamp(post.created_at)}`,
      `DTSTART:${stamp(post.starts_at)}`,
      `DTEND:${stamp(post.ends_at || post.starts_at)}`,
      `SUMMARY:${escape(post.title)}`,
      `DESCRIPTION:${escape(`${post.body}\n\nPosted by ${post.school_name} on UTG Connect`)}`,
      `LOCATION:${escape(post.location)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="utg-${post.id}.ics"`);
    res.send(ics);
  }),
);

postRoutes.post(
  '/',
  requireAuth,
  wrap((req, res) => {
    need(req.body, 'schoolCode', 'title');
    const school = findSchool(req.body.schoolCode);
    if (!school) throw notFound('No such school page');
    assertCanPostTo(req.user, school.id);

    const kind = oneOf(req.body.kind || 'announcement', KINDS, 'kind');
    if (kind !== 'announcement' && !req.body.startsAt) {
      throw bad('Events, deadlines and payment dates need a date so the countdown works');
    }
    // Admins bypass their own queue; council posts wait for the light check.
    const status = req.user.role === 'admin' || !config.requirePostApproval ? 'published' : 'pending';

    const info = run(
      `INSERT INTO posts (school_id, author_id, title, body, kind, starts_at, ends_at, location, image_url, document_url, document_name, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        school.id,
        req.user.id,
        req.body.title,
        req.body.body || '',
        kind,
        toSqlTime(req.body.startsAt),
        toSqlTime(req.body.endsAt),
        req.body.location || null,
        req.body.imageUrl || null,
        req.body.documentUrl || null,
        req.body.documentName || null,
        status,
      ],
    );
    const post = get(`${SELECT_POST} WHERE p.id = ?`, [Number(info.lastInsertRowid)]);
    res.status(201).json({ post: shapePost(post), awaitingApproval: status === 'pending' });
  }),
);

postRoutes.patch(
  '/:id/approve',
  requireAuth,
  wrap((req, res) => {
    if (req.user.role !== 'admin') throw bad('Only an admin can approve posts');
    const post = get(`${SELECT_POST} WHERE p.id = ?`, [req.params.id]);
    if (!post) throw notFound('Post not found');
    const decision = oneOf(req.body?.decision || 'approve', ['approve', 'reject'], 'decision');
    run("UPDATE posts SET status = ?, updated_at = datetime('now') WHERE id = ?", [
      decision === 'approve' ? 'published' : 'rejected',
      post.id,
    ]);

    if (decision === 'approve') {
      // Everyone whose default school this is gets pinged about a real deadline.
      const audience = all('SELECT id FROM users WHERE school_id = ? AND id != ?', [post.school_id, post.author_id]).map((u) => u.id);
      notifyMany(
        audience,
        'post',
        `${post.school_code}: ${post.title}${post.starts_at ? ` — ${countdownLabel(post.starts_at)}` : ''}`,
        `/post?id=${post.id}`,
      );
    }
    res.json({ ok: true, status: decision === 'approve' ? 'published' : 'rejected' });
  }),
);

postRoutes.delete(
  '/:id',
  requireAuth,
  wrap((req, res) => {
    const post = get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    if (!post) throw notFound('Post not found');
    if (req.user.role !== 'admin') assertCanPostTo(req.user, post.school_id);
    run("UPDATE posts SET deleted = 1, updated_at = datetime('now') WHERE id = ?", [post.id]);
    res.json({ ok: true });
  }),
);
