import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, notFound, notify, toIso, wrap } from '../util.js';

export const messageRoutes = Router();
messageRoutes.use(requireAuth);

/** One thread per pair of accounts, however they first message each other —
 * from a story, a listing, or anywhere else "Message" appears. */
const findOrCreateConversation = (userA, userB) => {
  const [a, b] = [userA, userB].sort((x, y) => x - y);
  const existing = get('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?', [a, b]);
  if (existing) return existing;
  const info = run('INSERT INTO conversations (user_a, user_b) VALUES (?, ?)', [a, b]);
  return get('SELECT * FROM conversations WHERE id = ?', [Number(info.lastInsertRowid)]);
};

const otherUserId = (conv, me) => (conv.user_a === me ? conv.user_b : conv.user_a);

/** The inbox: every conversation this account is part of, newest message
 * first, with the other person's identity and how many are unread. */
messageRoutes.get(
  '/',
  wrap((req, res) => {
    const rows = all(
      `SELECT c.id AS conversation_id,
              CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END AS other_id,
              (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
              (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.read = 0) AS unread
       FROM conversations c
       WHERE (c.user_a = ? OR c.user_b = ?) AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
       ORDER BY last_at DESC`,
      [req.user.id, req.user.id, req.user.id, req.user.id],
    );
    const others = new Map(
      all(
        `SELECT id, name, username, avatar_url, role FROM users WHERE id IN (${rows.map(() => '?').join(',') || 'NULL'})`,
        rows.map((r) => r.other_id),
      ).map((u) => [u.id, u]),
    );
    res.json({
      conversations: rows.map((r) => {
        const u = others.get(r.other_id);
        return {
          with: { id: u.id, name: u.name, username: u.username, avatarUrl: u.avatar_url, role: u.role },
          lastMessage: r.last_body,
          lastAt: toIso(r.last_at),
          unread: r.unread,
        };
      }),
      unreadTotal: rows.reduce((n, r) => n + r.unread, 0),
    });
  }),
);

/** Just the unread count — cheap enough to poll for a header badge. */
messageRoutes.get(
  '/unread-count',
  wrap((req, res) => {
    const n = get(
      `SELECT COUNT(*) AS n FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE (c.user_a = ? OR c.user_b = ?) AND m.sender_id != ? AND m.read = 0`,
      [req.user.id, req.user.id, req.user.id],
    ).n;
    res.json({ unread: n });
  }),
);

/** The thread with one specific person — also marks their messages read. */
messageRoutes.get(
  '/:userId',
  wrap((req, res) => {
    const other = get('SELECT id, name, username, avatar_url, role FROM users WHERE id = ?', [req.params.userId]);
    if (!other) throw notFound('No such account');
    const conv = findOrCreateConversation(req.user.id, other.id);
    run('UPDATE messages SET read = 1 WHERE conversation_id = ? AND sender_id != ?', [conv.id, req.user.id]);
    const rows = all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', [conv.id]);
    res.json({
      with: { id: other.id, name: other.name, username: other.username, avatarUrl: other.avatar_url, role: other.role },
      messages: rows.map((m) => ({ id: m.id, body: m.body, mine: m.sender_id === req.user.id, createdAt: toIso(m.created_at) })),
    });
  }),
);

messageRoutes.post(
  '/:userId',
  wrap((req, res) => {
    const other = get('SELECT id, name FROM users WHERE id = ?', [req.params.userId]);
    if (!other) throw notFound('No such account');
    if (other.id === req.user.id) throw bad('You cannot message yourself');
    const body = String(req.body?.body || '').trim();
    if (!body) throw bad('Message cannot be empty');

    const conv = findOrCreateConversation(req.user.id, other.id);
    const info = run('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)', [conv.id, req.user.id, body]);
    notify(other.id, 'message', `${req.user.name} sent you a message`, `/messages?with=${req.user.id}`);

    const row = get('SELECT * FROM messages WHERE id = ?', [Number(info.lastInsertRowid)]);
    res.status(201).json({ message: { id: row.id, body: row.body, mine: true, createdAt: toIso(row.created_at) } });
  }),
);
