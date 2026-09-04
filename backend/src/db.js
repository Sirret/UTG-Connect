import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS schools (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#0f766e',
  logo_url    TEXT,
  is_campus_wide INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  -- 'student' | 'council' | 'admin'. A council account belongs to the council,
  -- not to whoever currently holds office, so it survives leadership changes.
  role          TEXT NOT NULL DEFAULT 'student',
  -- A student stays a plain buyer until they deliberately opt in to selling —
  -- listing something is a distinct step, not something every account can do.
  is_seller     INTEGER NOT NULL DEFAULT 0,
  school_id     INTEGER REFERENCES schools(id),
  bio           TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT,
  whatsapp      TEXT,
  verified      INTEGER NOT NULL DEFAULT 0,
  verify_token  TEXT,
  banned        INTEGER NOT NULL DEFAULT 0,
  ban_reason    TEXT,
  banned_at     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Events, deadlines, payment dates and announcements.
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  -- 'event' | 'deadline' | 'payment' | 'announcement'
  kind        TEXT NOT NULL DEFAULT 'announcement',
  starts_at   TEXT,           -- ISO. Drives countdown badges + "All Schools" ordering.
  ends_at     TEXT,
  location    TEXT,
  image_url   TEXT,
  -- A PDF/doc a council attaches — a briefing, a schedule, a form. Hub posts
  -- only; Market and Social stay photo-only by design.
  document_url  TEXT,
  document_name TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'published' | 'rejected'
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted     INTEGER NOT NULL DEFAULT 0
);

-- The Info tab on each school page.
CREATE TABLE IF NOT EXISTS council_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  position      TEXT NOT NULL,
  handles       TEXT NOT NULL DEFAULT '',   -- what this role actually deals with
  contact       TEXT NOT NULL DEFAULT '',   -- email / phone / whatever the council specifies
  contact_kind  TEXT NOT NULL DEFAULT 'email',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id     INTEGER REFERENCES schools(id),
  section       TEXT NOT NULL,              -- 'goods' | 'services' | 'rent'
  category      TEXT NOT NULL,              -- strict category picked at listing time
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  price         REAL NOT NULL DEFAULT 0,
  price_unit    TEXT NOT NULL DEFAULT 'item', -- 'item' | 'hour' | 'day' | 'week'
  currency      TEXT NOT NULL DEFAULT 'GMD',
  deposit       REAL NOT NULL DEFAULT 0,    -- rent & borrow only
  image_url     TEXT,
  pickup_point  TEXT NOT NULL DEFAULT '',
  accepts_offers INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active', -- 'active' | 'scheduled' | 'sold' | 'removed'
  drops_at      TEXT,                       -- scheduled "drop" time
  views         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      REAL NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'declined'
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saves (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, seller_id)
);

-- "I'm going" / "add to my calendar" — a student's personal shortlist of posts.
CREATE TABLE IF NOT EXISTS post_interests (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS ratings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rater_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars      INTEGER NOT NULL,
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (seller_id, rater_id)
);

-- 24-hour seller stories ("Restocked", "3 left").
CREATE TABLE IF NOT EXISTS stories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- 24-hour school/council status updates on the Hub — a quick "campus WiFi is
-- down" note, not a formal post. Deliberately no likes/comments: a status,
-- not content. Picture-or-text only, never a document.
CREATE TABLE IF NOT EXISTS school_stories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL DEFAULT '',
  image_url  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Direct messages — one thread per pair of users, reused for "message the
-- council from a story", "message a seller from a listing", and anything
-- else that needs a private note between two accounts.
CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  read            INTEGER NOT NULL DEFAULT 0
);

-- Rent & Borrow agreements: the extra safeguards live here.
CREATE TABLE IF NOT EXISTS rentals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id    INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  lender_id     INTEGER NOT NULL REFERENCES users(id),
  borrower_id   INTEGER NOT NULL REFERENCES users(id),
  amount        REAL NOT NULL DEFAULT 0,
  deposit       REAL NOT NULL DEFAULT 0,
  -- 'none' | 'held' | 'released' | 'forfeited'  (mobile-money escrow, simulated)
  deposit_state TEXT NOT NULL DEFAULT 'none',
  deposit_ref   TEXT,
  due_at        TEXT,
  -- 'agreed' | 'handed_off' | 'returned' | 'closed' | 'disputed'
  status        TEXT NOT NULL DEFAULT 'agreed',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS condition_photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  rental_id  INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  phase      TEXT NOT NULL,   -- 'handoff' | 'return'
  photo_url  TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reports always carry photo evidence; an admin rules on them.
CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id   INTEGER NOT NULL REFERENCES users(id),
  accused_id    INTEGER NOT NULL REFERENCES users(id),
  rental_id     INTEGER REFERENCES rentals(id) ON DELETE SET NULL,
  reason        TEXT NOT NULL,
  evidence_url  TEXT NOT NULL,
  -- 'open' | 'upheld' | 'fabricated'
  status        TEXT NOT NULL DEFAULT 'open',
  admin_note    TEXT NOT NULL DEFAULT '',
  reviewed_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at   TEXT
);

-- The Social tab: plain student posts (a photo + a caption), separate from
-- the official school/council feed above.
CREATE TABLE IF NOT EXISTS social_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption    TEXT NOT NULL DEFAULT '',
  image_url  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS social_likes (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    INTEGER NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS social_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  link       TEXT NOT NULL DEFAULT '',
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_school   ON posts(school_id, status);
CREATE INDEX IF NOT EXISTS idx_posts_updated  ON posts(updated_at);
CREATE INDEX IF NOT EXISTS idx_listings_sect  ON listings(section, status);
CREATE INDEX IF NOT EXISTS idx_listings_upd   ON listings(updated_at);
CREATE INDEX IF NOT EXISTS idx_offers_listing ON offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_notif_user     ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_interests_user ON post_interests(user_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts(created_at);
CREATE INDEX IF NOT EXISTS idx_social_comments_post ON social_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_school_stories_school ON school_stories(school_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
`);

// Cheap migration for databases created before a column existed — SQLite's
// ALTER TABLE ADD COLUMN is instant, so this just runs harmlessly every boot.
const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
if (!hasColumn('users', 'is_seller')) {
  db.exec('ALTER TABLE users ADD COLUMN is_seller INTEGER NOT NULL DEFAULT 0');
}
if (!hasColumn('posts', 'document_url')) {
  db.exec('ALTER TABLE posts ADD COLUMN document_url TEXT');
  db.exec('ALTER TABLE posts ADD COLUMN document_name TEXT');
}

// node:sqlite hands back null-prototype rows; copy them so JSON.stringify and
// spread behave the way the rest of the code expects.
const plain = (row) => (row ? { ...row } : null);

export const all = (sql, params = []) => db.prepare(sql).all(...params).map(plain);
export const get = (sql, params = []) => plain(db.prepare(sql).get(...params));
export const run = (sql, params = []) => db.prepare(sql).run(...params);
export const touch = (table, id) =>
  run(`UPDATE ${table} SET updated_at = datetime('now') WHERE id = ?`, [id]);
