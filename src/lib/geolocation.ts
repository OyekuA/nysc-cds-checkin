import { VenueConfig } from './types';

export interface GpsFix {
  lat: number;
  lng: number;
  accuracyM: number;
  timestamp: number;
  ageMs: number;
  distanceM: number | null;
}

export type GpsPhase = 'idle' | 'acquiring' | 'filtering_stale' | 'refining' | 'locked' | 'error';

export interface GpsState {
  phase: GpsPhase;
  fix: GpsFix | null;
  isApproximateSuspected: boolean;
  errorCode: 'unsupported' | 'permission_denied' | 'stale_only' | 'timeout' | 'unavailable' | null;
  message: string;
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

const MAX_STALE_AGE_MS = 15_000;
const IDEAL_ACCURACY_M = 35;
const CONVERGED_ACCURACY_M = 65;
const CONVERGE_WAIT_MS = 10_000;
const HARD_TIMEOUT_MS = 22_000;

interface GpsWatchOptions {
  venue?: VenueConfig | null;
  maxAccuracyM?: number;
  onUpdate: (state: GpsState) => void;
}

/**
 * Live GPS tracker using watchPosition({ enableHighAccuracy: true, maximumAge: 0 }).
 * Rejects stale OS-cached fixes, waits for accuracy convergence, and flags Approximate Location.
 */
export class LiveGpsTracker {
  private watchId: number | null = null;
  private timeoutTimer: number | null = null;
  private startedAt = 0;
  private staleIgnored = 0;
  private sampleCount = 0;
  private bestFix: GpsFix | null = null;
  private lastFreshFix: GpsFix | null = null;
  private locked = false;
  private venue: VenueConfig | null;
  private maxAccuracyM: number;
  private onUpdate: (state: GpsState) => void;

  constructor({ venue = null, maxAccuracyM = 120, onUpdate }: GpsWatchOptions) {
    this.venue = venue;
    this.maxAccuracyM = maxAccuracyM;
    this.onUpdate = onUpdate;
  }

  public updateTarget(venue: VenueConfig | null, maxAccuracyM: number): void {
    this.venue = venue;
    this.maxAccuracyM = maxAccuracyM;
    if (this.bestFix) {
      this.bestFix = {
        ...this.bestFix,
        distanceM: venue
          ? Math.round(haversineMetres(this.bestFix.lat, this.bestFix.lng, venue.lat, venue.lng))
          : null,
      };
    }
  }

  public start(): void {
    this.stop();

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.emitError(
        'unsupported',
        'This browser does not support GPS location. Open this link in Chrome or Safari.'
      );
      return;
    }

    this.startedAt = Date.now();
    this.staleIgnored = 0;
    this.sampleCount = 0;
    this.bestFix = null;
    this.lastFreshFix = null;
    this.locked = false;

    this.onUpdate({
      phase: 'acquiring',
      fix: null,
      isApproximateSuspected: false,
      errorCode: null,
      message: 'Checking live GPS...',
    });

