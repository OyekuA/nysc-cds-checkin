import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

/**
 * Tiny real SQLite adapter implementing Cloudflare D1Database using Node's built-in node:sqlite.
 * Executes real SQLite constraints (PRIMARY KEY, UNIQUE, partial indexes, RETURNING, transactions).
 */
function createSqliteD1() {
  const sqlite = new DatabaseSync(':memory:');

  function makePrepared(sql, params = []) {
    return {
      sql,
      params,
      bind(...args) {
        return makePrepared(sql, args);
      },
      async first() {
        const stmt = sqlite.prepare(sql);
        const row = stmt.get(...params);
        return row ?? null;
      },
      async all() {
        const stmt = sqlite.prepare(sql);
        const results = stmt.all(...params);
        return { results, success: true };
      },
      async run() {
        const stmt = sqlite.prepare(sql);
        const info = stmt.run(...params);
        return { success: true, meta: { changes: Number(info.changes ?? 0) } };
      },
    };
  }

  return {
    sqlite,
    prepare(sql) {
      return makePrepared(sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out = [];
        for (const s of statements) {
          const stmt = sqlite.prepare(s.sql);
          if (/^\s*(SELECT|PRAGMA)|RETURNING\b/i.test(s.sql)) {
            out.push({ results: stmt.all(...s.params), success: true });
          } else {
            stmt.run(...s.params);
            out.push({ results: [], success: true });
          }
        }
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

let compiledDir;
let handlers;

async function compileHandlers() {
  compiledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nysc-cf-test-'));
  const entryPoints = [
    'functions/_lib/crypto.ts',
    'functions/_lib/geo.ts',
    'functions/api/auth/me.ts',
    'functions/api/auth/logout.ts',
    'functions/api/auth/dev-login.ts',
    'functions/api/checkin/status.ts',
    'functions/api/checkin/submit.ts',
    'functions/api/admin/bootstrap.ts',
    'functions/api/admin/checkins.ts',
    'functions/api/admin/roster.ts',
    'functions/api/admin/unbind.ts',
    'functions/api/admin/settings.ts',
    'functions/api/admin/admins.ts',
    'functions/api/admin/qr-token.ts',
    'functions/api/admin/monthly-report.ts',
  ];

  await build({
    entryPoints,
    outdir: compiledDir,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outbase: 'functions',
  });

  const load = (rel) => import(pathToFileURL(path.join(compiledDir, rel)).href);
  handlers = {
    crypto: await load('_lib/crypto.js'),
    geo: await load('_lib/geo.js'),
    authMe: await load('api/auth/me.js'),
    authLogout: await load('api/auth/logout.js'),
    authDevLogin: await load('api/auth/dev-login.js'),
    checkinStatus: await load('api/checkin/status.js'),
    checkinSubmit: await load('api/checkin/submit.js'),
    adminBootstrap: await load('api/admin/bootstrap.js'),
    adminCheckins: await load('api/admin/checkins.js'),
    adminRoster: await load('api/admin/roster.js'),
    adminUnbind: await load('api/admin/unbind.js'),
    adminSettings: await load('api/admin/settings.js'),
    adminAdmins: await load('api/admin/admins.js'),
    adminQrToken: await load('api/admin/qr-token.js'),
    adminMonthly: await load('api/admin/monthly-report.js'),
  };
}

function callHandler(mod, method, urlPath, env, { body, cookie } = {}) {
  const fnName =
    method === 'GET'
      ? 'onRequestGet'
      : method === 'POST'
        ? 'onRequestPost'
        : method === 'PUT'
          ? 'onRequestPut'
          : 'onRequestDelete';
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  const request = new Request(`http://localhost:8788${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return mod[fnName]({ request, env });
}

async function loginAs(env, email) {
  const res = await callHandler(handlers.authDevLogin, 'POST', '/api/auth/dev-login', env, {
    body: { email },
  });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('Set-Cookie') || '';
  const match = /nysc_session=[^;]+/.exec(setCookie);
  assert.ok(match, 'expected nysc_session cookie');
  return match[0];
}

test('compile Cloudflare Pages Functions', async () => {
  await compileHandlers();
  assert.ok(handlers.checkinSubmit.onRequestPost);
});

test('crypto HMAC rotating QR tokens & state code normalization', async () => {
  const { generateQrToken, verifyQrToken } = handlers.crypto;
  const { normalizeStateCode, haversineMetres } = handlers.geo;

  assert.deepEqual(normalizeStateCode(' la / 26a / 0123 '), {
    code: 'LA/26A/0123',
    codeId: 'LA_26A_0123',
    state: 'LA',
  });
  assert.equal(normalizeStateCode('BAD'), null);

  assert.ok(haversineMetres(6.5132891, 3.3559699, 6.5132891, 3.3559699) < 0.01);
  const d = haversineMetres(6.5132891, 3.3559699, 6.5142891, 3.3559699);
  assert.ok(d > 105 && d < 115);

  const secret = 'a'.repeat(64);
  const t0 = 1_750_000_000_000;
  const tok = await generateQrToken(secret, 45, t0);
  assert.equal(await verifyQrToken(secret, tok.token, 45, t0), true);
  assert.equal(await verifyQrToken(secret, tok.token, 45, t0 + 45_000), true);
  assert.equal(await verifyQrToken(secret, tok.token, 45, t0 + 95_000), false);
  assert.equal(await verifyQrToken(secret, tok.token.slice(0, -1) + 'X', 45, t0), false);
  assert.equal(await verifyQrToken('b'.repeat(64), tok.token, 45, t0), false);
});

test('End-to-end attendance lifecycle on real SQLite D1 with auth cookies, GPS, QR, anti-proxy, and reports', async () => {
  const DB = createSqliteD1();
  // Intentionally omit SESSION_SECRET to verify automatic D1 secret initialization
  const env = {
    DB,
    DEV_AUTH: 'true',
  };

  const adminCookie = await loginAs(env, 'kingsleyalozor@gmail.com');
  const adaCookie = await loginAs(env, 'ada@gmail.com');
  const chidiCookie = await loginAs(env, 'chidi@gmail.com');
  const bolaCookie = await loginAs(env, 'bola@gmail.com');

  const AT_VENUE = { lat: 6.5132891, lng: 3.3559699, accuracyM: 12, gpsAgeMs: 1100 };

  // 1. Non-admin is rejected from admin endpoints
  const denied = await callHandler(handlers.adminBootstrap, 'GET', '/api/admin/bootstrap', env, {
    cookie: adaCookie,
  });
  assert.equal(denied.status, 403);

  // 2. Admin bootstraps (auto-creates schema & default venue settings)
  const bootRes = await callHandler(handlers.adminBootstrap, 'GET', '/api/admin/bootstrap', env, {
    cookie: adminCookie,
  });
  assert.equal(bootRes.status, 200);
  const boot = await bootRes.json();
  assert.equal(boot.settings.radiusM, 100);

  // 3. Admin imports roster
  const impRes = await callHandler(handlers.adminRoster, 'POST', '/api/admin/roster', env, {
    cookie: adminCookie,
    body: {
      entries: [
        { code: 'LA/26A/0123', name: 'Ada Obi' },
        { code: 'LA/26A/0124', name: 'Chidi Okafor' },
        { code: 'LA/26A/0125', name: 'Bola Adeyemi' },
        { code: 'LA/26A/0126', name: 'Tunde Balogun' },
      ],
    },
  });
  assert.equal(impRes.status, 200);
  assert.equal((await impRes.json()).imported, 4);

  // 4. Stale GPS rejected
  const staleRes = await callHandler(handlers.checkinSubmit, 'POST', '/api/checkin/submit', env, {
    cookie: adaCookie,
    body: { code: 'LA/26A/0123', deviceId: 'dev_ada_1111', ...AT_VENUE, gpsAgeMs: 35_000 },
  });
  assert.equal(staleRes.status, 400);
  assert.match((await staleRes.json()).error, /stale/i);

  // 5. Coarse/Approximate GPS rejected
  const coarseRes = await callHandler(handlers.checkinSubmit, 'POST', '/api/checkin/submit', env, {
    cookie: adaCookie,
    body: { code: 'LA/26A/0123', deviceId: 'dev_ada_1111', ...AT_VENUE, accuracyM: 350 },
  });
  assert.equal(coarseRes.status, 400);
  assert.match((await coarseRes.json()).error, /accuracy/i);

  // 6. Outside geofence rejected
  const farRes = await callHandler(handlers.checkinSubmit, 'POST', '/api/checkin/submit', env, {
    cookie: adaCookie,
    body: {
      code: 'LA/26A/0123',
      deviceId: 'dev_ada_1111',
      lat: 6.5165,
      lng: 3.3559699,
      accuracyM: 12,
      gpsAgeMs: 1000,
    },
  });
  assert.equal(farRes.status, 400);
  assert.match((await farRes.json()).error, /too far/i);

  // 7. Valid check-in succeeds -> #1
  const c1Res = await callHandler(handlers.checkinSubmit, 'POST', '/api/checkin/submit', env, {
    cookie: adaCookie,
    body: { code: 'LA/26A/0123', deviceId: 'dev_ada_1111', ...AT_VENUE },
  });
  assert.equal(c1Res.status, 201);
  const c1 = await c1Res.json();
  assert.equal(c1.number, 1);
  assert.equal(c1.name, 'Ada Obi');
  assert.equal(c1.distanceM, 0);

  // 8. Idempotent retry returns exact #1 without double-counting
  const retryRes = await callHandler(handlers.checkinSubmit, 'POST', '/api/checkin/submit', env, {
    cookie: adaCookie,
    body: { code: 'LA/26A/0123', deviceId: 'dev_ada_1111', ...AT_VENUE },
  });
  assert.equal(retryRes.status, 200);
  assert.equal((await retryRes.json()).number, 1);

  // 9. Reopening page auto-recovers today's pass & claimed code without GPS
  const statusRes = await callHandler(handlers.checkinStatus, 'GET', '/api/checkin/status', env, {
    cookie: adaCookie,
  });
  const st = await statusRes.json();
  assert.equal(st.claimedCode, 'LA/26A/0123');
  assert.equal(st.checkedIn.number, 1);

  // 10. Bi-directional anti-proxy: Ada cannot check in a SECOND code
  const hijackRes = await callHandler(handlers.checkinSubmit, 'POST', '/api/checkin/submit', env, {
    cookie: adaCookie,
    body: { code: 'LA/26A/0124', deviceId: 'dev_other_9999', ...AT_VENUE },
  });
  assert.equal(hijackRes.status, 403);
  assert.match((await hijackRes.json()).error, /already permanently linked/i);

  // 11. Device lock: Chidi blocked on Ada's phone while enforceDeviceLock is ON
  const devLockRes = await callHandler(handlers.checkinSubmit, 'POST', '/api/checkin/submit', env, {
    cookie: chidiCookie,
    body: { code: 'LA/26A/0124', deviceId: 'dev_ada_1111', ...AT_VENUE },
  });
  assert.equal(devLockRes.status, 409);
  assert.match((await devLockRes.json()).error, /phone has already been used/i);

  // 12. Chidi checks in on own phone -> #2
  const c2Res = await callHandler(handlers.checkinSubmit, 'POST', '/api/checkin/submit', env, {
    cookie: chidiCookie,
    body: { code: 'LA/26A/0124', deviceId: 'dev_chidi_2222', ...AT_VENUE },
  });
  assert.equal(c2Res.status, 201);
  assert.equal((await c2Res.json()).number, 2);

  // 13. Rotating Venue QR mode ON: missing QR rejected, fresh token succeeds -> #3
  await callHandler(handlers.adminSettings, 'PUT', '/api/admin/settings', env, {
    cookie: adminCookie,
    body: { requireQr: true },
  });

  const noQrRes = await callHandler(handlers.checkinSubmit, 'POST', '/api/checkin/submit', env, {
    cookie: bolaCookie,
    body: { code: 'LA/26A/0125', deviceId: 'dev_bola_3333', ...AT_VENUE },
  });
  assert.equal(noQrRes.status, 400);
  assert.match((await noQrRes.json()).error, /live QR code/i);

  const qrRes = await callHandler(handlers.adminQrToken, 'GET', '/api/admin/qr-token', env, {
    cookie: adminCookie,
  });
  const qr = await qrRes.json();
  assert.equal(qr.todayCount, 2);

  const c3Res = await callHandler(handlers.checkinSubmit, 'POST', '/api/checkin/submit', env, {
    cookie: bolaCookie,
    body: { code: 'LA/26A/0125', deviceId: 'dev_bola_3333', ...AT_VENUE, qrToken: qr.token },
  });
  assert.equal(c3Res.status, 201);
  const c3 = await c3Res.json();
  assert.equal(c3.number, 3);
  assert.equal(c3.qrVerified, true);

  // 14. Manual Exco fallback check-in -> #4
  const c4Res = await callHandler(handlers.adminCheckins, 'POST', '/api/admin/checkins', env, {
    cookie: adminCookie,
    body: { code: 'LA/26A/0126', note: 'Phone battery dead' },
  });
  assert.equal(c4Res.status, 201);
  assert.equal((await c4Res.json()).number, 4);

  // 15. Unbind claim removes link cleanly
  const unbindRes = await callHandler(handlers.adminUnbind, 'POST', '/api/admin/unbind', env, {
    cookie: adminCookie,
    body: { code: 'LA/26A/0123' },
  });
  assert.equal(unbindRes.status, 200);
  const claimRow = await DB.prepare(`SELECT * FROM claims WHERE code_id = 'LA_26A_0123'`).first();
  assert.equal(claimRow, null);

  // 16. Monthly Clearance Report calculates attendance accurately
  const month = c1.day.slice(0, 7);
  const repRes = await callHandler(
    handlers.adminMonthly,
    'GET',
    `/api/admin/monthly-report?month=${month}`,
    env,
    { cookie: adminCookie }
  );
  assert.equal(repRes.status, 200);
  const rep = await repRes.json();
  assert.equal(rep.totalSessions, 1);
  assert.equal(rep.rows.length, 4);
  assert.equal(rep.rows.every((r) => r.attended === 1 && r.percentage === 100), true);

  // Cleanup temp compile output
  fs.rmSync(compiledDir, { recursive: true, force: true });
});
