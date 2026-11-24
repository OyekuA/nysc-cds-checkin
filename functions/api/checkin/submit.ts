import { requireUser } from '../../_lib/auth';
import { verifyQrToken } from '../../_lib/crypto';
import { CheckInRow, ensureSchema, getSettings, rowToCheckInDTO } from '../../_lib/db';
import {
  getLagosDateInfo,
  haversineMetres,
  normalizeStateCode,
  parseHHMM,
} from '../../_lib/geo';
import { Env, errorResponse, jsonResponse } from '../../_lib/types';

interface SubmitBody {
  code?: string;
  deviceId?: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  gpsAgeMs?: number;
  qrToken?: string | null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(request, env);
  if ('response' in auth) return auth.response;
  const { user } = auth;

  await ensureSchema(env);

  const body = (await request.json().catch(() => ({}))) as SubmitBody;

  // 1. Validate state code format
  const normalized = normalizeStateCode(body.code ?? '');
  if (!normalized) {
    return errorResponse('That state code format is not valid. It should look like LA/26A/0123.', 400);
  }

  // 2. Validate deviceId
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
  if (deviceId.length < 8 || deviceId.length > 128) {
    return errorResponse('Missing device identifier. Reload the page and try again.', 400);
  }

  // 3. Load venue settings & server clock (Africa/Lagos)
  const { settings, qrSecret } = await getSettings(env);
  const now = new Date();
  const lagos = getLagosDateInfo(now);
  const day = lagos.day;

  if (
    settings.allowedStates.length > 0 &&
    !settings.allowedStates.includes(normalized.state)
  ) {
    return errorResponse(
      `Only ${settings.allowedStates.join(', ')} state codes are accepted for this CDS group.`,
      400
    );
  }

  if (!settings.checkInOpen) {
    return errorResponse(
      'Check-in is currently closed by the ICT Excos. Please wait for the session to open.',
      403
    );
  }

  if (settings.enforceWindow) {
    const startMin = parseHHMM(settings.windowStart);
    const endMin = parseHHMM(settings.windowEnd);
    if (lagos.minutesOfDay < startMin) {
      return errorResponse(
        `Check-in has not opened yet. Today's window opens at ${settings.windowStart} WAT.`,
        403
      );
    }
    if (lagos.minutesOfDay > endMin) {
      return errorResponse(
        `Check-in closed at ${settings.windowEnd} WAT. Contact an Exco if you need assistance.`,
        403
      );
    }
  }

  // 4. Verify rotating Venue QR token (if required or provided)
  let qrVerified = false;
  if (settings.requireQr || (typeof body.qrToken === 'string' && body.qrToken.trim().length > 0)) {
    const ok = await verifyQrToken(qrSecret, body.qrToken, settings.qrRotationSeconds, now.getTime());
    if (ok) {
      qrVerified = true;
    } else if (settings.requireQr) {
      const msg =
        !body.qrToken || !String(body.qrToken).trim()
          ? "Today's session requires scanning the live QR code displayed at the venue."
          : 'That venue QR code has expired. Scan the current QR code on the venue screen and try again.';
      return errorResponse(msg, 400);
    }
  }