    this.timeoutTimer = window.setTimeout(() => this.handleTimeout(), HARD_TIMEOUT_MS);
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(pos),
      (err) => this.handleError(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }
    );
  }

  public stop(): void {
    if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.timeoutTimer !== null) {
      window.clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private emitError(
    errorCode: GpsState['errorCode'],
    message: string,
    isApproximateSuspected = false
  ): void {
    this.onUpdate({
      phase: 'error',
      fix: this.bestFix,
      isApproximateSuspected,
      errorCode,
      message,
    });
  }

  private emitLocked(fix: GpsFix): void {
    this.locked = true;
    if (this.timeoutTimer !== null) {
      window.clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.onUpdate({
      phase: 'locked',
      fix,
      isApproximateSuspected: false,
      errorCode: null,
      message:
        fix.distanceM !== null
          ? `${fix.distanceM} m from venue (±${fix.accuracyM} m)`
          : `GPS locked (±${fix.accuracyM} m)`,
    });
  }

  private handlePosition(pos: GeolocationPosition): void {
    const now = Date.now();
    const elapsedMs = now - this.startedAt;
    let ageMs = now - pos.timestamp;
    if (ageMs < 0 && ageMs > -5000) ageMs = 0;

    // Ignore stale cached OS readings older than 15s or predating this session
    if (ageMs > MAX_STALE_AGE_MS || pos.timestamp < this.startedAt - 10_000) {
      this.staleIgnored += 1;
      const secs = Math.max(1, Math.round(ageMs / 1000));
      const label = secs >= 60 ? `${Math.round(secs / 60)} min old` : `${secs}s old`;
      this.onUpdate({
        phase: 'filtering_stale',
        fix: this.bestFix,
        isApproximateSuspected: false,
        errorCode: null,
        message: `Skipped cached location (${label}). Waiting for live GPS...`,
      });
      return;
    }

    const fix: GpsFix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracyM: Math.round(pos.coords.accuracy),
      timestamp: pos.timestamp,
      ageMs: Math.max(0, Math.round(ageMs)),
      distanceM: this.venue
        ? Math.round(
            haversineMetres(
              pos.coords.latitude,
              pos.coords.longitude,
              this.venue.lat,
              this.venue.lng
            )
          )
        : null,
    };

    const prev = this.lastFreshFix;
    this.lastFreshFix = fix;
    this.sampleCount += 1;

    const jumpM = prev ? haversineMetres(prev.lat, prev.lng, fix.lat, fix.lng) : Infinity;
    const stablePair = this.sampleCount >= 2 && jumpM <= 45;

    if (
      !this.bestFix ||
      now - this.bestFix.timestamp > 8_000 ||
      fix.accuracyM <= this.bestFix.accuracyM + 10 ||
      (this.sampleCount === 2 && jumpM > 80 && fix.accuracyM <= this.maxAccuracyM)
    ) {
      this.bestFix = fix;
    }

    const best = this.bestFix;
    const isApprox = elapsedMs >= 5_500 && best.accuracyM > 250;
    const ready =
      (best.accuracyM <= IDEAL_ACCURACY_M && (this.sampleCount >= 2 || elapsedMs >= 2_500)) ||
      (stablePair && best.accuracyM <= CONVERGED_ACCURACY_M) ||
      (elapsedMs >= CONVERGE_WAIT_MS && best.accuracyM <= this.maxAccuracyM);

    if (ready) {
      this.emitLocked(best);
      return;
    }

    this.onUpdate({
      phase: 'refining',
      fix: best,
      isApproximateSuspected: isApprox,
      errorCode: null,
      message: isApprox
        ? `Coarse location (±${best.accuracyM} m). Turn on Precise Location in phone settings.`
        : `Refining GPS signal (±${best.accuracyM} m)...`,
    });
  }

  private handleTimeout(): void {
    if (this.locked) return;

    if (this.bestFix && this.bestFix.accuracyM <= this.maxAccuracyM) {
      const ageNow = Date.now() - this.bestFix.timestamp;
      if (ageNow <= 20_000) {
        this.emitLocked({ ...this.bestFix, ageMs: ageNow });
        return;
      }
    }

    this.stop();
    if (this.bestFix && this.bestFix.accuracyM > this.maxAccuracyM) {
      const approx = this.bestFix.accuracyM > 250;
      this.emitError(
        'unavailable',
        approx
          ? `Phone is sharing Approximate Location (±${this.bestFix.accuracyM} m). Enable Precise Location and tap Refresh.`
          : `GPS accuracy stayed at ±${this.bestFix.accuracyM} m (needs ±${this.maxAccuracyM} m or better). Step into an open spot and tap Refresh.`,
        approx
      );
    } else if (this.staleIgnored > 0 && this.sampleCount === 0) {
      this.emitError(
        'stale_only',
        'Phone only returned an older cached location. Toggle Location off and back on, then tap Refresh.'
      );
    } else {
      this.emitError(
        'timeout',
        'Timed out waiting for live GPS. Ensure Location Services are on and tap Refresh.'
      );
    }
  }

  private handleError(err: GeolocationPositionError): void {
    if (this.locked && err.code === err.TIMEOUT) return;
    this.stop();

    if (err.code === err.PERMISSION_DENIED) {
      this.emitError(
        'permission_denied',
        'Location permission denied. Allow Precise Location for this site, then tap Refresh.'
      );
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      this.emitError(
        'unavailable',
        'Could not determine GPS position. Turn on Location Services and tap Refresh.'
      );
    } else {
      this.handleTimeout();
    }
  }
}

export function acquireFreshGpsFix(
  venue: VenueConfig | null = null,
  maxAccuracyM = 120,
  onProgress?: (state: GpsState) => void
): Promise<GpsFix> {
  return new Promise((resolve, reject) => {
    const tracker = new LiveGpsTracker({
      venue,
      maxAccuracyM,
      onUpdate: (state) => {
        onProgress?.(state);
        if (state.phase === 'locked' && state.fix) {
          tracker.stop();
          resolve(state.fix);
        } else if (state.phase === 'error') {
          tracker.stop();
          reject(new Error(state.message));
        }
      },
    });
    tracker.start();
  });
}

export async function getGeoPermissionState(): Promise<PermissionState | 'unknown'> {
  try {
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      return status.state;
    }
  } catch {
    // Safari may not support permissions.query('geolocation')
  }
  return 'unknown';
}
