import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import {
  AuthUser,
  consumeAuthErrorFromUrl,
  detectInAppBrowser,
  getCurrentSession,
  signOutUser,
} from '../lib/auth';
import {
  captureQrTokenFromUrl,
  clearQrToken,
  getOrCreateDeviceId,
  saveQrToken,
} from '../lib/device';
import {
  extractErrorMessage,
  isValidStateCode,
  normalizeStateCodeInput,
} from '../lib/format';
import {
  GpsState,
  LiveGpsTracker,
  acquireFreshGpsFix,
  getGeoPermissionState,
} from '../lib/geolocation';
import {
  AppSettings,
  CheckInRecord,
  DEFAULT_SETTINGS,
  TodayCheckInResponse,
} from '../lib/types';
import { CheckInPass } from '../components/CheckInPass';
import { Footer } from '../components/Footer';
import { LocationStatus } from '../components/LocationStatus';
import { SignInBox } from '../components/SignInBox';
import { WebViewBanner } from '../components/WebViewBanner';

const QrScannerModal = lazy(() =>
  import('../components/QrScannerModal').then((m) => ({ default: m.QrScannerModal }))
);

const INITIAL_GPS: GpsState = {
  phase: 'idle',
  fix: null,
  isApproximateSuspected: false,
  errorCode: null,
  message: 'Verified when you tap Check In (or Check now).',
};

