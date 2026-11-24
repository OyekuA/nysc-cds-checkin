import {
  OAUTH_STATE_COOKIE,
  buildCookie,
  getSessionSecret,
  sanitizeNextPath,
} from '../../_lib/auth';
import { randomHex, signPayload } from '../../_lib/crypto';
import { Env } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const next = sanitizeNextPath(url.searchParams.get('next'));

  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId || !env.GOOGLE_CLIENT_SECRET?.trim()) {
    const dest = new URL(next, url.origin);
    dest.searchParams.set(
      'auth_error',
      'Google Sign-In is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare Pages settings.'
    );
    return Response.redirect(dest.toString(), 302);
  }

  const secret = await getSessionSecret(env);

  const nonce = randomHex(16);
  const stateToken = await signPayload(secret, {
    nonce,
    next,
    exp: Math.floor(Date.now() / 1000) + 600,
  });

  const redirectUri = `${url.origin}/api/auth/callback`;
  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', clientId);
  googleAuthUrl.searchParams.set('redirect_uri', redirectUri);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile');
  googleAuthUrl.searchParams.set('prompt', 'select_account');
  googleAuthUrl.searchParams.set('state', nonce);

  return new Response(null, {
    status: 302,
    headers: {
      Location: googleAuthUrl.toString(),
      'Set-Cookie': buildCookie(OAUTH_STATE_COOKIE, stateToken, request.url, 600),
      'Cache-Control': 'no-store',
    },
  });
};
