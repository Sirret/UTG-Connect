import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, forbidden, need, notFound, notify, oneOf, toIso, toSqlTime, token, wrap } from '../util.js';

export const rentalRoutes = Router();

const SELECT_RENTAL = `
  SELECT r.*, l.title, l.currency, l.image_url, l.pickup_point,
         lender.name AS lender_name, lender.username AS lender_username,
         borrower.name AS borrower_name, borrower.username AS borrower_username
  FROM rentals r
  JOIN listings l ON l.id = r.listing_id
  JOIN users lender   ON lender.id = r.lender_id
  JOIN users borrower ON borrower.id = r.borrower_id
`;

const shapeRental = (r, photos = []) => ({
  id: r.id,
  listingId: r.listing_id,
  title: r.title,
  imageUrl: r.image_url,
  pickupPoint: r.pickup_point,
  currency: r.currency,
  amount: r.amount,
  deposit: r.deposit,
  depositState: r.deposit_state,
  depositRef: r.deposit_ref,
  dueAt: toIso(r.due_at),
  status: r.status,
  createdAt: toIso(r.created_at),
  lender: { id: r.lender_id, name: r.lender_name, username: r.lender_username },
  borrower: { id: r.borrower_id, name: r.borrower_name, username: r.borrower_username },
  photos: photos.map((p) => ({ id: p.id, phase: p.phase, url: p.photo_url, note: p.note, by: p.user_id, at: toIso(p.created_at) })),
});

const loadRental = (id, user) => {
  const rental = get(`${SELECT_RENTAL} WHERE r.id = ?`, [id]);
  if (!rental) throw notFound('Rental not found');
  const involved = rental.lender_id === user.id || rental.borrower_id === user.id || user.role === 'admin';
  if (!involved) throw forbidden('Not part of this rental');
  return rental;
};

rentalRoutes.get(
  '/',
  requireAuth,
  wrap((req, res) => {
    const rows = all(`${SELECT_RENTAL} WHERE r.lender_id = ? OR r.borrower_id = ? ORDER BY r.created_at DESC`, [
      req.user.id,
      req.user.id,
    ]);
    res.json({
      rentals: rows.map((r) =>
        shapeRental(r, all('SELECT * FROM condition_photos WHERE rental_id = ? ORDER BY id', [r.id])),
      ),
    });
  }),
);

rentalRoutes.get(
  '/:id',
  requireAuth,
  wrap((req, res) => {
    const rental = loadRental(req.params.id, req.user);
    res.json({ rental: shapeRental(rental, all('SELECT * FROM condition_photos WHERE rental_id = ? ORDER BY id', [rental.id])) });
  }),
);

/**
 * Deposit escrow. In production this calls a mobile-money service (Africell
 * Money and the like); here it is a state machine with a reference number, which
 * is enough to prove the flow works.
 */
rentalRoutes.post(
  '/:id/deposit',
  requireAuth,
  wrap((req, res) => {
    const rental = loadRental(req.params.id, req.user);
    const action = oneOf(req.body?.action, ['hold', 'release', 'forfeit'], 'action');

    if (action === 'hold') {
      if (rental.borrower_id !== req.user.id) throw forbidden('The borrower pays the deposit');
      if (rental.deposit <= 0) throw bad('This rental has no deposit');
      if (rental.deposit_state === 'held') throw bad('Deposit is already held');
      const ref = `MM-${token().slice(0, 10).toUpperCase()}`;
      run("UPDATE rentals SET deposit_state = 'held', deposit_ref = ?, updated_at = datetime('now') WHERE id = ?", [ref, rental.id]);
      notify(rental.lender_id, 'rental', `Deposit of ${rental.deposit} ${rental.currency} is held for "${rental.title}"`, '/me?tab=rentals');
      return res.json({ depositState: 'held', reference: ref });
    }

    // Releasing or forfeiting is the lender's call — or an admin's after a dispute.
    if (rental.lender_id !== req.user.id && req.user.role !== 'admin') {
      throw forbidden('Only the lender or an admin can settle the deposit');
    }
    if (rental.deposit_state !== 'held') throw bad('No deposit is currently held');

    const next = action === 'release' ? 'released' : 'forfeited';
    run("UPDATE rentals SET deposit_state = ?, status = 'closed', updated_at = datetime('now') WHERE id = ?", [next, rental.id]);
    notify(
      rental.borrower_id,
      'rental',
      next === 'released'
        ? `Your ${rental.deposit} ${rental.currency} deposit for "${rental.title}" was refunded`
        : `Your deposit for "${rental.title}" was paid to the lender`,
      '/me?tab=rentals',
    );
    res.json({ depositState: next });
  }),
);

