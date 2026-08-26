/**
 * Entry point for `npm start` / `npm run dev`. Its only job is making sure a
 * seeded database exists before the server (and its routes, which open the
 * shared db.js connection as soon as they're imported) comes up.
 *
 * This matters specifically for free-tier hosting (e.g. Render's free plan):
 * the disk is ephemeral there, so every cold start after a period of inactivity
 * begins with no database file at all. Without this, the app would come up
 * "working" but empty — no schools, no demo logins, nothing to look at. Seeding
 * on demand instead of once at deploy time means the demo self-heals after
 * every cold start rather than staying empty until someone notices and reseeds
 * it by hand. The tradeoff: on the free tier, anything a visitor adds (a
 * sign-up, a listing, an offer) is lost whenever the instance spins down and
 * loses its disk — this is exactly what a persistent disk (a paid add-on) is
 * for, not something boot-time seeding can fix.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

if (!fs.existsSync(config.dbPath)) {
  console.log('No database found — seeding the demo campus for first boot...');
  execFileSync(process.execPath, [path.join(here, 'seed.js'), '--reset'], { stdio: 'inherit' });
}

await import('./server.js');
