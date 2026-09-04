import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { shapeListing } from './listings.js';
import { shapePost } from './posts.js';
import { toIso, wrap } from '../util.js';

export const meRoutes = Router();

/** The one-way switch from plain student (buyer) to student-and-seller.
 * Selling is a deliberate opt-in, not something every account can already do. */
meRoutes.post(
  '/become-seller',
  requireAuth,
  wrap((req, res) => {
    run('UPDATE users SET is_seller = 1 WHERE id = ?', [req.user.id]);
    res.json({ ok: true, isSeller: true });
  }),
);

/** Everything on the signed-in student's personal calendar — every post they
 * hit "Add to calendar" on, soonest first. */
meRoutes.get(
  '/calendar',
  requireAuth,
  wrap((req, res) => {
    const rows = all(
      `SELECT p.*, s.code AS school_code, s.name AS school_name, s.color AS school_color,
              u.name AS author_name
       FROM post_interests x
       JOIN posts p   ON p.id = x.post_id
       JOIN schools s ON s.id = p.school_id
       JOIN users u   ON u.id = p.author_id
       WHERE x.user_id = ? AND p.deleted = 0
       ORDER BY p.starts_at ASC`,
      [req.user.id],
    );
    res.json({ posts: rows.map((p) => shapePost(p, { interested: true })) });
  }),
);

meRoutes.get(
  '/saves',
  requireAuth,
  wrap((req, res) => {
    const rows = all(
      `SELECT l.*, u.username AS seller_username, u.name AS seller_name, u.avatar_url AS seller_avatar,
              s.code AS school_code, s.name AS school_name, s.color AS school_color,
              (SELECT COUNT(*) FROM saves sv WHERE sv.listing_id = l.id) AS save_count
       FROM saves x
       JOIN listings l ON l.id = x.listing_id
       JOIN users u    ON u.id = l.seller_id
       LEFT JOIN schools s ON s.id = l.school_id
       WHERE x.user_id = ? ORDER BY x.created_at DESC`,
      [req.user.id],
    );
    res.json({ listings: rows.map((l) => shapeListing(l, { saved: true })) });
  }),
);

meRoutes.get(
  '/listings',
  requireAuth,
  wrap((req, res) => {
    const rows = all(
      `SELECT l.*, u.username AS seller_username, u.name AS seller_name, u.avatar_url AS seller_avatar,
              s.code AS school_code, s.name AS school_name, s.color AS school_color,
              (SELECT COUNT(*) FROM saves sv WHERE sv.listing_id = l.id) AS save_count,
              (SELECT COUNT(*) FROM offers o WHERE o.listing_id = l.id AND o.status = 'pending') AS pending_offers
       FROM listings l JOIN users u ON u.id = l.seller_id
       LEFT JOIN schools s ON s.id = l.school_id
       WHERE l.seller_id = ? AND l.status != 'removed' ORDER BY l.created_at DESC`,
      [req.user.id],
    );
    res.json({ listings: rows.map((l) => shapeListing(l, { pendingOffers: l.pending_offers })) });
  }),
);

/** Offers I made, and offers waiting on me. */
meRoutes.get(
  '/offers',
  requireAuth,
  wrap((req, res) => {
    const sent = all(
      `SELECT o.*, l.title, l.currency, l.id AS listing_id, u.name AS seller_name, u.username AS seller_username
       FROM offers o JOIN listings l ON l.id = o.listing_id JOIN users u ON u.id = l.seller_id
       WHERE o.buyer_id = ? ORDER BY o.created_at DESC`,
      [req.user.id],
    );
    const received = all(
      `SELECT o.*, l.title, l.currency, l.id AS listing_id, u.name AS buyer_name, u.username AS buyer_username
       FROM offers o JOIN listings l ON l.id = o.listing_id JOIN users u ON u.id = o.buyer_id
       WHERE l.seller_id = ? ORDER BY o.status = 'pending' DESC, o.created_at DESC`,
      [req.user.id],
    );
    const base = (o) => ({
      id: o.id,
      listingId: o.listing_id,
      title: o.title,
      amount: o.amount,
      currency: o.currency,
      message: o.message,
      status: o.status,
      createdAt: toIso(o.created_at),
    });
    res.json({
      sent: sent.map((o) => ({ ...base(o), seller: { name: o.seller_name, username: o.seller_username } })),
      received: received.map((o) => ({ ...base(o), buyer: { name: o.buyer_name, username: o.buyer_username } })),
    });
  }),
);

meRoutes.get(
  '/following',
  requireAuth,
  wrap((req, res) => {
    const rows = all(
      `SELECT u.username, u.name, u.avatar_url,
              (SELECT COUNT(*) FROM listings l WHERE l.seller_id = u.id AND l.status = 'active') AS active_listings
       FROM follows f JOIN users u ON u.id = f.seller_id WHERE f.follower_id = ?`,
      [req.user.id],
    );
    res.json({ sellers: rows.map((r) => ({ username: r.username, name: r.name, avatarUrl: r.avatar_url, activeListings: r.active_listings })) });
  }),
);

meRoutes.get(
  '/notifications',
  requireAuth,
  wrap((req, res) => {
    const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        text: n.text,
        link: n.link,
        read: !!n.read,
        createdAt: toIso(n.created_at),
      })),
      unread: rows.filter((n) => !n.read).length,
    });
  }),
);

meRoutes.post(
  '/notifications/read',
  requireAuth,
  wrap((req, res) => {
    run('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ ok: true });
  }),
);

/**
 * One call the client makes on wake-up: everything that changed since its last
 * sync. This is what keeps repeat visits cheap on mobile data — the client
 * already holds the rest in localStorage.
 */
meRoutes.get(
  '/sync',
  wrap((req, res) => {
    const since = req.query.since;
    const params = since ? [since.replace('T', ' ').slice(0, 19)] : [];
    const clause = since ? 'AND updated_at > ?' : '';

    const posts = get(`SELECT COUNT(*) AS n FROM posts WHERE status = 'published' AND deleted = 0 ${clause}`, params).n;
    const listings = get(`SELECT COUNT(*) AS n FROM listings WHERE status IN ('active','scheduled') ${clause}`, params).n;
    const unread = req.user
      ? get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', [req.user.id]).n
      : 0;

    res.json({ changedPosts: posts, changedListings: listings, unreadNotifications: unread, syncedAt: new Date().toISOString() });
  }),
);