/** Condition photos at handoff and at return — the record if a dispute follows. */
rentalRoutes.post(
  '/:id/photos',
  requireAuth,
  wrap((req, res) => {
    const rental = loadRental(req.params.id, req.user);
    need(req.body, 'phase', 'photoUrl');
    const phase = oneOf(req.body.phase, ['handoff', 'return'], 'phase');

    run('INSERT INTO condition_photos (rental_id, user_id, phase, photo_url, note) VALUES (?, ?, ?, ?, ?)', [
      rental.id,
      req.user.id,
      phase,
      req.body.photoUrl,
      req.body.note || '',
    ]);
    const nextStatus = phase === 'handoff' ? 'handed_off' : 'returned';
    run("UPDATE rentals SET status = ?, updated_at = datetime('now') WHERE id = ?", [nextStatus, rental.id]);

    const other = rental.lender_id === req.user.id ? rental.borrower_id : rental.lender_id;
    notify(other, 'rental', `${req.user.name} added a ${phase} photo for "${rental.title}"`, '/me?tab=rentals');
    res.status(201).json({ ok: true, status: nextStatus });
  }),
);

rentalRoutes.patch(
  '/:id',
  requireAuth,
  wrap((req, res) => {
    const rental = loadRental(req.params.id, req.user);
    const dueAt = req.body?.dueAt !== undefined ? toSqlTime(req.body.dueAt) : rental.due_at;
    const status = req.body?.status
      ? oneOf(req.body.status, ['agreed', 'handed_off', 'returned', 'closed', 'disputed'], 'status')
      : rental.status;
    run("UPDATE rentals SET due_at = ?, status = ?, updated_at = datetime('now') WHERE id = ?", [dueAt, status, rental.id]);
    res.json({ ok: true });
  }),
);

// --- Reports: evidence required, admin rules, false reports rebound ----------

export const reportRoutes = Router();

reportRoutes.post(
  '/',
  requireAuth,
  wrap((req, res) => {
    need(req.body, 'accusedUsername', 'reason', 'evidenceUrl');
    // No evidence, no report — this is the whole guardrail.
    if (!String(req.body.evidenceUrl).trim()) throw bad('A report needs photo evidence attached');

    const accused = get('SELECT * FROM users WHERE username = ?', [String(req.body.accusedUsername).toLowerCase()]);
    if (!accused) throw notFound('No such user');
    if (accused.id === req.user.id) throw bad('You cannot report yourself');

    let rentalId = null;
    if (req.body.rentalId) {
      const rental = loadRental(req.body.rentalId, req.user);
      rentalId = rental.id;
      run("UPDATE rentals SET status = 'disputed', updated_at = datetime('now') WHERE id = ?", [rental.id]);
    }

    const info = run(
      'INSERT INTO reports (reporter_id, accused_id, rental_id, reason, evidence_url) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, accused.id, rentalId, req.body.reason, req.body.evidenceUrl],
    );
    res.status(201).json({
      reportId: Number(info.lastInsertRowid),
      notice:
        'An admin reviews evidence from both sides before any account is affected. ' +
        'If this report is found to be fabricated, you are the one added to the public ban list.',
    });
  }),
);

reportRoutes.get(
  '/mine',
  requireAuth,
  wrap((req, res) => {
    const rows = all(
      `SELECT r.*, a.username AS accused_username FROM reports r JOIN users a ON a.id = r.accused_id
       WHERE r.reporter_id = ? ORDER BY r.created_at DESC`,
      [req.user.id],
    );
    res.json({
      reports: rows.map((r) => ({
        id: r.id,
        accused: r.accused_username,
        reason: r.reason,
        status: r.status,
        adminNote: r.admin_note,
        createdAt: toIso(r.created_at),
      })),
    });
  }),
);

/** Public, in-app ban list — including anyone banned for filing a fake report. */
reportRoutes.get(
  '/banlist',
  wrap((req, res) => {
    const rows = all("SELECT username, name, ban_reason, banned_at FROM users WHERE banned = 1 ORDER BY banned_at DESC");
    res.json({
      banned: rows.map((u) => ({ username: u.username, name: u.name, reason: u.ban_reason, at: toIso(u.banned_at) })),
    });
  }),
);
