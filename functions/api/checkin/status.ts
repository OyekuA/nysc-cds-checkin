import { getSessionUser } from '../../_lib/auth';
import { CheckInRow, ensureSchema, getSettings, rowToCheckInDTO } from '../../_lib/db';
import { getLagosDateInfo } from '../../_lib/geo';
import { CheckInDTO, Env, jsonResponse } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  await ensureSchema(env);
  const [{ settings }, user] = await Promise.all([getSettings(env), getSessionUser(request, env)]);
  const lagos = getLagosDateInfo();

  let claimedCode: string | null = null;
  let checkedIn: CheckInDTO | null = null;

  if (user) {
    const [claimRow, checkinRow] = await Promise.all([
      env.DB.prepare(`SELECT code_id FROM claims WHERE google_sub = ? LIMIT 1`)
        .bind(user.sub)
        .first<{ code_id: string }>(),
      env.DB.prepare(`SELECT * FROM checkins WHERE day = ? AND google_sub = ? LIMIT 1`)
        .bind(lagos.day, user.sub)
        .first<CheckInRow>(),
    ]);

    if (claimRow?.code_id) {
      claimedCode = claimRow.code_id.replace(/_/g, '/');
    }
    if (checkinRow) {
      checkedIn = rowToCheckInDTO(checkinRow);
    }
  }

  return jsonResponse({
    settings,
    serverDay: lagos.day,
    serverTimeHHMM: lagos.hhmm,
    claimedCode,
    checkedIn,
  });
};
