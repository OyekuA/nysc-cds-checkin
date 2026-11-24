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

export const DEFAULT_SETTINGS: AppSettings = {
  venue: {
    lat: 6.5132891,
    lng: 3.3559699,
    name: 'NYSC Surulere CDS Venue',
  },
  radiusM: 100,
  maxAccuracyM: 120,
  requireQr: false,
  qrRotationSeconds: 45,
  checkInOpen: true,
  enforceDeviceLock: true,
  enforceWindow: false,
  windowStart: '07:00',
  lateAfter: '08:30',
  windowEnd: '13:00',
  allowedStates: ['LA'],
};

export interface CheckInRecord {
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

export interface TodayCheckInResponse {
  settings: AppSettings;
  serverDay: string;
  serverTimeHHMM: string;
  claimedCode: string | null;
  checkedIn: CheckInRecord | null;
}

export interface AdminBootstrapResponse {
  adminEmail: string;
  primaryAdmin: string;
  settings: AppSettings;
  admins: string[];
  rosterCount: number;
  todayDay: string;
  serverTimeHHMM: string;
}

export interface RosterMember {
  codeId: string;
  code: string;
  name: string;
  claimedUid: string | null;
  claimedEmail: string | null;
}

export interface QrTokenResponse {
  token: string;
  windowIndex: number;
  expiresAtMs: number;
  rotationSeconds: number;
  serverNowMs: number;
  requireQr: boolean;
  checkInOpen: boolean;
  venueName: string;
  todayDay: string;
  todayCount: number;
}

export interface MonthlyReportRow {
  codeId: string;
  code: string;
  name: string;
  attended: number;
  onTime: number;
  late: number;
  totalSessions: number;
  percentage: number;
  days: Record<string, { number: number; status: string; time: string }>;
}

export interface MonthlyReportResponse {
  month: string;
  activeDays: string[];
  totalSessions: number;
  rows: MonthlyReportRow[];
}
