import { requireAdmin } from '../../_lib/auth';
import { ensureSchema } from '../../_lib/db';
import { LAGOS_TIMEZONE } from '../../_lib/geo';
import { Env, errorResponse, jsonResponse } from '../../_lib/types';

interface MonthlyCheckinRow {
  day: string;
  code_id: string;
  code: string;
  name: string;
  number: number;
  status: string;
  checked_in_at: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const url = new URL(request.url);
  const month = (url.searchParams.get('month') || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return errorResponse('Month must be in YYYY-MM format.', 400);
  }

  const startDay = `${month}-01`;
  const endDay = `${month}-31`;

  const [{ results: checkins }, { results: members }] = await Promise.all([
    env.DB.prepare(
      `SELECT day, code_id, code, name, number, status, checked_in_at
       FROM checkins
       WHERE day >= ? AND day <= ?
       ORDER BY day ASC, number ASC`
    )
      .bind(startDay, endDay)
      .all<MonthlyCheckinRow>(),
    env.DB.prepare(`SELECT code_id, code, name FROM members ORDER BY code ASC`).all<{
      code_id: string;
      code: string;
      name: string;
    }>(),
  ]);

  const namesMap = new Map<string, string>();
  const allCodeIds = new Set<string>();
  for (const m of members) {
    allCodeIds.add(m.code_id);
    namesMap.set(m.code_id, m.name || '');
  }

  const activeDaysSet = new Set<string>();
  const attendance = new Map<
    string,
    { days: Record<string, { number: number; status: string; time: string }>; onTime: number; late: number }
  >();

  for (const r of checkins) {
    activeDaysSet.add(r.day);
    allCodeIds.add(r.code_id);
    if (r.name && !namesMap.get(r.code_id)) {
      namesMap.set(r.code_id, r.name);
    }

    let entry = attendance.get(r.code_id);
    if (!entry) {
      entry = { days: {}, onTime: 0, late: 0 };
      attendance.set(r.code_id, entry);
    }
    const st = r.status === 'late' ? 'late' : 'on_time';
    if (st === 'late') entry.late++;
    else entry.onTime++;

    const time = r.checked_in_at
      ? new Date(r.checked_in_at).toLocaleTimeString('en-US', {
          timeZone: LAGOS_TIMEZONE,
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    entry.days[r.day] = { number: Number(r.number), status: st, time };
  }

  const activeDays = Array.from(activeDaysSet).sort();
  const totalSessions = activeDays.length;

  const rows = Array.from(allCodeIds)
    .map((codeId) => {
      const att = attendance.get(codeId);
      const attended = att ? Object.keys(att.days).length : 0;
      const pct = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;
      return {
        codeId,
        code: codeId.replace(/_/g, '/'),
        name: namesMap.get(codeId) || '',
        attended,
        onTime: att?.onTime ?? 0,
        late: att?.late ?? 0,
        totalSessions,
        percentage: pct,
        days: att?.days ?? {},
      };
    })
    .sort((a, b) => b.attended - a.attended || a.code.localeCompare(b.code));

  return jsonResponse({
    month,
    activeDays,
    totalSessions,
    rows,
  });
};
