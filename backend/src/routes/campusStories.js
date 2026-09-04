import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { assertCanPostTo, findSchool } from './schools.js';
import { bad, need, notFound, sendCached, toIso, wrap } from '../util.js';

export const campusStoryRoutes = Router();

const shape = (s) => ({
  id: s.id,
  text: s.text,
  imageUrl: s.image_url,
  createdAt: toIso(s.created_at),
  expiresAt: toIso(s.expires_at),
  school: { id: s.school_id, code: s.school_code, name: s.school_name, color: s.school_color },
  author: { id: s.author_id, name: s.author_name },
});

const SELECT_STORY = `
  SELECT st.*, s.code AS school_code, s.name AS school_name, s.color AS school_color, u.name AS author_name
  FROM school_stories st
  JOIN schools s ON s.id = st.school_id
  JOIN users u   ON u.id = st.author_id
`;

/** A status, not content — every school's active ones, soonest-expiring
 * last, so the rail reads newest-first like any other story tray. */
campusStoryRoutes.get(
  '/',
  wrap((req, res) => {
    run("DELETE FROM school_stories WHERE expires_at <= datetime('now')");
    const rows = all(`${SELECT_STORY} WHERE st.expires_at > datetime('now') ORDER BY st.created_at DESC`);
    sendCached(req, res, { stories: rows.map(shape) }, 30);
  }),
);

campusStoryRoutes.post(
  '/',
  requireAuth,
  wrap((req, res) => {
    need(req.body, 'schoolCode');
    if (!req.body.text && !req.body.imageUrl) throw bad('A status needs a photo or a line of text');
    const school = findSchool(req.body.schoolCode);
    if (!school) throw notFound('No such school page');
    assertCanPostTo(req.user, school.id);

    const info = run(
      `INSERT INTO school_stories (school_id, author_id, text, image_url, expires_at)
       VALUES (?, ?, ?, ?, datetime('now', '+1 day'))`,
      [school.id, req.user.id, req.body.text || '', req.body.imageUrl || null],
    );
    const row = get(`${SELECT_STORY} WHERE st.id = ?`, [Number(info.lastInsertRowid)]);
    res.status(201).json({ story: shape(row) });
  }),
);

campusStoryRoutes.delete(
  '/:id',
  requireAuth,
  wrap((req, res) => {
    const row = get('SELECT * FROM school_stories WHERE id = ?', [req.params.id]);
    if (!row) throw notFound('Story not found');
    if (req.user.role !== 'admin') assertCanPostTo(req.user, row.school_id);
    run('DELETE FROM school_stories WHERE id = ?', [row.id]);
    res.json({ ok: true });
  }),
);
