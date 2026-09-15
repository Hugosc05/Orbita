import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

export const db = new Database(config.dbFile);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  av TEXT DEFAULT '',
  color TEXT DEFAULT '',
  pin_hash TEXT,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json TEXT NOT NULL DEFAULT '{}',
  bg TEXT,
  view TEXT DEFAULT 'month',
  tour INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '',
  shape TEXT DEFAULT 'circle',
  pos INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  cat TEXT,
  date TEXT,
  time TEXT DEFAULT '',
  dur INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  done INTEGER DEFAULT 0,
  subs TEXT DEFAULT '[]',
  rep TEXT DEFAULT '{}',
  done_dates TEXT DEFAULT '[]',
  skips TEXT DEFAULT '[]',
  source TEXT DEFAULT '',
  ext_id TEXT DEFAULT '',
  kind TEXT DEFAULT 'task',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  trashed INTEGER DEFAULT 0,
  trashed_at INTEGER
);

CREATE TABLE IF NOT EXISTS outlook_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  account TEXT DEFAULT '',
  access_token TEXT,
  refresh_token TEXT,
  expires INTEGER DEFAULT 0,
  auto INTEGER DEFAULT 1,
  last_sync INTEGER DEFAULT 0,
  last_result TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS processed_mail (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  outcome TEXT DEFAULT '',
  item_id TEXT,
  PRIMARY KEY (user_id, message_id)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  verifier TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id, trashed);
CREATE INDEX IF NOT EXISTS idx_items_date ON items(user_id, date);
CREATE INDEX IF NOT EXISTS idx_cats_user ON categories(user_id);
`);

const columns = table => db.prepare("PRAGMA table_info(" + table + ")").all().map(c => c.name);

if (!columns("oauth_states").includes("verifier")) db.exec("ALTER TABLE oauth_states ADD COLUMN verifier TEXT DEFAULT ''");
if (!columns("outlook_accounts").includes("linked_at")) db.exec("ALTER TABLE outlook_accounts ADD COLUMN linked_at INTEGER DEFAULT 0");
if (!columns("items").includes("kind")) db.exec("ALTER TABLE items ADD COLUMN kind TEXT DEFAULT 'task'");

export const nowMs = () => Date.now();
