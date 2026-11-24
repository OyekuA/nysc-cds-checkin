const DEVICE_KEY = 'nysc_cds_device_id_v1';
const LEGACY_DEVICE_KEY = 'deviceId';

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Returns a stable device identifier (migrating any legacy `deviceId` value).
 * Does NOT use brittle storage-quota incognito checks that falsely lock out
 * low-storage Android phones.
 */
export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY) || localStorage.getItem(LEGACY_DEVICE_KEY);
    if (existing && existing.length >= 8) {
      localStorage.setItem(DEVICE_KEY, existing);
      return existing;
    }
    const created = generateId();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    // Fallback to sessionStorage or in-memory UUID if storage is restricted
    try {
      const s = sessionStorage.getItem(DEVICE_KEY);
      if (s && s.length >= 8) return s;
      const created = generateId();
      sessionStorage.setItem(DEVICE_KEY, created);
      return created;
    } catch {
      return generateId();
    }
  }
}

const QR_SESSION_KEY = 'nysc_cds_qr_token';

/**
 * Captures `?t=<token>` from a scanned rotating venue QR URL into sessionStorage
 * so the token survives a Google Sign-In redirect on mobile.
 */
export function captureQrTokenFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('t')?.trim();
    if (fromUrl) {
      sessionStorage.setItem(
        QR_SESSION_KEY,
        JSON.stringify({ token: fromUrl, capturedAt: Date.now() })
      );
      return fromUrl;
    }
    const saved = sessionStorage.getItem(QR_SESSION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { token?: string; capturedAt?: number };
      // Only reuse a captured QR token for up to 3 minutes
      if (parsed.token && parsed.capturedAt && Date.now() - parsed.capturedAt < 180_000) {
        return parsed.token;
      }
      sessionStorage.removeItem(QR_SESSION_KEY);
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

export function saveQrToken(token: string): void {
  try {
    sessionStorage.setItem(
      QR_SESSION_KEY,
      JSON.stringify({ token: token.trim(), capturedAt: Date.now() })
    );
  } catch {
    // Ignore
  }
}

export function clearQrToken(): void {
  try {
    sessionStorage.removeItem(QR_SESSION_KEY);
    const url = new URL(window.location.href);
    if (url.searchParams.has('t')) {
      url.searchParams.delete('t');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  } catch {
    // Ignore
  }
}
