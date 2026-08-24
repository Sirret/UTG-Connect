import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, need, notFound, notify, oneOf, toIso, wrap } from '../util.js';

export const adminRoutes = Router();

adminRoutes.use(requireAuth, requireRole('admin'));

adminRoutes.get(
  '/overview',
  wrap((req, res) => {
    res.json({
      pendingPosts: get("SELECT COUNT(*) AS n FROM posts WHERE status = 'pending' AND deleted = 0").n,
      openReports: get("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").n,
      students: get("SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND verified = 1").n,
      councils: get("SELECT COUNT(*) AS n FROM users WHERE role = 'council'").n,
      activeListings: get("SELECT COUNT(*) AS n FROM listings WHERE status = 'active'").n,
      openRentals: get("SELECT COUNT(*) AS n FROM rentals WHERE status NOT IN ('closed')").n,
      bannedUsers: get('SELECT COUNT(*) AS n FROM users WHERE banned = 1').n,
    });
  }),
);

adminRoutes.get(
  '/reports',
  wrap((req, res) => {
    const status = req.query.status || 'open';
    const rows = all(
      `SELECT rp.*, rep.username AS reporter_username, rep.name AS reporter_name,
              acc.username AS accused_username, acc.name AS accused_name
       FROM reports rp
       JOIN users rep ON rep.id = rp.reporter_id
       JOIN users acc ON acc.id = rp.accused_id
       WHERE rp.status = ? ORDER BY rp.created_at DESC`,
      [status],
    );
    res.json({
      reports: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        evidenceUrl: r.evidence_url,
        status: r.status,
        rentalId: r.rental_id,
        adminNote: r.admin_note,
        createdAt: toIso(r.created_at),
        reporter: { username: r.reporter_username, name: r.reporter_name },
        accused: { username: r.accused_username, name: r.accused_name },
        // Both sides' photos travel with the report so the admin rules on evidence.
        conditionPhotos: r.rental_id
          ? all('SELECT phase, photo_url, note, user_id FROM condition_photos WHERE rental_id = ? ORDER BY id', [r.rental_id])
          : [],
      })),
    });
  }),
);

/**
 * Ruling on a report. Upholding it bans the accused; finding it fabricated bans
 * the person who filed it — reporting cuts both ways, so it cannot be weaponised.
 */
adminRoutes.patch(
  '/reports/:id',
  wrap((req, res) => {
    const report = get('SELECT * FROM reports WHERE id = ?', [req.params.id]);
    if (!report) throw notFound('Report not found');
    if (report.status !== 'open') throw bad('This report was already ruled on');

    const verdict = oneOf(req.body?.verdict, ['upheld', 'fabricated'], 'verdict');
    const note = req.body?.note || '';

    run("UPDATE reports SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?", [
      verdict,
      note,
      req.user.id,
      report.id,
    ]);

    const targetId = verdict === 'upheld' ? report.accused_id : report.reporter_id;
    const reason =
      verdict === 'upheld'
        ? `Upheld report: ${report.reason}`
        : 'Filing a fabricated report (disorderly conduct)';

    run("UPDATE users SET banned = 1, ban_reason = ?, banned_at = datetime('now') WHERE id = ?", [reason, targetId]);
    notify(targetId, 'ban', `Your account was banned. Reason: ${reason}`, '/banlist');

    if (report.rental_id) {
      run("UPDATE rentals SET status = 'closed', updated_at = datetime('now') WHERE id = ?", [report.rental_id]);
    }
    res.json({ ok: true, verdict, bannedUserId: targetId });
  }),
);

adminRoutes.post(
  '/users/:username/unban',
  wrap((req, res) => {
    const user = get('SELECT * FROM users WHERE username = ?', [String(req.params.username).toLowerCase()]);
    if (!user) throw notFound('No such user');
    run('UPDATE users SET banned = 0, ban_reason = NULL, banned_at = NULL WHERE id = ?', [user.id]);
    res.json({ ok: true });
  }),
);

/** Create the permanent council account for a school. */
adminRoutes.post(
  '/council-accounts',
  wrap(async (req, res) => {
    need(req.body, 'schoolCode', 'email', 'password');
    const bcrypt = (await import('bcryptjs')).default;
    const school = get('SELECT * FROM schools WHERE code = ?', [String(req.body.schoolCode).toUpperCase()]);
    if (!school) throw notFound('No such school');

    const email = String(req.body.email).trim().toLowerCase();
    const username = `${school.code.toLowerCase()}-council`;
    if (get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username])) {
      throw bad('That council account already exists');
    }
    run(
      `INSERT INTO users (email, password_hash, name, username, role, school_id, verified, bio)
       VALUES (?, ?, ?, ?, 'council', ?, 1, ?)`,
      [
        email,
        bcrypt.hashSync(String(req.body.password), 10),
        `${school.name} Council`,
        username,
        school.id,
        'Official council account — stays with the council, not the officer.',
      ],
    );
    res.status(201).json({ ok: true, username, email });
  }),
);

adminRoutes.get(
  '/users',
  wrap((req, res) => {
    const rows = all(`
      SELECT u.id, u.name, u.username, u.email, u.role, u.verified, u.banned, u.created_at, s.code AS school
      FROM users u LEFT JOIN schools s ON s.id = u.school_id ORDER BY u.created_at DESC LIMIT 200
    `);
    res.json({ users: rows.map((u) => ({ ...u, verified: !!u.verified, banned: !!u.banned, createdAt: toIso(u.created_at) })) });
  }),
);
