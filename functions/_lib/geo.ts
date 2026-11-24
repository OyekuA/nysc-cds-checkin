export const LAGOS_TIMEZONE = 'Africa/Lagos';

export interface LagosDateInfo {
  day: string;
  hhmm: string;
  minutesOfDay: number;
}

export function getLagosDateInfo(now: Date = new Date()): LagosDateInfo {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LAGOS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const year = get('year');
  const month = get('month');
  const dayNum = get('day');
  const rawHour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));

  return {
    day: `${year}-${month}-${dayNum}`,
    hhmm: `${String(rawHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    minutesOfDay: rawHour * 60 + minute,
  };
}

export function parseHHMM(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isValidHHMM(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());
}

export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface NormalizedCode {
  code: string;
  codeId: string;
  state: string;
}

export function normalizeStateCode(raw: string): NormalizedCode | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\s+/g, '').toUpperCase();
  const match = /^([A-Z]{2})\/(\d{2}[ABC])\/(\d{4,6})$/.exec(cleaned);
  if (!match) return null;
  const state = match[1];
  const code = `${state}/${match[2]}/${match[3]}`;
  return {
    code,
    codeId: code.replace(/\//g, '_'),
    state,
  };
}
