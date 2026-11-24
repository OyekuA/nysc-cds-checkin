import { requireAdmin } from '../../_lib/auth';
import { generateQrToken } from '../../_lib/crypto';
import { ensureSchema, getSettings } from '../../_lib/db';
import { getLagosDateInfo } from '../../_lib/geo';
import { Env, jsonResponse } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const { settings, qrSecret } = await getSettings(env);
  const lagos = getLagosDateInfo();

  const [tokenInfo, countRow] = await Promise.all([
    generateQrToken(qrSecret, settings.qrRotationSeconds, Date.now()),
    env.DB.prepare(`SELECT COUNT(*) AS cnt FROM checkins WHERE day = ?`)
      .bind(lagos.day)
      .first<{ cnt: number }>(),
  ]);

  return jsonResponse({
    ...tokenInfo,
    requireQr: settings.requireQr,
    checkInOpen: settings.checkInOpen,
    venueName: settings.venue.name,
    todayDay: lagos.day,
    todayCount: Number(countRow?.cnt ?? 0),
  });
};
