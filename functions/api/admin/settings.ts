import { requireAdmin } from '../../_lib/auth';
import { randomHex } from '../../_lib/crypto';
import { ensureSchema, getSettings, writeAuditLog } from '../../_lib/db';
import { isValidHHMM } from '../../_lib/geo';
import { AppSettings, Env, jsonResponse } from '../../_lib/types';

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const patch = (await request.json().catch(() => ({}))) as Partial<AppSettings>;
  const { settings: current } = await getSettings(env);

  const next: AppSettings = {
    venue: {
      lat:
        typeof patch.venue?.lat === 'number' &&
        Number.isFinite(patch.venue.lat) &&
        Math.abs(patch.venue.lat) <= 90
          ? patch.venue.lat
          : current.venue.lat,
      lng:
        typeof patch.venue?.lng === 'number' &&
        Number.isFinite(patch.venue.lng) &&
        Math.abs(patch.venue.lng) <= 180
          ? patch.venue.lng
          : current.venue.lng,
      name:
        typeof patch.venue?.name === 'string' && patch.venue.name.trim()
          ? patch.venue.name.trim().slice(0, 120)
          : current.venue.name,
    },
    radiusM:
      typeof patch.radiusM === 'number' && Number.isFinite(patch.radiusM)
        ? Math.min(2000, Math.max(20, Math.round(patch.radiusM)))
        : current.radiusM,
    maxAccuracyM:
      typeof patch.maxAccuracyM === 'number' && Number.isFinite(patch.maxAccuracyM)
        ? Math.min(500, Math.max(30, Math.round(patch.maxAccuracyM)))
        : current.maxAccuracyM,
    requireQr: typeof patch.requireQr === 'boolean' ? patch.requireQr : current.requireQr,
    qrRotationSeconds:
      typeof patch.qrRotationSeconds === 'number' && Number.isFinite(patch.qrRotationSeconds)
        ? Math.min(300, Math.max(15, Math.round(patch.qrRotationSeconds)))
        : current.qrRotationSeconds,
    checkInOpen: typeof patch.checkInOpen === 'boolean' ? patch.checkInOpen : current.checkInOpen,
    enforceDeviceLock:
      typeof patch.enforceDeviceLock === 'boolean'
        ? patch.enforceDeviceLock
        : current.enforceDeviceLock,
    enforceWindow:
      typeof patch.enforceWindow === 'boolean' ? patch.enforceWindow : current.enforceWindow,
    windowStart: isValidHHMM(patch.windowStart) ? patch.windowStart.trim() : current.windowStart,
    lateAfter: isValidHHMM(patch.lateAfter) ? patch.lateAfter.trim() : current.lateAfter,
    windowEnd: isValidHHMM(patch.windowEnd) ? patch.windowEnd.trim() : current.windowEnd,
    allowedStates: Array.isArray(patch.allowedStates)
      ? patch.allowedStates
          .map((s) => String(s).trim().toUpperCase())
          .filter((s) => /^[A-Z]{2}$/.test(s))
      : current.allowedStates,
  };

  await env.DB.prepare(
    `UPDATE settings SET
      venue_lat = ?, venue_lng = ?, venue_name = ?,
      radius_m = ?, max_accuracy_m = ?,
      require_qr = ?, qr_rotation_seconds = ?,
      check_in_open = ?, enforce_device_lock = ?, enforce_window = ?,
      window_start = ?, late_after = ?, window_end = ?,
      allowed_states = ?, updated_at = datetime('now')
     WHERE id = 1`
  )
    .bind(
      next.venue.lat,
      next.venue.lng,
      next.venue.name,
      next.radiusM,
      next.maxAccuracyM,
      next.requireQr ? 1 : 0,
      next.qrRotationSeconds,
      next.checkInOpen ? 1 : 0,
      next.enforceDeviceLock ? 1 : 0,
      next.enforceWindow ? 1 : 0,
      next.windowStart,
      next.lateAfter,
      next.windowEnd,
      JSON.stringify(next.allowedStates)
    )
    .run();

  await writeAuditLog(env, auth.user.email, 'update_settings', { next });
  return jsonResponse({ settings: next });
};

/**
 * POST /api/admin/settings rotates the HMAC QR signing secret immediately.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  await env.DB.prepare(
    `UPDATE settings SET qr_secret = ?, updated_at = datetime('now') WHERE id = 1`
  )
    .bind(randomHex(32))
    .run();

  await writeAuditLog(env, auth.user.email, 'rotate_qr_secret', {});
  return jsonResponse({ ok: true });
};
