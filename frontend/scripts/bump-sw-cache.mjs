#!/usr/bin/env node
/**
 * Stamps public/sw.js with a fresh cache-version string, so the very first
 * page load after this runs is guaranteed to install a new service worker
 * and drop whatever it had cached before.
 *
 * `astro dev` never registers the worker at all (see Base.astro) — Vite's
 * own hot-reload already keeps that server current, and a cache-first worker
 * would only fight it. This script matters for the one path that *does* run
 * the worker for real: `npm run preview`, which serves the built site the
 * way production actually will. Run automatically by start.bat on every
 * launch, so a preview session never serves yesterday's build by accident.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const swPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js');
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\..+/, '')
  .replace('T', '-'); // 20260903-142233

const before = readFileSync(swPath, 'utf8');
const after = before.replace(/const SHELL = '[^']*';/, `const SHELL = 'utgc-shell-${stamp}';`);

if (before === after) {
  console.warn(`[bump-sw-cache] Could not find the SHELL constant in ${swPath} — left it untouched.`);
} else {
  writeFileSync(swPath, after);
  console.log(`[bump-sw-cache] sw.js cache key is now utgc-shell-${stamp}`);
}
