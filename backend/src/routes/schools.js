import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, forbidden, need, notFound, sendCached, wrap } from '../util.js';

export const schoolRoutes = Router();

const shape = (s) => ({
  id: s.id,
  code: s.code,
  name: s.name,
  color: s.color,
  logoUrl: s.logo_url,
  campusWide: !!s.is_campus_wide,
});

export const findSchool = (code) =>
  get('SELECT * FROM schools WHERE code = ? AND active = 1', [String(code).toUpperCase()]);

/** A council account may only post to its own school; admin may post anywhere. */
export function assertCanPostTo(user, schoolId) {
  if (user.role === 'admin') return;
  if (user.role === 'council' && user.school_id === schoolId) return;
  throw forbidden('Only that school’s official council account can post here');
}

schoolRoutes.get(
  '/',
  wrap((req, res) => {
    const schools = all('SELECT * FROM schools WHERE active = 1 ORDER BY is_campus_wide DESC, name').map(shape);
    sendCached(req, res, { schools }, 300);
  }),
);

/**
 * The "Today" activity strip: one row per school with a flag for new posts in
 * the last 24h. Static payload, tiny on purpose.
 */
schoolRoutes.get(
  '/activity',
  wrap((req, res) => {
    const rows = all(`
      SELECT s.*,
             (SELECT COUNT(*) FROM posts p
               WHERE p.school_id = s.id AND p.status = 'published' AND p.deleted = 0
                 AND p.created_at >= datetime('now', '-1 day')) AS new_posts,
             (SELECT MAX(created_at) FROM posts p
               WHERE p.school_id = s.id AND p.status = 'published' AND p.deleted = 0) AS last_post_at
      FROM schools s WHERE s.active = 1
      ORDER BY new_posts DESC, s.is_campus_wide DESC, s.name
    `);
    sendCached(
      req,
      res,
      {
        schools: rows.map((r) => ({ ...shape(r), newPosts: r.new_posts, hasNew: r.new_posts > 0, lastPostAt: r.last_post_at })),
      },
      60,
    );
  }),
);

schoolRoutes.get(
  '/:code',
  wrap((req, res) => {
    const school = findSchool(req.params.code);
    if (!school) throw notFound('No such school page');
    const council = all('SELECT * FROM council_members WHERE school_id = ? ORDER BY sort_order, id', [school.id]);
    const councilAccount = get("SELECT name, email, username FROM users WHERE school_id = ? AND role = 'council'", [school.id]);
    sendCached(req, res, {
      school: shape(school),
      councilAccount,
      council: council.map((c) => ({
        id: c.id,
        name: c.name,
        position: c.position,
        handles: c.handles,
        contact: c.contact,
        contactKind: c.contact_kind,
      })),
    }, 120);
  }),
);

// --- Council directory (Info tab) -------------------------------------------

schoolRoutes.put(
  '/:code/council',
  requireAuth,
  wrap((req, res) => {
    const school = findSchool(req.params.code);
    if (!school) throw notFound('No such school page');
    assertCanPostTo(req.user, school.id);
    const members = req.body?.members;
    if (!Array.isArray(members)) throw bad('Send { members: [...] }');

    run('DELETE FROM council_members WHERE school_id = ?', [school.id]);
    members.forEach((m, i) => {
      need(m, 'name', 'position');
      run(
        `INSERT INTO council_members (school_id, name, position, handles, contact, contact_kind, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [school.id, m.name, m.position, m.handles || '', m.contact || '', m.contactKind || 'email', i],
      );
    });
    res.json({ ok: true, count: members.length });
  }),
);

// --- Admin add / remove a school page (no approval workflow, by design) ------

schoolRoutes.post(
  '/',
  requireAuth,
  requireRole('admin'),
  wrap((req, res) => {
    need(req.body, 'code', 'name');
    const code = String(req.body.code).toUpperCase().trim();
    if (get('SELECT id FROM schools WHERE code = ?', [code])) {
      run('UPDATE schools SET active = 1, name = ?, color = ? WHERE code = ?', [req.body.name, req.body.color || '#0f766e', code]);
      return res.json({ ok: true, reactivated: true });
    }
    run('INSERT INTO schools (code, name, color, logo_url, is_campus_wide) VALUES (?, ?, ?, ?, ?)', [
      code,
      req.body.name,
      req.body.color || '#0f766e',
      req.body.logoUrl || null,
      req.body.campusWide ? 1 : 0,
    ]);
    res.status(201).json({ ok: true, school: shape(get('SELECT * FROM schools WHERE code = ?', [code])) });
  }),
);

schoolRoutes.patch(
  '/:code',
  requireAuth,
  wrap((req, res) => {
    const school = findSchool(req.params.code);
    if (!school) throw notFound('No such school page');
    assertCanPostTo(req.user, school.id); // council can rebrand its own page
    run("UPDATE schools SET name = ?, color = ?, logo_url = ?, updated_at = datetime('now') WHERE id = ?", [
      req.body?.name ?? school.name,
      req.body?.color ?? school.color,
      req.body?.logoUrl ?? school.logo_url,
      school.id,
    ]);
    res.json({ ok: true, school: shape(get('SELECT * FROM schools WHERE id = ?', [school.id])) });
  }),
);

schoolRoutes.delete(
  '/:code',
  requireAuth,
  requireRole('admin'),
  wrap((req, res) => {
    const school = findSchool(req.params.code);
    if (!school) throw notFound('No such school page');
    run('UPDATE schools SET active = 0 WHERE id = ?', [school.id]);
    res.json({ ok: true });
  }),
);
