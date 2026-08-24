import { Router } from 'express';
import { config } from '../config.js';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { findSchool } from './schools.js';
import {
  bad,
  countdownLabel,
  followerIdsOf,
  forbidden,
  need,
  notFound,
  notify,
  notifyMany,
  oneOf,
  sendCached,
  toIso,
  toSqlTime,
  wrap,
} from '../util.js';

export const listingRoutes = Router();

export const SECTIONS = ['goods', 'services', 'rent'];

/** Strict categories per section — a phone charger can't land in the food feed. */
export const CATEGORIES = {
  goods: ['electronics', 'food', 'clothing', 'books', 'beauty', 'furniture', 'phones', 'other'],
  services: ['tutoring', 'hair', 'laundry', 'printing', 'photography', 'dj', 'tailoring', 'design', 'other'],
  rent: ['laptops', 'calculators', 'formal-wear', 'textbooks', 'equipment', 'other'],
};

/** Common meeting points, so nobody has to guess where to hand things over. */
export const PICKUP_POINTS = ['Main Gate', 'Library', 'Cafeteria', 'Hostel A', 'Hostel B', 'Faraba Campus', 'Kanifing Campus'];

const SELECT_LISTING = `
  SELECT l.*, u.username AS seller_username, u.name AS seller_name, u.avatar_url AS seller_avatar,
         u.whatsapp AS seller_whatsapp, u.banned AS seller_banned,
         s.code AS school_code, s.name AS school_name, s.color AS school_color,
         (SELECT COUNT(*) FROM saves sv WHERE sv.listing_id = l.id) AS save_count,
         (SELECT ROUND(AVG(stars), 1) FROM ratings r WHERE r.seller_id = l.seller_id) AS seller_rating,
         (SELECT COUNT(*) FROM ratings r WHERE r.seller_id = l.seller_id) AS seller_rating_count
  FROM listings l
  JOIN users u   ON u.id = l.seller_id
  LEFT JOIN schools s ON s.id = l.school_id
`;

export const shapeListing = (l, extra = {}) => ({
  id: l.id,
  section: l.section,
  category: l.category,
  title: l.title,
  description: l.description,
  price: l.price,
  priceUnit: l.price_unit,
  currency: l.currency,
  deposit: l.deposit,
  imageUrl: l.image_url,
  pickupPoint: l.pickup_point,
  acceptsOffers: !!l.accepts_offers,
  status: l.status,
  dropsAt: toIso(l.drops_at),
  dropCountdown: l.status === 'scheduled' ? countdownLabel(l.drops_at) : null,
  views: l.views,
  saves: l.save_count ?? 0,
  createdAt: toIso(l.created_at),
  updatedAt: toIso(l.updated_at),
  school: l.school_code ? { code: l.school_code, name: l.school_name, color: l.school_color } : null,
  seller: {
    id: l.seller_id,
    username: l.seller_username,
    name: l.seller_name,
    avatarUrl: l.seller_avatar,
    rating: l.seller_rating,
    ratingCount: l.seller_rating_count ?? 0,
    banned: !!l.seller_banned,
  },
  ...extra,
});

/** Flips scheduled drops live once their time arrives. Cheap; runs per request. */
function releaseDueDrops() {
  run("UPDATE listings SET status = 'active', updated_at = datetime('now') WHERE status = 'scheduled' AND drops_at IS NOT NULL AND drops_at <= datetime('now')");
}

// --- Browse & discover ------------------------------------------------------

