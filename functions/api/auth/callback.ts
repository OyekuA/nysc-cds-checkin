import {
  OAUTH_STATE_COOKIE,
  buildCookie,
  createSessionCookie,
  getSessionSecret,
  parseCookies,
  sanitizeNextPath,
} from '../../_lib/auth';
import { constantTimeEqual, verifySignedPayload } from '../../_lib/crypto';
import { Env } from '../../_lib/types';

interface OAuthStatePayload {
  nonce: string;
  next: string;
  exp: number;
}

function redirectWithError(origin: string, nextPath: string, message: string, requestUrl: string): Response {
  const dest = new URL(nextPath, origin);
  dest.searchParams.set('auth_error', message);
  const headers = new Headers();
  headers.set('Location', dest.toString());
  headers.append('Set-Cookie', buildCookie(OAUTH_STATE_COOKIE, '', requestUrl, 0));
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get('Cookie'));
  const rawStateCookie = cookies[OAUTH_STATE_COOKIE];

  const secret = await getSessionSecret(env);

  const savedState = rawStateCookie
    ? await verifySignedPayload<OAuthStatePayload>(secret, rawStateCookie)
    : null;
  const nextPath = sanitizeNextPath(savedState?.next ?? '/');

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const msg =
      oauthError === 'access_denied'
        ? 'Google sign-in was cancelled. Tap "Sign in with Google" to try again.'
        : `Google sign-in failed (${oauthError}). Please try again.`;
    return redirectWithError(url.origin, nextPath, msg, request.url);
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state') || '';

  if (
    !code ||
    !savedState ||
    savedState.exp < Math.floor(Date.now() / 1000) ||
    !constantTimeEqual(savedState.nonce, returnedState)
  ) {
    return redirectWithError(
      url.origin,
      nextPath,
      'Your sign-in session expired or cookies are blocked. Open this link in Chrome or Safari and try again.',
      request.url
    );
  }

  const clientId = env.GOOGLE_CLIENT_ID?.trim() || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || '';
  const redirectUri = `${url.origin}/api/auth/callback`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      return redirectWithError(
        url.origin,
        nextPath,
        'Could not complete Google sign-in. Please tap "Sign in with Google" again.',
        request.url
      );
    }

    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      return redirectWithError(
        url.origin,
        nextPath,
        'Google did not return an access token. Please try again.',
        request.url
      );
    }

    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });

    if (!userRes.ok) {
      return redirectWithError(
        url.origin,
        nextPath,
        'Could not read your Google profile. Please try again.',
        request.url
      );
    }

    const profile = (await userRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    if (!profile.sub || !profile.email) {
      return redirectWithError(
        url.origin,
        nextPath,
        'Your Google account did not share an email address. Try another Google account.',
        request.url
      );
    }

    const sessionCookie = await createSessionCookie(
      env,
      {
        sub: String(profile.sub),
        email: String(profile.email).toLowerCase(),
        name: String(profile.name || ''),
      },
      request.url
    );

    const headers = new Headers();
    headers.set('Location', new URL(nextPath, url.origin).toString());
    headers.append('Set-Cookie', sessionCookie);
    headers.append('Set-Cookie', buildCookie(OAUTH_STATE_COOKIE, '', request.url, 0));
    headers.set('Cache-Control', 'no-store');
    return new Response(null, { status: 302, headers });
  } catch {
    return redirectWithError(
      url.origin,
      nextPath,
      'Network issue while contacting Google. Please check your connection and try again.',
      request.url
    );
  }
};
