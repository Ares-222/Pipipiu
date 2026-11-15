-- Ares Crypto D1 schema (spec §18).
-- Apply with: wrangler d1 execute ares --file src/schema.sql

CREATE TABLE IF NOT EXISTS users (
  chat_id INTEGER PRIMARY KEY,
  tg_username TEXT,
  created_at INTEGER,
  quota_day TEXT,
  quick_used INTEGER DEFAULT 0,
  deep_used INTEGER DEFAULT 0,
  aml_used INTEGER DEFAULT 0,
  watches_used INTEGER DEFAULT 0,
  settings_json TEXT
);

CREATE TABLE IF NOT EXISTS labels (
  chain TEXT NOT NULL,
  addr TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence TEXT NOT NULL,
  added_by TEXT,
  updated_at INTEGER,
  PRIMARY KEY (chain, addr, category, name)
);
CREATE INDEX IF NOT EXISTS idx_labels_addr ON labels (chain, addr);

CREATE TABLE IF NOT EXISTS clusters (
  chain TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  addr TEXT NOT NULL,
  PRIMARY KEY (chain, cluster_id, addr)
);

CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  chain TEXT NOT NULL,
  addr TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  min_usd REAL DEFAULT 10,
  last_state_json TEXT,
  last_check INTEGER,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_watches_chat ON watches (chat_id);

CREATE TABLE IF NOT EXISTS watch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id INTEGER NOT NULL,
  direction TEXT NOT NULL,
  amount REAL NOT NULL,
  asset TEXT NOT NULL,
  counterparty TEXT,
  label TEXT,
  tx_hash TEXT,
  ts INTEGER NOT NULL,
  notified INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_we_watch ON watch_events (watch_id);

CREATE TABLE IF NOT EXISTS aml_sources (
  chain TEXT NOT NULL,
  addr TEXT NOT NULL,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  ref TEXT,
  updated_at INTEGER,
  PRIMARY KEY (chain, addr, source)
);
CREATE INDEX IF NOT EXISTS idx_aml_addr ON aml_sources (chain, addr);

CREATE TABLE IF NOT EXISTS tx_deposits (
  chain TEXT NOT NULL,
  contract TEXT NOT NULL,
  commitment TEXT NOT NULL,
  amount REAL NOT NULL,
  ts INTEGER NOT NULL,
  addr TEXT,                      -- depositor ('d:' rows) / withdrawer ('w:' rows) — unmix extension
  PRIMARY KEY (chain, contract, commitment)
);
CREATE INDEX IF NOT EXISTS idx_dep_ts ON tx_deposits (chain, contract, ts);
CREATE INDEX IF NOT EXISTS idx_dep_addr ON tx_deposits (chain, addr);

CREATE TABLE IF NOT EXISTS traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root TEXT NOT NULL,
  chain TEXT NOT NULL,
  depth INTEGER NOT NULL,
  status TEXT NOT NULL,
  state_json TEXT,
  result_json TEXT,
  chat_id INTEGER,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER,
  input TEXT,
  chain TEXT,
  verdict TEXT,
  summary_json TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  where_txt TEXT,
  message TEXT
);
