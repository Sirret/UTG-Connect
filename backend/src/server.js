import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { attachUser } from './auth.js';
import { HttpError } from './util.js';
import { authRoutes } from './routes/auth.js';
import { schoolRoutes } from './routes/schools.js';
import { postRoutes } from './routes/posts.js';
import { listingRoutes } from './routes/listings.js';
import { offerRoutes } from './routes/offers.js';
import { sellerRoutes, storyRoutes } from './routes/sellers.js';
import { rentalRoutes, reportRoutes } from './routes/rentals.js';
import { meRoutes } from './routes/me.js';
import { adminRoutes } from './routes/admin.js';

const app = express();

app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    // Without this the browser hides ETag from JS on cross-origin responses, and
    // the client could never send If-None-Match — the on-device cache would
    // quietly do nothing.
    exposedHeaders: ['ETag'],
  }),
);
app.use(express.json({ limit: '256kb' }));
app.use(attachUser);

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, service: 'utg-connect-api', time: new Date().toISOString() }),
);

app.use('/api/auth', authRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/sellers', sellerRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/rentals', rentalRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/me', meRoutes);
app.use('/api/admin', adminRoutes);

app.use((_req, res) => res.status(404).json({ error: 'No such endpoint' }));

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

app.listen(config.port, () => {
  console.log(`UTG Connect API on http://localhost:${config.port}`);
  console.log(`  student sign-up domain: @${config.emailDomain}${config.allowAnyEmail ? ' (any email allowed — test mode)' : ''}`);
  console.log(`  post approval queue:    ${config.requirePostApproval ? 'on' : 'off'}`);
});
