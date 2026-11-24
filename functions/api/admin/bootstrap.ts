import { requireAdmin } from '../../_lib/auth';
import { ensureSchema, getAdminEmails, getBootstrapAdminEmail, getSettings } from '../../_lib/db';
import { getLagosDateInfo } from '../../_lib/geo';
import { Env, jsonResponse } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const [{ settings }, admins, countRow] = await Promise.all([
    getSettings(env),
    getAdminEmails(env),
    env.DB.prepare(`SELECT COUNT(*) AS cnt FROM members`).first<{ cnt: number }>(),
  ]);
  const lagos = getLagosDateInfo();

  return jsonResponse({
    adminEmail: auth.user.email,
    primaryAdmin: getBootstrapAdminEmail(env),
    settings,
    admins,
    rosterCount: Number(countRow?.cnt ?? 0),
    todayDay: lagos.day,
    serverTimeHHMM: lagos.hhmm,
  });
};
