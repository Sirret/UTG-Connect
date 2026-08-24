import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { shapeListing } from './listings.js';
import { bad, need, notFound, notify, sendCached, toIso, wrap } from '../util.js';

export const sellerRoutes = Router();

const LISTING_COLS = `
  SELECT l.*, u.username AS seller_username, u.name AS seller_name, u.avatar_url AS seller_avatar,
         s.code AS school_code, s.name AS school_name, s.color AS school_color,
         (SELECT COUNT(*) FROM saves sv WHERE sv.listing_id = l.id) AS save_count
  FROM listings l JOIN users u ON u.id = l.seller_id
  LEFT JOIN schools s ON s.id = l.school_id
`;

/**
 * Trust signals a buyer sees before sending a single message. All derived from
 * data we already have — nothing extra for the seller to fill in.
 */
function badgesFor(sellerId) {
  const stats = get(
    `SELECT
       (SELECT ROUND(AVG(stars), 2) FROM ratings WHERE seller_id = ?)                          AS rating,
       (SELECT COUNT(*) FROM ratings WHERE seller_id = ?)                                      AS rating_count,
       (SELECT COUNT(*) FROM offers o JOIN listings l ON l.id = o.listing_id
         WHERE l.seller_id = ? AND o.status = 'accepted')                                      AS deals,
       (SELECT verified FROM users WHERE id = ?)                                               AS verified`,
    [sellerId, sellerId, sellerId, sellerId],
  );

  const badges = [];
  if (stats.verified) badges.push({ key: 'verified', label: 'Verified', note: 'University email confirmed' });
  if ((stats.rating || 0) >= 4.5 && stats.deals >= 3) {
    badges.push({ key: 'top', label: 'Top Seller', note: `${stats.rating}★ across ${stats.deals} completed deals` });
  }

  // Response time is a stand-in until real message timing exists; it is derived
  // from how quickly this seller answers offers.
  const answered = get(
    `SELECT AVG((julianday(COALESCE(l.updated_at, o.created_at)) - julianday(o.created_at)) * 24) AS hours
     FROM offers o JOIN listings l ON l.id = o.listing_id
     WHERE l.seller_id = ? AND o.status != 'pending'`,
    [sellerId],
  ).hours;

  const responseTime =
    answered === null
      ? 'New seller'
      : answered < 3
        ? 'usually replies within a few hours'
        : answered < 24
          ? 'usually replies within a day'
          : 'replies in a couple of days';

  return { badges, rating: stats.rating, ratingCount: stats.rating_count, deals: stats.deals, responseTime };
}

sellerRoutes.get(
  '/:username',
  wrap((req, res) => {
    const seller = get(
      `SELECT u.*, s.code AS school_code, s.name AS school_name, s.color AS school_color
       FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.username = ?`,
      [String(req.params.username).toLowerCase()],
    );
    if (!seller) throw notFound('No such seller');

    const listings = all(
      `${LISTING_COLS} WHERE l.seller_id = ? AND l.status IN ('active','scheduled') ORDER BY l.created_at DESC`,
      [seller.id],
    );
    const followers = get('SELECT COUNT(*) AS n FROM follows WHERE seller_id = ?', [seller.id]).n;
    const following = req.user
      ? !!get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND seller_id = ?', [req.user.id, seller.id])
      : false;
    const reviews = all(
      `SELECT r.*, u.name AS rater_name FROM ratings r JOIN users u ON u.id = r.rater_id
       WHERE r.seller_id = ? ORDER BY r.created_at DESC LIMIT 10`,
      [seller.id],
    );

    res.json({
      seller: {
        id: seller.id,
        name: seller.name,
        username: seller.username,
        bio: seller.bio,
        avatarUrl: seller.avatar_url,
        banned: !!seller.banned,
        school: seller.school_code ? { code: seller.school_code, name: seller.school_name, color: seller.school_color } : null,
        joinedAt: toIso(seller.created_at),
        followers,
        following,
        ...badgesFor(seller.id),
      },
      listings: listings.map((l) => shapeListing(l)),
      reviews: reviews.map((r) => ({ stars: r.stars, comment: r.comment, by: r.rater_name, at: toIso(r.created_at) })),
    });
  }),
);

sellerRoutes.post(
  '/:username/follow',
  requireAuth,
  wrap((req, res) => {
    const seller = get('SELECT * FROM users WHERE username = ?', [String(req.params.username).toLowerCase()]);
    if (!seller) throw notFound('No such seller');
    if (seller.id === req.user.id) throw bad('You already follow yourself, closely');

    const existing = get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND seller_id = ?', [req.user.id, seller.id]);
    if (existing) {
      run('DELETE FROM follows WHERE follower_id = ? AND seller_id = ?', [req.user.id, seller.id]);
      return res.json({ following: false });
    }
    run('INSERT INTO follows (follower_id, seller_id) VALUES (?, ?)', [req.user.id, seller.id]);
    res.json({ following: true });
  }),
);

sellerRoutes.post(
  '/:username/ratings',
  requireAuth,
  wrap((req, res) => {
    need(req.body, 'stars');
    const seller = get('SELECT * FROM users WHERE username = ?', [String(req.params.username).toLowerCase()]);
    if (!seller) throw notFound('No such seller');
    if (seller.id === req.user.id) throw bad('You cannot rate yourself');

    const stars = Number(req.body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw bad('Stars must be 1–5');

    // Only someone who actually transacted with this seller may rate them.
    const dealt = get(
      `SELECT 1 AS x FROM offers o JOIN listings l ON l.id = o.listing_id
       WHERE l.seller_id = ? AND o.buyer_id = ? AND o.status = 'accepted' LIMIT 1`,
      [seller.id, req.user.id],
    );
    if (!dealt) throw bad('You can only rate a seller after a completed deal');

    run(
      `INSERT INTO ratings (seller_id, rater_id, stars, comment) VALUES (?, ?, ?, ?)
       ON CONFLICT (seller_id, rater_id) DO UPDATE SET stars = excluded.stars, comment = excluded.comment`,
      [seller.id, req.user.id, stars, req.body.comment || ''],
    );
    notify(seller.id, 'rating', `${req.user.name} rated you ${stars}★`, `/seller?u=${seller.username}`);
    res.json({ ok: true, ...badgesFor(seller.id) });
  }),
);

// --- Seller stories (24h) ---------------------------------------------------

export const storyRoutes = Router();

storyRoutes.get(
  '/',
  wrap((req, res) => {
    run("DELETE FROM stories WHERE expires_at <= datetime('now')");
    const rows = all(`
      SELECT st.*, u.username, u.name, u.avatar_url
      FROM stories st JOIN users u ON u.id = st.seller_id
      WHERE st.expires_at > datetime('now') AND u.banned = 0
      ORDER BY st.created_at DESC
    `);
    sendCached(req, res, {
      stories: rows.map((s) => ({
        id: s.id,
        text: s.text,
        listingId: s.listing_id,
        createdAt: toIso(s.created_at),
        seller: { username: s.username, name: s.name, avatarUrl: s.avatar_url },
      })),
    }, 60);
  }),
);

storyRoutes.post(
  '/',
  requireAuth,
  wrap((req, res) => {
    need(req.body, 'text');
    if (String(req.body.text).length > 60) throw bad('Keep a story under 60 characters');
    run(
      `INSERT INTO stories (seller_id, text, listing_id, expires_at)
       VALUES (?, ?, ?, datetime('now', '+1 day'))`,
      [req.user.id, req.body.text, req.body.listingId || null],
    );
    res.status(201).json({ ok: true });
  }),
);
