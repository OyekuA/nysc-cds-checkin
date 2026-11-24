-- NYSC Surulere CDS Check-In (Cloudflare D1 / SQLite Schema)
-- Tables are also auto-created lazily on first Worker request if not migrated manually.

CREATE TABLE IF NOT EXISTS members (
  code_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS claims (
  code_id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checkins (
  day TEXT NOT NULL,
  code_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'on_time',
  google_sub TEXT,
  email TEXT NOT NULL DEFAULT '',
  device_id TEXT,
  distance_m INTEGER,
  accuracy_m INTEGER,
  lat REAL,
  lng REAL,
  gps_age_ms INTEGER,
  qr_verified INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'self',
  recorded_by TEXT,
  manual_note TEXT,
  checked_in_at TEXT NOT NULL,
  PRIMARY KEY (day, code_id),
  UNIQUE (day, number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_day_sub
  ON checkins (day, google_sub) WHERE google_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checkins_day_device
  ON checkins (day, device_id) WHERE device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checkins_day_number
  ON checkins (day, number);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  venue_lat REAL NOT NULL DEFAULT 6.5132891,
  venue_lng REAL NOT NULL DEFAULT 3.3559699,
  venue_name TEXT NOT NULL DEFAULT 'NYSC Surulere CDS Venue',
  radius_m INTEGER NOT NULL DEFAULT 100,
  max_accuracy_m INTEGER NOT NULL DEFAULT 120,
  require_qr INTEGER NOT NULL DEFAULT 0,
  qr_rotation_seconds INTEGER NOT NULL DEFAULT 45,
  check_in_open INTEGER NOT NULL DEFAULT 1,
  enforce_device_lock INTEGER NOT NULL DEFAULT 1,
  enforce_window INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL DEFAULT '07:00',
  late_after TEXT NOT NULL DEFAULT '08:30',
  window_end TEXT NOT NULL DEFAULT '13:00',
  allowed_states TEXT NOT NULL DEFAULT '["LA"]',
  qr_secret TEXT NOT NULL,
  session_secret TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  email TEXT PRIMARY KEY,
  added_by TEXT NOT NULL DEFAULT 'system',
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
