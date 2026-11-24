import { randomHex } from './crypto';
import { AppSettings, CheckInDTO, Env, SettingsWithSecret } from './types';

export const DEFAULT_BOOTSTRAP_ADMIN = 'kingsleyalozor@gmail.com';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS members (
    code_id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS claims (
    code_id TEXT PRIMARY KEY,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS checkins (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_day_sub
    ON checkins (day, google_sub) WHERE google_sub IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_checkins_day_device
    ON checkins (day, device_id) WHERE device_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_checkins_day_number
    ON checkins (day, number)`,
  `CREATE TABLE IF NOT EXISTS settings (
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
  )`,
  `CREATE TABLE IF NOT EXISTS admins (
    email TEXT PRIMARY KEY,
    added_by TEXT NOT NULL DEFAULT 'system',
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

const initializedDbs = new WeakSet<D1Database>();

/**
 * Lazily ensures tables and bootstrap seed rows exist on first request per Worker isolate.
 * This lets you deploy a fresh Cloudflare D1 database with zero manual SQL migration steps.
 */
export async function ensureSchema(env: Env): Promise<void> {
  if (initializedDbs.has(env.DB)) return;

  await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));

  const bootstrapAdmin = getBootstrapAdminEmail(env);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO settings (id, qr_secret, session_secret) VALUES (1, ?, ?)`
    ).bind(randomHex(32), randomHex(32)),
    env.DB.prepare(
      `INSERT OR IGNORE INTO admins (email, added_by) VALUES (?, 'system')`
    ).bind(bootstrapAdmin),
  ]);

  initializedDbs.add(env.DB);
}

const sessionSecretCache = new WeakMap<D1Database, string>();

/**
 * Returns SESSION_SECRET from env if explicitly configured, otherwise auto-generates
 * and persists a cryptographic secret inside D1 so zero manual secret setup is needed.
 */
export async function resolveSessionSecret(env: Env): Promise<string> {
  const fromEnv = env.SESSION_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  const cached = sessionSecretCache.get(env.DB);
  if (cached) return cached;

  await ensureSchema(env);
  const row = await env.DB.prepare(`SELECT session_secret FROM settings WHERE id = 1`).first<{
    session_secret?: string;
  }>();
  const secret = row?.session_secret?.trim();
  if (secret && secret.length >= 16) {
    sessionSecretCache.set(env.DB, secret);
    return secret;
  }

  const fresh = randomHex(32);
  await env.DB.prepare(`UPDATE settings SET session_secret = ? WHERE id = 1`).bind(fresh).run();
  sessionSecretCache.set(env.DB, fresh);
  return fresh;
}

export function getBootstrapAdminEmail(env: Env): string {
  return (env.BOOTSTRAP_ADMIN_EMAIL || DEFAULT_BOOTSTRAP_ADMIN).trim().toLowerCase();
}

interface SettingsRow {
  venue_lat: number;
  venue_lng: number;
  venue_name: string;
  radius_m: number;
  max_accuracy_m: number;
  require_qr: number;
  qr_rotation_seconds: number;
  check_in_open: number;
  enforce_device_lock: number;
  enforce_window: number;
  window_start: string;
  late_after: string;
  window_end: string;
  allowed_states: string;
  qr_secret: string;
}

export async function getSettings(env: Env): Promise<SettingsWithSecret> {
  await ensureSchema(env);
  const row = await env.DB.prepare(`SELECT * FROM settings WHERE id = 1`).first<SettingsRow>();
  if (!row) {
    throw new Error('Settings row failed to initialize.');
  }

  let allowedStates: string[] = ['LA'];
  try {
    const parsed = JSON.parse(row.allowed_states);
    if (Array.isArray(parsed)) {
      allowedStates = parsed.map((s) => String(s).toUpperCase());
    }
  } catch {
    allowedStates = ['LA'];
  }

  const settings: AppSettings = {
    venue: {
      lat: Number(row.venue_lat),
      lng: Number(row.venue_lng),
      name: String(row.venue_name),
    },
    radiusM: Number(row.radius_m),
    maxAccuracyM: Number(row.max_accuracy_m),
    requireQr: Boolean(row.require_qr),
    qrRotationSeconds: Number(row.qr_rotation_seconds),
    checkInOpen: Boolean(row.check_in_open),
    enforceDeviceLock: Boolean(row.enforce_device_lock),
    enforceWindow: Boolean(row.enforce_window),
    windowStart: String(row.window_start),
    lateAfter: String(row.late_after),
    windowEnd: String(row.window_end),
    allowedStates,
  };

  return { settings, qrSecret: String(row.qr_secret) };
}

export async function getAdminEmails(env: Env): Promise<string[]> {
  await ensureSchema(env);
  const { results } = await env.DB.prepare(`SELECT email FROM admins ORDER BY email ASC`).all<{
    email: string;
  }>();
  const set = new Set<string>([getBootstrapAdminEmail(env)]);
  for (const r of results) {
    if (r.email) set.add(r.email.toLowerCase());
  }
  return Array.from(set).sort();
}

export async function writeAuditLog(
  env: Env,
  actorEmail: string,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_logs (actor_email, action, details) VALUES (?, ?, ?)`
  )
    .bind(actorEmail, action, JSON.stringify(details))
    .run();
}

export interface CheckInRow {
  day: string;
  code_id: string;
  code: string;
  name: string;
  number: number;
  status: string;
  google_sub: string | null;
  email: string;
  distance_m: number | null;
  accuracy_m: number | null;
  qr_verified: number;
  method: string;
  checked_in_at: string;
  recorded_by: string | null;
  manual_note: string | null;
}

export function rowToCheckInDTO(row: CheckInRow): CheckInDTO {
  return {
    day: row.day,
    codeId: row.code_id,
    code: row.code,
    name: row.name || '',
    number: Number(row.number),
    status: row.status === 'late' ? 'late' : 'on_time',
    email: row.email || '',
    distanceM: row.distance_m === null ? null : Number(row.distance_m),
    accuracyM: row.accuracy_m === null ? null : Number(row.accuracy_m),
    qrVerified: Boolean(row.qr_verified),
    method: row.method === 'manual' ? 'manual' : 'self',
    checkedInAtIso: row.checked_in_at,
    recordedBy: row.recorded_by ?? undefined,
    manualNote: row.manual_note ?? undefined,
  };
}
