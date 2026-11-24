import { signPayload, verifySignedPayload } from './crypto';
import { getAdminEmails, resolveSessionSecret } from './db';
import { Env, SessionUser, errorResponse } from './types';

export const SESSION_COOKIE = 'nysc_session';
export const OAUTH_STATE_COOKIE = 'nysc_oauth_state';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

interface SessionPayload extends SessionUser {
  exp: number;
}

export function getSessionSecret(env: Env): Promise<string> {
  return resolveSessionSecret(env);
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function buildCookie(
  name: string,
  value: string,
  requestUrl: string,
  maxAgeSeconds: number
): string {
  const isHttps = requestUrl.startsWith('https://');
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

export async function createSessionCookie(
  env: Env,
  user: SessionUser,
  requestUrl: string
): Promise<string> {
  const payload: SessionPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC,
  };
  const secret = await getSessionSecret(env);
  const token = await signPayload(secret, payload);
  return buildCookie(SESSION_COOKIE, token, requestUrl, SESSION_MAX_AGE_SEC);
}

export function clearSessionCookie(requestUrl: string): string {
  return buildCookie(SESSION_COOKIE, '', requestUrl, 0);
}

export async function getSessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;

  let secret: string;
  try {
    secret = await getSessionSecret(env);
  } catch {
    return null;
  }

  const parsed = await verifySignedPayload<SessionPayload>(secret, raw);
  if (!parsed || !parsed.sub || !parsed.email) return null;
  if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    sub: String(parsed.sub),
    email: String(parsed.email).toLowerCase(),
    name: String(parsed.name || ''),
  };
}

export async function requireUser(
  request: Request,
  env: Env
): Promise<{ user: SessionUser } | { response: Response }> {
  const user = await getSessionUser(request, env);
  if (!user) {
    return { response: errorResponse('Please sign in with Google first.', 401) };
  }
  return { user };
}

export async function requireAdmin(
  request: Request,
  env: Env
): Promise<{ user: SessionUser } | { response: Response }> {
  const res = await requireUser(request, env);
  if ('response' in res) return res;

  const admins = await getAdminEmails(env);
  if (!admins.includes(res.user.email.toLowerCase())) {
    return {
      response: errorResponse(`${res.user.email} is not authorized as an Exco admin.`, 403),
    };
  }
  return res;
}

export function sanitizeNextPath(raw: string | null): string {
  if (!raw) return '/';
  const trimmed = raw.trim();
  // Only allow relative in-app paths (blocks open redirect attacks)
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  return trimmed;
}

export function isLocalDevRequest(request: Request, env: Env): boolean {
  if (env.DEV_AUTH !== 'true') return false;
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}