listingRoutes.get(
  '/',
  wrap((req, res) => {
    releaseDueDrops();
    const { section, category, school, seller, q, searchBy = 'item', min, max, sort = 'new', since, limit = 60 } = req.query;

    const where = ["l.status IN ('active','scheduled')", 'u.banned = 0'];
    const params = [];

    if (section) {
      where.push('l.section = ?');
      params.push(oneOf(section, SECTIONS, 'section'));
    }
    if (category) {
      where.push('l.category = ?');
      params.push(category);
    }
    if (school) {
      const s = findSchool(school);
      if (!s) throw notFound('No such school');
      where.push('l.school_id = ?');
      params.push(s.id);
    }
    if (seller) {
      where.push('u.username = ?');
      params.push(String(seller).toLowerCase());
    }
    if (q) {
      // Search toggles between finding an item and finding a person.
      if (searchBy === 'seller') {
        where.push('(u.username LIKE ? OR u.name LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
      } else {
        where.push('(l.title LIKE ? OR l.description LIKE ? OR l.category LIKE ?)');
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
    }
    if (min) {
      where.push('l.price >= ?');
      params.push(Number(min));
    }
    if (max) {
      where.push('l.price <= ?');
      params.push(Number(max));
    }
    if (since) {
      where.push('l.updated_at > ?');
      params.push(toSqlTime(since));
    }

    // "Trending" weighs saves and views inside a recency window, so it surfaces
    // what people are actually engaging with rather than just the newest post.
    const order =
      sort === 'trending'
        ? `ORDER BY ((SELECT COUNT(*) FROM saves sv WHERE sv.listing_id = l.id) * 4 + l.views) * 1.0
                    / (1 + (julianday('now') - julianday(l.created_at))) DESC, l.created_at DESC`
        : sort === 'price_asc'
          ? 'ORDER BY l.price ASC'
          : sort === 'price_desc'
            ? 'ORDER BY l.price DESC'
            : 'ORDER BY l.created_at DESC';

    const rows = all(`${SELECT_LISTING} WHERE ${where.join(' AND ')} ${order} LIMIT ?`, [
      ...params,
      Math.min(Number(limit) || 60, 200),
    ]);

    const savedIds = req.user
      ? new Set(all('SELECT listing_id FROM saves WHERE user_id = ?', [req.user.id]).map((r) => r.listing_id))
      : new Set();

    sendCached(req, res, { listings: rows.map((l) => shapeListing(l, { saved: savedIds.has(l.id) })) }, 20, {
      syncedAt: new Date().toISOString(),
    });
  }),
);

listingRoutes.get(
  '/meta',
  wrap((req, res) => {
    sendCached(req, res, { sections: SECTIONS, categories: CATEGORIES, pickupPoints: PICKUP_POINTS, depositThreshold: config.depositThreshold }, 3600);
  }),
);

listingRoutes.get(
  '/:id',
  wrap((req, res) => {
    releaseDueDrops();
    const listing = get(`${SELECT_LISTING} WHERE l.id = ?`, [req.params.id]);
    if (!listing) throw notFound('Listing not found');
    run('UPDATE listings SET views = views + 1 WHERE id = ?', [listing.id]);

    const saved = req.user
      ? !!get('SELECT 1 AS x FROM saves WHERE user_id = ? AND listing_id = ?', [req.user.id, listing.id])
      : false;
    const myOffer = req.user
      ? get('SELECT * FROM offers WHERE listing_id = ? AND buyer_id = ? ORDER BY id DESC LIMIT 1', [listing.id, req.user.id])
      : null;

    // "Message Seller" hands off to WhatsApp instead of us building a chat app.
    const whatsappLink = listing.seller_whatsapp
      ? `https://wa.me/${String(listing.seller_whatsapp).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
          `Hi ${listing.seller_name}, I saw "${listing.title}" on UTG Connect — is it still available?`,
        )}`
      : null;

    res.json({
      listing: shapeListing(listing, {
        views: listing.views + 1,
        saved,
        whatsappLink,
        myOffer: myOffer && { id: myOffer.id, amount: myOffer.amount, status: myOffer.status },
      }),
    });
  }),
);

// --- Selling ----------------------------------------------------------------

listingRoutes.post(
  '/',
  requireAuth,
  wrap((req, res) => {
    need(req.body, 'section', 'category', 'title', 'price');
    const section = oneOf(req.body.section, SECTIONS, 'section');
    const category = oneOf(req.body.category, CATEGORIES[section], `category for ${section}`);
    if (!req.body.imageUrl) throw bad('Listings need a photo — image-first is the whole point of the feed');

    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price < 0) throw bad('Price must be a number');

    const schoolId = req.body.schoolCode ? findSchool(req.body.schoolCode)?.id : req.user.school_id;
    const dropsAt = toSqlTime(req.body.dropsAt);
    const scheduled = dropsAt && new Date(req.body.dropsAt).getTime() > Date.now();

    // Rentals over the threshold must carry a deposit the platform will hold.
    let deposit = Number(req.body.deposit || 0);
    if (section === 'rent' && price >= config.depositThreshold && deposit <= 0) {
      throw bad(`Rentals at ${config.depositThreshold} ${req.body.currency || 'GMD'} or above need a refundable deposit`);
    }
    if (section !== 'rent') deposit = 0;

    const info = run(
      `INSERT INTO listings (seller_id, school_id, section, category, title, description, price, price_unit,
                             currency, deposit, image_url, pickup_point, accepts_offers, status, drops_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        schoolId || null,
        section,
        category,
        req.body.title,
        req.body.description || '',
        price,
        req.body.priceUnit || (section === 'rent' ? 'day' : 'item'),
        req.body.currency || 'GMD',
        deposit,
        req.body.imageUrl,
        req.body.pickupPoint || '',
        req.body.acceptsOffers === false ? 0 : 1,
        scheduled ? 'scheduled' : 'active',
        dropsAt,
      ],
    );
    const id = Number(info.lastInsertRowid);

    notifyMany(
      followerIdsOf(req.user.id),
      'listing',
      scheduled
        ? `${req.user.name} scheduled a drop: ${req.body.title} — ${countdownLabel(dropsAt)}`
        : `${req.user.name} posted: ${req.body.title}`,
      `/listing?id=${id}`,
    );

    res.status(201).json({ listing: shapeListing(get(`${SELECT_LISTING} WHERE l.id = ?`, [id])) });
  }),
);

listingRoutes.patch(
  '/:id',
  requireAuth,
  wrap((req, res) => {
    const listing = get('SELECT * FROM listings WHERE id = ?', [req.params.id]);
    if (!listing) throw notFound('Listing not found');
    if (listing.seller_id !== req.user.id && req.user.role !== 'admin') throw forbidden('Not your listing');

    const price = req.body?.price !== undefined ? Number(req.body.price) : listing.price;
    const status = req.body?.status ? oneOf(req.body.status, ['active', 'sold', 'removed', 'scheduled'], 'status') : listing.status;

    run(
      `UPDATE listings SET title = ?, description = ?, price = ?, image_url = ?, pickup_point = ?,
              status = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        req.body?.title ?? listing.title,
        req.body?.description ?? listing.description,
        price,
        req.body?.imageUrl ?? listing.image_url,
        req.body?.pickupPoint ?? listing.pickup_point,
        status,
        listing.id,
      ],
    );

    // Price-drop alert for everyone who saved it — the wishlist promise.
    if (price < listing.price) {
      const watchers = all('SELECT user_id FROM saves WHERE listing_id = ?', [listing.id]).map((r) => r.user_id);
      notifyMany(
        watchers,
        'price_drop',
        `Price dropped on "${listing.title}": ${listing.price} → ${price} ${listing.currency}`,
        `/listing?id=${listing.id}`,
      );
    }
    res.json({ listing: shapeListing(get(`${SELECT_LISTING} WHERE l.id = ?`, [listing.id])) });
  }),
);

