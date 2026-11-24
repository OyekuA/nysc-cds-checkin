import { requireAdmin } from '../../_lib/auth';
import {
  CheckInRow,
  ensureSchema,
  getSettings,
  rowToCheckInDTO,
  writeAuditLog,
} from '../../_lib/db';
import { getLagosDateInfo, normalizeStateCode, parseHHMM } from '../../_lib/geo';
import { Env, errorResponse, jsonResponse } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const url = new URL(request.url);
  const day = url.searchParams.get('day') || getLagosDateInfo().day;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return errorResponse('Date must be in YYYY-MM-DD format.', 400);
  }

  const { results } = await env.DB.prepare(
    `SELECT * FROM checkins WHERE day = ? ORDER BY number ASC`
  )
    .bind(day)
    .all<CheckInRow>();

  return jsonResponse({
    day,
    checkins: results.map(rowToCheckInDTO),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    note?: string;
    statusOverride?: 'on_time' | 'late';
    dayOverride?: string;
  };

  const norm = normalizeStateCode(body.code ?? '');
  if (!norm) {
    return errorResponse('Provide a valid state code (e.g. LA/26A/0123).', 400);
  }

  const { settings } = await getSettings(env);
  const now = new Date();
  const lagos = getLagosDateInfo(now);
  const day =
    typeof body.dayOverride === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dayOverride)
      ? body.dayOverride
      : lagos.day;

  const status: 'on_time' | 'late' =
    body.statusOverride === 'on_time' || body.statusOverride === 'late'
      ? body.statusOverride
      : lagos.minutesOfDay > parseHHMM(settings.lateAfter)
        ? 'late'
        : 'on_time';

  const cleanNote = String(body.note ?? '').trim().slice(0, 200) || 'Manual Exco check-in';

  const member = await env.DB.prepare(`SELECT code_id, code, name FROM members WHERE code_id = ?`)
    .bind(norm.codeId)
    .first<{ code_id: string; code: string; name: string }>();

  if (!member) {
    return errorResponse(`${norm.code} is not on the roster. Add them first.`, 404);
  }

  const existing = await env.DB.prepare(`SELECT number FROM checkins WHERE day = ? AND code_id = ?`)
    .bind(day, norm.codeId)
    .first<{ number: number }>();

  if (existing) {
    return errorResponse(`${norm.code} is already checked in for ${day} (#${existing.number}).`, 409);
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO checkins (
      day, code_id, code, name, number, status, google_sub, email, device_id,
      qr_verified, method, recorded_by, manual_note, checked_in_at
    ) VALUES (
      ?, ?, ?, ?,
      (SELECT COALESCE(MAX(number), 0) + 1 FROM checkins WHERE day = ?),
      ?, NULL, '', NULL, 0, 'manual', ?, ?, ?
    ) RETURNING *`
  )
    .bind(
      day,
      norm.codeId,
      norm.code,
      member.name || '',
      day,
      status,
      auth.user.email,
      cleanNote,
      now.toISOString()
    )
    .first<CheckInRow>();

  const record = inserted
    ? rowToCheckInDTO(inserted)
    : rowToCheckInDTO(
        (await env.DB.prepare(`SELECT * FROM checkins WHERE day = ? AND code_id = ?`)
          .bind(day, norm.codeId)
          .first<CheckInRow>())!
      );

  await writeAuditLog(env, auth.user.email, 'manual_checkin', {
    day,
    code: norm.code,
    number: record.number,
    status,
    note: cleanNote,
  });

  return jsonResponse(record, 201);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const url = new URL(request.url);
  const day = url.searchParams.get('day') || '';
  const codeId = url.searchParams.get('codeId') || '';
  if (!day || !codeId) {
    return errorResponse('Missing day or codeId.', 400);
  }

  const existing = await env.DB.prepare(`SELECT number FROM checkins WHERE day = ? AND code_id = ?`)
    .bind(day, codeId)
    .first<{ number: number }>();

  if (!existing) {
    return errorResponse('Check-in record not found.', 404);
  }

  await env.DB.prepare(`DELETE FROM checkins WHERE day = ? AND code_id = ?`)
    .bind(day, codeId)
    .run();

  await writeAuditLog(env, auth.user.email, 'delete_checkin', {
    day,
    codeId,
    number: existing.number,
  });

  return jsonResponse({ ok: true });
};
