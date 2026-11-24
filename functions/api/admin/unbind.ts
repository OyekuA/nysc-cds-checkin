import { requireAdmin } from '../../_lib/auth';
import { ensureSchema, writeAuditLog } from '../../_lib/db';
import { normalizeStateCode } from '../../_lib/geo';
import { Env, errorResponse, jsonResponse } from '../../_lib/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const norm = normalizeStateCode(body.code ?? '');
  if (!norm) {
    return errorResponse('Provide a valid state code (e.g. LA/26A/0123).', 400);
  }

  await env.DB.prepare(`DELETE FROM claims WHERE code_id = ?`).bind(norm.codeId).run();
  await writeAuditLog(env, auth.user.email, 'unbind_claim', { code: norm.code });
  return jsonResponse({ ok: true, code: norm.code });
};
