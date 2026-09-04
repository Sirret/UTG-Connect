import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, '..');

// Tiny .env reader so the MVP has no dotenv dependency.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

const bool = (v, fallback) => (v === undefined ? fallback : v === 'true' || v === '1');

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'utg-connect-dev-secret',
  emailDomain: process.env.UNIVERSITY_EMAIL_DOMAIN || 'utg.edu.gm',
  devReturnVerifyToken: bool(process.env.DEV_RETURN_VERIFY_TOKEN, true),
  allowAnyEmail: bool(process.env.ALLOW_ANY_EMAIL, false),
  requirePostApproval: bool(process.env.REQUIRE_POST_APPROVAL, true),
  depositThreshold: Number(process.env.DEPOSIT_THRESHOLD || 1000),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:4321,http://127.0.0.1:4321')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  dbPath: process.env.DB_PATH || path.join(ROOT, 'data', 'utg.db'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(ROOT, 'data', 'uploads'),
};