listingRoutes.delete(
  '/:id',
  requireAuth,
  wrap((req, res) => {
    const listing = get('SELECT * FROM listings WHERE id = ?', [req.params.id]);
    if (!listing) throw notFound('Listing not found');
    if (listing.seller_id !== req.user.id && req.user.role !== 'admin') throw forbidden('Not your listing');
    run("UPDATE listings SET status = 'removed', updated_at = datetime('now') WHERE id = ?", [listing.id]);
    res.json({ ok: true });
  }),
);

// --- Save / wishlist --------------------------------------------------------

listingRoutes.post(
  '/:id/save',
  requireAuth,
  wrap((req, res) => {
    const listing = get('SELECT * FROM listings WHERE id = ?', [req.params.id]);
    if (!listing) throw notFound('Listing not found');
    const existing = get('SELECT 1 AS x FROM saves WHERE user_id = ? AND listing_id = ?', [req.user.id, listing.id]);
    if (existing) {
      run('DELETE FROM saves WHERE user_id = ? AND listing_id = ?', [req.user.id, listing.id]);
      return res.json({ saved: false });
    }
    run('INSERT INTO saves (user_id, listing_id) VALUES (?, ?)', [req.user.id, listing.id]);
    res.json({ saved: true });
  }),
);

// --- Make an offer ----------------------------------------------------------

listingRoutes.post(
  '/:id/offers',
  requireAuth,
  wrap((req, res) => {
    need(req.body, 'amount');
    const listing = get(`${SELECT_LISTING} WHERE l.id = ?`, [req.params.id]);
    if (!listing) throw notFound('Listing not found');
    if (!listing.accepts_offers) throw bad('This seller is not taking offers');
    if (listing.seller_id === req.user.id) throw bad('You cannot bid on your own listing');

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw bad('Offer must be a positive number');

    const info = run('INSERT INTO offers (listing_id, buyer_id, amount, message) VALUES (?, ?, ?, ?)', [
      listing.id,
      req.user.id,
      amount,
      req.body.message || '',
    ]);
    notify(
      listing.seller_id,
      'offer',
      `${req.user.name} offered ${amount} ${listing.currency} for "${listing.title}"`,
      `/me?tab=offers`,
    );
    res.status(201).json({ offerId: Number(info.lastInsertRowid), status: 'pending' });
  }),
);

listingRoutes.get(
  '/:id/offers',
  requireAuth,
  wrap((req, res) => {
    const listing = get('SELECT * FROM listings WHERE id = ?', [req.params.id]);
    if (!listing) throw notFound('Listing not found');
    if (listing.seller_id !== req.user.id && req.user.role !== 'admin') throw forbidden('Not your listing');
    const offers = all(
      `SELECT o.*, u.name AS buyer_name, u.username AS buyer_username
       FROM offers o JOIN users u ON u.id = o.buyer_id
       WHERE o.listing_id = ? ORDER BY o.amount DESC`,
      [listing.id],
    );
    res.json({
      offers: offers.map((o) => ({
        id: o.id,
        amount: o.amount,
        message: o.message,
        status: o.status,
        createdAt: toIso(o.created_at),
        buyer: { id: o.buyer_id, name: o.buyer_name, username: o.buyer_username },
      })),
    });
  }),
);
