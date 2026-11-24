import { apiRequest } from './api';

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
}

export interface AuthSessionResponse {
  user: AuthUser | null;
  isAdmin: boolean;
  devAuthEnabled: boolean;
  googleConfigured: boolean;
}

export interface InAppBrowserInfo {
  isInApp: boolean;
  appName: string | null;
  isAndroid: boolean;
  isIOS: boolean;
}

/**
 * Detects embedded in-app WebViews (WhatsApp, Instagram, Facebook, QR scanner apps, etc.)
 * where Google OAuth blocks sign-in with 403 disallowed_useragent.
 */
export function detectInAppBrowser(): InAppBrowserInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  const patterns: Array<[RegExp, string]> = [
    [/WhatsApp/i, 'WhatsApp'],
    [/Instagram/i, 'Instagram'],
    [/FBAN|FBAV|FB_IAB/i, 'Facebook'],
    [/Telegram/i, 'Telegram'],
    [/Snapchat/i, 'Snapchat'],
    [/TikTok|BytedanceWebview|musical_ly/i, 'TikTok'],
    [/Twitter|X\/|LinkedInApp/i, 'Social App'],
    [/Line\//i, 'LINE'],
    [/MicroMessenger/i, 'WeChat'],
  ];

  for (const [re, name] of patterns) {
    if (re.test(ua)) {
      return { isInApp: true, appName: name, isAndroid, isIOS };
    }
  }

  if (isAndroid && /; wv\)/i.test(ua)) {
    return { isInApp: true, appName: 'an in-app browser', isAndroid, isIOS };
  }

  if (
    isIOS &&
    /AppleWebKit/i.test(ua) &&
    !/Safari\//i.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)
  ) {
    return { isInApp: true, appName: 'an in-app browser', isAndroid, isIOS };
  }

  return { isInApp: false, appName: null, isAndroid, isIOS };
}

export function buildAndroidChromeIntentUrl(url: string): string {
  const cleaned = url.replace(/^https?:\/\//i, '');
  const scheme = url.startsWith('http://') ? 'http' : 'https';
  return `intent://${cleaned}#Intent;scheme=${scheme};package=com.android.chrome;end`;
}

/**
 * Reads and clears any `?auth_error=...` returned from the Google OAuth callback.
 */
export function consumeAuthErrorFromUrl(): string | null {
  try {
    const url = new URL(window.location.href);
    const err = url.searchParams.get('auth_error');
    if (err) {
      url.searchParams.delete('auth_error');
      window.history.replaceState({}, '', url.pathname + url.search);
      return err;
    }
  } catch {
    // Ignore
  }
  return null;
}

export function getCurrentSession(): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>('/api/auth/me', { retries: 1 });
}

/**
 * Starts same-origin Google OAuth 2.0 redirect flow (zero popups, zero third-party cookies).
 */
export function startGoogleSignIn(nextPath?: string): void {
  const next = nextPath ?? window.location.pathname + window.location.search;
  window.location.assign(`/api/auth/google?next=${encodeURIComponent(next)}`);
}

export async function devSignIn(email: string): Promise<AuthUser> {
  const res = await apiRequest<{ user: AuthUser }>('/api/auth/dev-login', {
    method: 'POST',
    body: { email },
  });
  return res.user;
}

export async function signOutUser(): Promise<void> {
  await apiRequest('/api/auth/logout', { method: 'POST' });
}
