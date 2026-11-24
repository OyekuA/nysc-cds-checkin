import { requireAdmin } from '../../_lib/auth';
import {
  ensureSchema,
  getAdminEmails,
  getBootstrapAdminEmail,
  writeAuditLog,
} from '../../_lib/db';
import { Env, errorResponse, jsonResponse } from '../../_lib/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const target = String(body.email || '').trim().toLowerCase();
  if (!target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    return errorResponse('Provide a valid Google email address.', 400);
  }

  await env.DB.prepare(`INSERT OR IGNORE INTO admins (email, added_by) VALUES (?, ?)`)
    .bind(target, auth.user.email)
    .run();

  await writeAuditLog(env, auth.user.email, 'admin_add', { target });
  const admins = await getAdminEmails(env);
  return jsonResponse({ admins });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const url = new URL(request.url);
  const target = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!target) {
    return errorResponse('Missing email parameter.', 400);
  }
  if (target === getBootstrapAdminEmail(env)) {
    return errorResponse('The primary super-admin account cannot be removed.', 400);
  }

  await env.DB.prepare(`DELETE FROM admins WHERE email = ?`).bind(target).run();
  await writeAuditLog(env, auth.user.email, 'admin_remove', { target });
  const admins = await getAdminEmails(env);
  return jsonResponse({ admins });
};
