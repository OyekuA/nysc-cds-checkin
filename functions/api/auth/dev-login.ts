import { createSessionCookie, isLocalDevRequest } from '../../_lib/auth';
import { Env, errorResponse, jsonResponse } from '../../_lib/types';

/**
 * Localhost-only test sign-in enabled strictly when DEV_AUTH=true on localhost/127.0.0.1.
 * Completely disabled on any deployed Cloudflare Pages domain.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isLocalDevRequest(request, env)) {
    return errorResponse('Dev sign-in is only available on localhost with DEV_AUTH=true.', 403);
  }

  const body = (await request.json().catch(() => ({}))) as { email?: string; name?: string };
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return errorResponse('Provide a valid test email address.', 400);
  }

  const user = {
    sub: `dev_${email}`,
    email,
    name: String(body.name || email.split('@')[0]),
  };

  const cookie = await createSessionCookie(env, user, request.url);
  return jsonResponse({ user }, 200, { 'Set-Cookie': cookie });
};
