import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { get, run } from '../db.js';
import { publicUser, requireAuth, sign } from '../auth.js';
import { bad, need, token, wrap } from '../util.js';

export const authRoutes = Router();

const emailOk = (email) =>
  config.allowAnyEmail || email.toLowerCase().endsWith(`@${config.emailDomain.toLowerCase()}`);

authRoutes.post(
  '/signup',
  wrap((req, res) => {
    const { email, password, name, username, schoolCode, whatsapp } = req.body || {};
    need(req.body, 'email', 'password', 'name', 'username', 'schoolCode');

    const cleanEmail = String(email).trim().toLowerCase();
    if (!emailOk(cleanEmail)) {
      throw bad(
        `Sign-up is limited to UTG students — use your @${config.emailDomain} address.`,
        { domain: config.emailDomain },
      );
    }
    if (String(password).length < 8) throw bad('Password must be at least 8 characters');

    const cleanUsername = String(username).trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
    if (cleanUsername.length < 3) throw bad('Username must be at least 3 usable characters');

    const school = get('SELECT * FROM schools WHERE code = ? AND active = 1', [String(schoolCode).toUpperCase()]);
    if (!school) throw bad('Pick a valid school');

    if (get('SELECT id FROM users WHERE email = ?', [cleanEmail])) throw bad('That email already has an account');
    if (get('SELECT id FROM users WHERE username = ?', [cleanUsername])) throw bad('That username is taken');

    const verifyToken = token();
    const info = run(
      `INSERT INTO users (email, password_hash, name, username, role, school_id, whatsapp, verified, verify_token)
       VALUES (?, ?, ?, ?, 'student', ?, ?, 0, ?)`,
      [cleanEmail, bcrypt.hashSync(String(password), 10), String(name).trim(), cleanUsername, school.id, whatsapp || null, verifyToken],
    );

    // No mail server in the MVP: the token is logged, and optionally returned so
    // the flow can be walked end to end without email infrastructure.
    console.log(`[verify] ${cleanEmail} -> /api/auth/verify?token=${verifyToken}`);
    res.status(201).json({
      ok: true,
      userId: Number(info.lastInsertRowid),
      message: `We sent a verification link to ${cleanEmail}.`,
      verifyToken: config.devReturnVerifyToken ? verifyToken : undefined,
    });
  }),
);

authRoutes.post(
  '/verify',
  wrap((req, res) => {
    const t = req.body?.token || req.query.token;
    if (!t) throw bad('Missing token');
    const user = get('SELECT * FROM users WHERE verify_token = ?', [t]);
    if (!user) throw bad('That verification link is not valid');
    run('UPDATE users SET verified = 1, verify_token = NULL WHERE id = ?', [user.id]);
    const fresh = get('SELECT u.*, s.code AS school_code FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = ?', [user.id]);
    res.json({ ok: true, token: sign(fresh), user: publicUser(fresh) });
  }),
);

authRoutes.post(
  '/login',
  wrap((req, res) => {
    need(req.body, 'email', 'password');
    const email = String(req.body.email).trim().toLowerCase();
    const user = get(
      'SELECT u.*, s.code AS school_code FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.email = ?',
      [email],
    );
    if (!user || !bcrypt.compareSync(String(req.body.password), user.password_hash)) {
      throw bad('Email or password is wrong');
    }
    if (user.banned) throw bad(`This account is banned: ${user.ban_reason || 'disorderly conduct'}`);
    if (!user.verified) {
      throw bad('Verify your university email first', {
        needsVerification: true,
        verifyToken: config.devReturnVerifyToken ? user.verify_token : undefined,
      });
    }
    res.json({ token: sign(user), user: publicUser(user) });
  }),
);

authRoutes.get(
  '/me',
  requireAuth,
  wrap((req, res) => {
    const unread = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', [req.user.id]).n;
    res.json({ user: publicUser(req.user), unreadNotifications: unread });
  }),
);

authRoutes.patch(
  '/me',
  requireAuth,
  wrap((req, res) => {
    const { name, bio, whatsapp, avatarUrl, schoolCode } = req.body || {};
    let schoolId = req.user.school_id;
    if (schoolCode) {
      const school = get('SELECT id FROM schools WHERE code = ? AND active = 1', [String(schoolCode).toUpperCase()]);
      if (!school) throw bad('Unknown school');
      schoolId = school.id;
    }
    run(
      `UPDATE users SET name = ?, bio = ?, whatsapp = ?, avatar_url = ?, school_id = ? WHERE id = ?`,
      [
        name ?? req.user.name,
        bio ?? req.user.bio,
        whatsapp ?? req.user.whatsapp,
        avatarUrl ?? req.user.avatar_url,
        schoolId,
        req.user.id,
      ],
    );
    const fresh = get('SELECT u.*, s.code AS school_code FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = ?', [req.user.id]);
    res.json({ user: publicUser(fresh) });
  }),
);
