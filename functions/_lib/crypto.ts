const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function randomHex(bytesLen = 32): string {
  const buf = new Uint8Array(bytesLen);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(sig);
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function signPayload(secret: string, payload: unknown): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = toBase64Url(await hmacSha256(secret, body));
  return `${body}.${sig}`;
}

export async function verifySignedPayload<T>(secret: string, token: string): Promise<T | null> {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  if (!providedSig) return null;

  const expectedSig = toBase64Url(await hmacSha256(secret, body));
  if (!constantTimeEqual(providedSig, expectedSig)) return null;

  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

async function signQrWindow(secret: string, windowIndex: number): Promise<string> {
  const mac = await hmacSha256(secret, `nysc-cds-v2:${windowIndex}`);
  return toBase64Url(mac).slice(0, 16);
}

export async function generateQrToken(
  secret: string,
  rotationSeconds: number,
  nowMs: number = Date.now()
): Promise<{
  token: string;
  windowIndex: number;
  expiresAtMs: number;
  rotationSeconds: number;
  serverNowMs: number;
}> {
  const stepSec = Math.max(15, rotationSeconds);
  const stepMs = stepSec * 1000;
  const windowIndex = Math.floor(nowMs / stepMs);
  const sig = await signQrWindow(secret, windowIndex);
  return {
    token: `${windowIndex}.${sig}`,
    windowIndex,
    expiresAtMs: (windowIndex + 1) * stepMs,
    rotationSeconds: stepSec,
    serverNowMs: nowMs,
  };
}

export async function verifyQrToken(
  secret: string,
  token: unknown,
  rotationSeconds: number,
  nowMs: number = Date.now()
): Promise<boolean> {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [rawWin, providedSig] = token.trim().split('.');
  if (!/^\d+$/.test(rawWin) || !providedSig || providedSig.length !== 16) return false;

  const providedWin = Number(rawWin);
  const stepMs = Math.max(15, rotationSeconds) * 1000;
  const currentWin = Math.floor(nowMs / stepMs);

  // Accept current and immediately preceding window (45-90s grace window)
  if (providedWin !== currentWin && providedWin !== currentWin - 1) {
    return false;
  }

  const expectedSig = await signQrWindow(secret, providedWin);
  return constantTimeEqual(providedSig, expectedSig);
}
