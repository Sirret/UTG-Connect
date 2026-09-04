import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, need, notFound, sendCached, toIso, wrap } from '../util.js';

export const socialRoutes = Router();

const shapeSocialPost = (p, opts = {}) => ({
  id: p.id,
  caption: p.caption,
  imageUrl: p.image_url,
  createdAt: toIso(p.created_at),
  author: { id: p.author_id, name: p.author_name, username: p.author_username, avatarUrl: p.author_avatar },
  likeCount: p.like_count,
  commentCount: p.comment_count,
  liked: !!opts.liked,
});

const SELECT_SOCIAL = `
  SELECT sp.*, u.name AS author_name, u.username AS author_username, u.avatar_url AS author_avatar,
         (SELECT COUNT(*) FROM social_likes sl WHERE sl.post_id = sp.id) AS like_count,
         (SELECT COUNT(*) FROM social_comments sc WHERE sc.post_id = sp.id) AS comment_count
  FROM social_posts sp
  JOIN users u ON u.id = sp.author_id
`;

const shapeComment = (c) => ({
  id: c.id,
  body: c.body,
  createdAt: toIso(c.created_at),
  author: { id: c.author_id, name: c.author_name, username: c.author_username, avatarUrl: c.author_avatar },
});

const SELECT_COMMENT = `
  SELECT c.*, u.name AS author_name, u.username AS author_username, u.avatar_url AS author_avatar
  FROM social_comments c
  JOIN users u ON u.id = c.author_id
`;

/** Newest first, like any social feed. No school scoping — this tab is
 * campus-wide by design, the informal counterpart to the Hub. */
socialRoutes.get(
  '/',
  wrap((req, res) => {
    const limit = Math.min(Number(req.query.limit) || 40, 100);
    const rows = all(`${SELECT_SOCIAL} WHERE sp.deleted = 0 ORDER BY sp.created_at DESC LIMIT ?`, [limit]);
    const liked = req.user
      ? new Set(all('SELECT post_id FROM social_likes WHERE user_id = ?', [req.user.id]).map((r) => r.post_id))
      : new Set();
    sendCached(req, res, { posts: rows.map((p) => shapeSocialPost(p, { liked: liked.has(p.id) })) }, 15);
  }),
);

socialRoutes.post(
  '/',
  requireAuth,
  wrap((req, res) => {
    need(req.body, 'imageUrl');
    const info = run('INSERT INTO social_posts (author_id, caption, image_url) VALUES (?, ?, ?)', [
      req.user.id,
      req.body.caption || '',
      req.body.imageUrl,
    ]);
    const row = get(`${SELECT_SOCIAL} WHERE sp.id = ?`, [Number(info.lastInsertRowid)]);
    res.status(201).json({ post: shapeSocialPost(row, { liked: false }) });
  }),
);

socialRoutes.delete(
  '/:id',
  requireAuth,
  wrap((req, res) => {
    const row = get('SELECT * FROM social_posts WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!row) throw notFound('Post not found');
    if (row.author_id !== req.user.id && req.user.role !== 'admin') throw bad('You can only delete your own posts');
    run('UPDATE social_posts SET deleted = 1 WHERE id = ?', [row.id]);
    res.json({ ok: true });
  }),
);

/** Like/unlike toggle — same shape as `saves` and `post_interests`. */
socialRoutes.post(
  '/:id/like',
  requireAuth,
  wrap((req, res) => {
    const row = get('SELECT id FROM social_posts WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!row) throw notFound('Post not found');
    const existing = get('SELECT 1 AS x FROM social_likes WHERE user_id = ? AND post_id = ?', [req.user.id, row.id]);
    if (existing) {
      run('DELETE FROM social_likes WHERE user_id = ? AND post_id = ?', [req.user.id, row.id]);
      return res.json({ liked: false });
    }
    run('INSERT INTO social_likes (user_id, post_id) VALUES (?, ?)', [req.user.id, row.id]);
    res.json({ liked: true });
  }),
);

socialRoutes.get(
  '/:id/comments',
  wrap((req, res) => {
    const rows = all(`${SELECT_COMMENT} WHERE c.post_id = ? ORDER BY c.created_at ASC`, [req.params.id]);
    res.json({ comments: rows.map(shapeComment) });
  }),
);

socialRoutes.post(
  '/:id/comments',
  requireAuth,
  wrap((req, res) => {
    need(req.body, 'body');
    const post = get('SELECT id FROM social_posts WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!post) throw notFound('Post not found');
    const body = String(req.body.body).trim();
    if (!body) throw bad('Comment cannot be empty');
    const info = run('INSERT INTO social_comments (post_id, author_id, body) VALUES (?, ?, ?)', [post.id, req.user.id, body]);
    const row = get(`${SELECT_COMMENT} WHERE c.id = ?`, [Number(info.lastInsertRowid)]);
    res.status(201).json({ comment: shapeComment(row) });
  }),
);
