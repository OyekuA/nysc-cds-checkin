export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
  DEV_AUTH?: string;
}

export interface SessionUser {
  sub: string;
  email: string;
  name: string;
}

export interface VenueConfig {
  lat: number;
  lng: number;
  name: string;
}

export interface AppSettings {
  venue: VenueConfig;
  radiusM: number;
  maxAccuracyM: number;
  requireQr: boolean;
  qrRotationSeconds: number;
  checkInOpen: boolean;
  enforceDeviceLock: boolean;
  enforceWindow: boolean;
  windowStart: string;
  lateAfter: string;
  windowEnd: string;
  allowedStates: string[];
}

export interface SettingsWithSecret {
  settings: AppSettings;
  qrSecret: string;
}

export interface CheckInDTO {
  day: string;
  codeId: string;
  code: string;
  name: string;
  number: number;
  status: 'on_time' | 'late';
  email: string;
  distanceM: number | null;
  accuracyM: number | null;
  qrVerified: boolean;
  method: 'self' | 'manual';
  checkedInAtIso: string;
  recordedBy?: string;
  manualNote?: string;
}

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}