  // 5. Validate live GPS freshness, accuracy, and server-side Haversine geofence
  const { lat, lng, accuracyM, gpsAgeMs } = body;
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return errorResponse(
      'Could not read valid GPS coordinates from your phone. Tap Refresh GPS and try again.',
      400
    );
  }

  const safeAccuracy =
    typeof accuracyM === 'number' && Number.isFinite(accuracyM) ? Math.round(accuracyM) : 9999;
  const safeAgeMs =
    typeof gpsAgeMs === 'number' && Number.isFinite(gpsAgeMs) ? Math.round(gpsAgeMs) : 999999;

  if (safeAgeMs > 25_000) {
    return errorResponse(
      'Your location reading was stale (from an earlier location). Tap Refresh GPS to lock your live location and try again.',
      400
    );
  }

  if (safeAccuracy > settings.maxAccuracyM) {
    return errorResponse(
      `Your phone's GPS accuracy (±${safeAccuracy} m) is too coarse (must be within ±${settings.maxAccuracyM} m). Turn on Precise Location in your phone settings and step toward an open spot.`,
      400
    );
  }

  const distanceM = Math.round(
    haversineMetres(lat, lng, settings.venue.lat, settings.venue.lng)
  );
  if (distanceM > settings.radiusM) {
    return errorResponse(
      `You're too far from ${settings.venue.name} (about ${distanceM} m away, GPS accuracy ±${safeAccuracy} m, allowed radius ${settings.radiusM} m). Move closer and tap Refresh GPS.`,
      400
    );
  }

  // 6. Check roster membership, idempotency, bi-directional 1:1 claims, and daily locks
  const codeId = normalized.codeId;
  const [member, existingCodeCheckin, existingUserCheckin, codeClaim, userClaim, deviceCheckin] =
    await Promise.all([
      env.DB.prepare(`SELECT code_id, code, name FROM members WHERE code_id = ?`)
        .bind(codeId)
        .first<{ code_id: string; code: string; name: string }>(),
      env.DB.prepare(`SELECT * FROM checkins WHERE day = ? AND code_id = ?`)
        .bind(day, codeId)
        .first<CheckInRow>(),
      env.DB.prepare(`SELECT * FROM checkins WHERE day = ? AND google_sub = ?`)
        .bind(day, user.sub)
        .first<CheckInRow>(),
      env.DB.prepare(`SELECT code_id, google_sub FROM claims WHERE code_id = ?`)
        .bind(codeId)
        .first<{ code_id: string; google_sub: string }>(),
      env.DB.prepare(`SELECT code_id, google_sub FROM claims WHERE google_sub = ?`)
        .bind(user.sub)
        .first<{ code_id: string; google_sub: string }>(),
      settings.enforceDeviceLock
        ? env.DB.prepare(`SELECT code_id, google_sub FROM checkins WHERE day = ? AND device_id = ? LIMIT 1`)
            .bind(day, deviceId)
            .first<{ code_id: string; google_sub: string | null }>()
        : Promise.resolve(null),
    ]);

  if (!member) {
    return errorResponse(
      `${normalized.code} is not on the CDS roster yet. Please contact an ICT Exco to be added.`,
      404
    );
  }

  // Idempotent return if this exact user already checked in this code today
  if (existingCodeCheckin) {
    if (existingCodeCheckin.google_sub === user.sub) {
      return jsonResponse(rowToCheckInDTO(existingCodeCheckin));
    }
    return errorResponse(`${normalized.code} has already been checked in today.`, 409);
  }

  // Bi-directional 1:1 binding enforced both in logic AND via SQLite PRIMARY KEY / UNIQUE constraints
  if (codeClaim && codeClaim.google_sub !== user.sub) {
    return errorResponse(
      `${normalized.code} is already linked to a different Google account. Sign in with the Google account you used previously, or ask an ICT Exco to unbind it.`,
      403
    );
  }

  if (userClaim && userClaim.code_id !== codeId) {
    const boundCode = userClaim.code_id.replace(/_/g, '/');
    return errorResponse(
      `Your Google account is already permanently linked to ${boundCode}. You cannot check in a different state code with this account.`,
      403
    );
  }

  if (existingUserCheckin) {
    return errorResponse('This Google account has already been used to check in today.', 409);
  }

  if (settings.enforceDeviceLock && deviceCheckin && deviceCheckin.google_sub !== user.sub) {
    return errorResponse(
      'This phone has already been used to check in today. Each corps member must check in on their own device.',
      409
    );
  }

  const status: 'on_time' | 'late' =
    lagos.minutesOfDay > parseHHMM(settings.lateAfter) ? 'late' : 'on_time';
  const checkedInAtIso = now.toISOString();

  // 7. Atomic batch insert: claim (if new) + sequential check-in number (retried if rare number race)
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const statements: D1PreparedStatement[] = [];
      if (!codeClaim) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO claims (code_id, google_sub, email) VALUES (?, ?, ?)`
          ).bind(codeId, user.sub, user.email)
        );
      }
      statements.push(
        env.DB.prepare(
          `INSERT INTO checkins (
            day, code_id, code, name, number, status, google_sub, email, device_id,
            distance_m, accuracy_m, lat, lng, gps_age_ms, qr_verified, method, checked_in_at
          ) VALUES (
            ?, ?, ?, ?,
            (SELECT COALESCE(MAX(number), 0) + 1 FROM checkins WHERE day = ?),
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'self', ?
          ) RETURNING *`
        ).bind(
          day,
          codeId,
          normalized.code,
          member.name || '',
          day,
          status,
          user.sub,
          user.email,
          deviceId,
          distanceM,
          safeAccuracy,
          lat,
          lng,
          safeAgeMs,
          qrVerified ? 1 : 0,
          checkedInAtIso
        )
      );

      const results = await env.DB.batch<CheckInRow>(statements);
      const inserted = results[results.length - 1]?.results?.[0];
      if (inserted) {
        return jsonResponse(rowToCheckInDTO(inserted), 201);
      }
      // Fallback read if SQLite runtime didn't populate RETURNING rows
      const row = await env.DB.prepare(`SELECT * FROM checkins WHERE day = ? AND code_id = ?`)
        .bind(day, codeId)
        .first<CheckInRow>();
      if (row) {
        return jsonResponse(rowToCheckInDTO(row), 201);
      }
    } catch (err: unknown) {
      const msg = String((err as { message?: string })?.message || err);
      // Re-check idempotency on concurrent double-tap
      if (/UNIQUE constraint failed: checkins\.day, checkins\.code_id/i.test(msg)) {
        const existing = await env.DB.prepare(`SELECT * FROM checkins WHERE day = ? AND code_id = ?`)
          .bind(day, codeId)
          .first<CheckInRow>();
        if (existing && existing.google_sub === user.sub) {
          return jsonResponse(rowToCheckInDTO(existing));
        }
        return errorResponse(`${normalized.code} has already been checked in today.`, 409);
      }
      if (/UNIQUE constraint failed: checkins\.day, checkins\.number/i.test(msg) && attempt < 5) {
        continue;
      }
      if (/UNIQUE constraint failed: claims/i.test(msg)) {
        return errorResponse(
          'This state code or Google account is already linked to another member.',
          403
        );
      }
      if (/UNIQUE constraint failed: checkins\.day, checkins\.google_sub/i.test(msg)) {
        return errorResponse('This Google account has already been used to check in today.', 409);
      }
      return errorResponse('Could not save your check-in. Please try again.', 500);
    }
  }

  return errorResponse('Server is busy with rush-hour check-ins. Please tap Check In again.', 503);
};
