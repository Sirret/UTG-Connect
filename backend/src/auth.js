import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { get } from './db.js';

export const sign = (user) =>
  jwt.sign({ id: user.id, role: user.role }, config.jwtSecret, { expiresIn: '30d' });

export const publicUser = (u) =>
  u && {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    schoolId: u.school_id,
    schoolCode: u.school_code ?? null,
    bio: u.bio,
    avatarUrl: u.avatar_url,
    whatsapp: u.whatsapp,
    verified: !!u.verified,
    banned: !!u.banned,
    createdAt: u.created_at,
  };

/** Attaches req.user when a valid bearer token is present. Never rejects. */
export function attachUser(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const claims = jwt.verify(token, config.jwtSecret);
      const row = get(
        `SELECT u.*, s.code AS school_code FROM users u
         LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = ?`,
        [claims.id],
      );
      if (row) req.user = row;
    } catch {
      /* expired or forged — treated as anonymous */
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  if (req.user.banned) return res.status(403).json({ error: 'Account banned', reason: req.user.ban_reason });
  if (!req.user.verified) return res.status(403).json({ error: 'Verify your university email first' });
  next();
}

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed for your account type' });
    next();
  };