export const CheckInPage: React.FC = () => {
  const inAppInfo = useMemo(() => detectInAppBrowser(), []);
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [devAuthEnabled, setDevAuthEnabled] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(true);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [todayPass, setTodayPass] = useState<CheckInRecord | null>(null);

  const [code, setCode] = useState('');
  const [claimedCode, setClaimedCode] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(() => captureQrTokenFromUrl());
  const [scannerOpen, setScannerOpen] = useState(false);

  const [gps, setGps] = useState<GpsState>(INITIAL_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(() => consumeAuthErrorFromUrl());

  const trackerRef = useRef<LiveGpsTracker | null>(null);

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const [sess, status] = await Promise.all([
        getCurrentSession(),
        apiRequest<TodayCheckInResponse>('/api/checkin/status', { retries: 1 }),
      ]);
      setUser(sess.user);
      setDevAuthEnabled(sess.devAuthEnabled);
      setGoogleConfigured(sess.googleConfigured);
      setSettings(status.settings);
      if (status.checkedIn) {
        setTodayPass(status.checkedIn);
        clearQrToken();
      } else {
        setTodayPass(null);
      }
      if (status.claimedCode) {
        setClaimedCode(status.claimedCode);
        setCode((prev) => (prev.trim() ? prev : status.claimedCode!));
      }
    } catch (err) {
      setErrorMsg(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const startGpsWatch = useCallback(() => {
    setErrorMsg(null);
    if (!trackerRef.current) {
      trackerRef.current = new LiveGpsTracker({
        venue: settings.venue,
        maxAccuracyM: settings.maxAccuracyM,
        onUpdate: setGps,
      });
    } else {
      trackerRef.current.updateTarget(settings.venue, settings.maxAccuracyM);
    }
    trackerRef.current.start();
  }, [settings.venue, settings.maxAccuracyM]);

  useEffect(() => {
    trackerRef.current?.updateTarget(settings.venue, settings.maxAccuracyM);
  }, [settings.venue, settings.maxAccuracyM]);

  useEffect(() => {
    if (!user || todayPass) {
      trackerRef.current?.stop();
      return;
    }

    let active = true;
    void getGeoPermissionState().then((perm) => {
      if (active && perm === 'granted') startGpsWatch();
    });

    const onVisibility = () => {
      if (document.hidden) {
        trackerRef.current?.stop();
      } else if (user && !todayPass) {
        void getGeoPermissionState().then((perm) => {
          if (perm === 'granted') startGpsWatch();
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibility);
      trackerRef.current?.stop();
    };
  }, [user, todayPass, startGpsWatch]);

  const handleSignOut = async () => {
    trackerRef.current?.stop();
    setGps(INITIAL_GPS);
    setTodayPass(null);
    setClaimedCode(null);
    setErrorMsg(null);
    await signOutUser();
    setUser(null);
  };

  const handleQrScanned = useCallback((token: string) => {
    saveQrToken(token);
    setQrToken(token);
    setScannerOpen(false);
    setErrorMsg(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || submitting) return;

    setErrorMsg(null);
    const cleanedCode = normalizeStateCodeInput(code);
    if (!cleanedCode) {
      setErrorMsg('Enter your NYSC state code.');
      return;
    }
    if (!isValidStateCode(cleanedCode, settings.allowedStates)) {
      const hint = settings.allowedStates[0] || 'LA';
      setErrorMsg(`Invalid state code format. Expected format: ${hint}/26A/0123.`);
      return;
    }
    if (!settings.checkInOpen) {
      setErrorMsg('Check-in is currently closed.');
      return;
    }
    if (settings.requireQr && !qrToken) {
      setScannerOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      let activeFix = gps.fix;
      const fixAgeNow = activeFix ? Date.now() - activeFix.timestamp : Infinity;
      const needsFreshFix =
        gps.phase !== 'locked' ||
        !activeFix ||
        fixAgeNow > 15_000 ||
        activeFix.accuracyM > settings.maxAccuracyM;

      if (needsFreshFix) {
        trackerRef.current?.stop();
        activeFix = await acquireFreshGpsFix(settings.venue, settings.maxAccuracyM, setGps);
      }
      if (!activeFix) {
        throw new Error('Could not acquire a live GPS fix. Tap Refresh and try again.');
      }

      const record = await apiRequest<CheckInRecord>('/api/checkin/submit', {
        method: 'POST',
        retries: 1,
        body: {
          code: cleanedCode,
          deviceId,
          lat: activeFix.lat,
          lng: activeFix.lng,
          accuracyM: activeFix.accuracyM,
          gpsAgeMs: Math.max(0, Date.now() - activeFix.timestamp),
          qrToken,
        },
      });

      trackerRef.current?.stop();
      clearQrToken();
      setTodayPass(record);
    } catch (err) {
      const msg = extractErrorMessage(err);
      setErrorMsg(msg);
      if (/qr code has expired/i.test(msg)) {
        clearQrToken();
        setQrToken(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (todayPass) {
    return (
      <CheckInPass
        record={todayPass}
        venueName={settings.venue.name}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <section className="page">
      <header className="masthead">
        <h1>NYSC Surulere CDS</h1>
        <p className="masthead__sub">
          {settings.venue.name} · {settings.checkInOpen ? 'Attendance open' : 'Attendance closed'}
        </p>
      </header>

      <main className="page__body">
        <WebViewBanner info={inAppInfo} />

        {loading ? (
          <div className="center-state">
            <div className="spinner" aria-hidden="true" />
            <p className="muted">Loading...</p>
          </div>
        ) : !user ? (
          <SignInBox
            title="Sign in to check in"
            description="Use the same Google account every CDS day. Your state code binds permanently to your account."
            googleConfigured={googleConfigured}
            devAuthEnabled={devAuthEnabled}
            error={errorMsg}
            notice={qrToken ? 'Venue QR captured. Sign in to finish checking in.' : null}
            onDevLoggedIn={loadState}
          />
        ) : (
          <form className="form-stack" onSubmit={handleSubmit} noValidate>
            <div className="meta-bar">
              <span className="meta-bar__email">{user.email}</span>
              <button type="button" className="link-btn" onClick={handleSignOut}>
                Switch
              </button>
            </div>

            {!settings.checkInOpen && (
              <div className="banner banner--warn banner--row" role="status">
                <span>Attendance is currently closed by the ICT Excos.</span>
                <button type="button" className="link-btn" onClick={() => void loadState()}>
                  Refresh
                </button>
              </div>
            )}

            <label className="field">
              <span>State code</span>
              <input
                className="input-code"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="LA/26A/0123"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={submitting}
              />
              {claimedCode && (
                <small className="field__hint">Linked to your account ({claimedCode})</small>
              )}
            </label>

            {settings.requireQr && (
              <div className="meta-row">
                <div>
                  <div className="meta-row__title">Venue QR</div>
                  <div className="muted">
                    {qrToken ? 'Scanned. Submit before rotation.' : 'Required for today.'}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--sm btn--secondary"
                  onClick={() => setScannerOpen(true)}
                  disabled={submitting}
                >
                  {qrToken ? 'Rescan' : 'Scan QR'}
                </button>
              </div>
            )}

            <LocationStatus
              gps={gps}
              radiusM={settings.radiusM}
              venueName={settings.venue.name}
              onRefresh={startGpsWatch}
            />

            {errorMsg && (
              <div className="banner banner--error" role="alert">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              className="btn btn--primary btn--full"
              disabled={submitting || !settings.checkInOpen}
            >
              {submitting ? 'Checking in...' : 'Check In'}
            </button>

            <p className="caption">
              One check-in per code per day. Arrival numbers are assigned by the server in order of
              arrival.
              {settings.enforceWindow && (
                <>
                  <br />
                  Hours: {settings.windowStart}-{settings.windowEnd} WAT (late after{' '}
                  {settings.lateAfter} WAT).
                </>
              )}
            </p>
          </form>
        )}
      </main>

      <Footer showAdminLink />

      {scannerOpen && (
        <Suspense fallback={null}>
          <QrScannerModal
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onTokenScanned={handleQrScanned}
          />
        </Suspense>
      )}
    </section>
  );
};
