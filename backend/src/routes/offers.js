import { Router } from 'express';
import { config } from '../config.js';
import { get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { forbidden, notFound, notify, oneOf, wrap } from '../util.js';

export const offerRoutes = Router();

offerRoutes.patch(
  '/:id',
  requireAuth,
  wrap((req, res) => {
    const offer = get(
      `SELECT o.*, l.title, l.currency, l.seller_id, l.section, l.deposit, l.id AS listing_id
       FROM offers o JOIN listings l ON l.id = o.listing_id WHERE o.id = ?`,
      [req.params.id],
    );
    if (!offer) throw notFound('Offer not found');
    if (offer.seller_id !== req.user.id) throw forbidden('Only the seller can answer an offer');

    const decision = oneOf(req.body?.status, ['accepted', 'declined'], 'status');
    run('UPDATE offers SET status = ? WHERE id = ?', [decision, offer.id]);

    let rentalId = null;
    if (decision === 'accepted') {
      run('UPDATE offers SET status = ? WHERE listing_id = ? AND id != ? AND status = ?', [
        'declined',
        offer.listing_id,
        offer.id,
        'pending',
      ]);

      // Accepting on a Rent & Borrow listing opens the safeguarded agreement:
      // deposit escrow, condition photos, dispute trail.
      if (offer.section === 'rent') {
        const deposit = offer.amount >= config.depositThreshold ? offer.deposit : 0;
        const info = run(
          `INSERT INTO rentals (listing_id, lender_id, borrower_id, amount, deposit, deposit_state, due_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            offer.listing_id,
            offer.seller_id,
            offer.buyer_id,
            offer.amount,
            deposit,
            deposit > 0 ? 'none' : 'none',
            null,
          ],
        );
        rentalId = Number(info.lastInsertRowid);
      } else {
        run("UPDATE listings SET status = 'sold', updated_at = datetime('now') WHERE id = ?", [offer.listing_id]);
      }
    }

    notify(
      offer.buyer_id,
      'offer',
      decision === 'accepted'
        ? `Your ${offer.amount} ${offer.currency} offer on "${offer.title}" was accepted`
        : `Your offer on "${offer.title}" was declined`,
      rentalId ? `/me?tab=rentals` : `/listing?id=${offer.listing_id}`,
    );

    res.json({ ok: true, status: decision, rentalId });
  }),
);
