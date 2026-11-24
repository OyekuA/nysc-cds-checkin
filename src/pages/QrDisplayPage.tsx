import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { apiRequest } from '../lib/api';
import {
  AuthUser,
  consumeAuthErrorFromUrl,
  getCurrentSession,
  signOutUser,
} from '../lib/auth';
import { extractErrorMessage } from '../lib/format';
import { QrTokenResponse } from '../lib/types';
import { SignInBox } from '../components/SignInBox';

type QrMode = 'rotating' | 'fixed';

export const QrDisplayPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [devAuthEnabled, setDevAuthEnabled] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const [error, setError] = useState<string | null>(() => consumeAuthErrorFromUrl());

  const [mode, setMode] = useState<QrMode>('rotating');
  const modeInitializedRef = useRef(false);

  const [qrData, setQrData] = useState<QrTokenResponse | null>(null);
  const [rotatingImg, setRotatingImg] = useState('');
  const [fixedImg, setFixedImg] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [progressPct, setProgressPct] = useState(100);
  const offsetRef = useRef(0);

  const fixedUrl = typeof window !== 'undefined' ? `${window.location.origin}/` : '/';

  const fetchToken = useCallback(async () => {
    try {
      setError(null);
      const res = await apiRequest<QrTokenResponse>('/api/admin/qr-token', { retries: 1 });
      offsetRef.current = res.serverNowMs - Date.now();
      setQrData(res);

      if (!modeInitializedRef.current) {
        modeInitializedRef.current = true;
        setMode(res.requireQr ? 'rotating' : 'fixed');
      }

      const url = `${window.location.origin}/?t=${encodeURIComponent(res.token)}`;
      setRotatingImg(
        await QRCode.toDataURL(url, {
          width: 440,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#0F1F17', light: '#FFFFFF' },
        })
      );
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void QRCode.toDataURL(fixedUrl, {
      width: 440,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: { dark: '#0F1F17', light: '#FFFFFF' },
    }).then(setFixedImg);
  }, [fixedUrl]);

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      const sess = await getCurrentSession();
      setUser(sess.user);
      setDevAuthEnabled(sess.devAuthEnabled);
      setGoogleConfigured(sess.googleConfigured);
      if (sess.user) await fetchToken();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [fetchToken]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!qrData || !user) return;
    let ticks = 0;
    const tick = () => {
      if (mode === 'rotating') {
        const msLeft = qrData.expiresAtMs - (Date.now() + offsetRef.current);
        if (msLeft <= 250) {
          void fetchToken();
          return;
        }
        setSecondsLeft(Math.ceil(msLeft / 1000));
        setProgressPct(Math.max(0, Math.min(100, (msLeft / (qrData.rotationSeconds * 1000)) * 100)));
      }
      ticks += 1;
      if (ticks % 32 === 0 && !document.hidden) void fetchToken();
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [qrData, user, mode, fetchToken]);

  const activeImg = mode === 'fixed' ? fixedImg : rotatingImg;

  return (
    <section className="qr-page">
      <header className="qr-page__bar no-print">
        <a href="/admin" className="link-btn link-btn--inv">
          ← Admin
        </a>
        <span>NYSC Surulere CDS · Venue QR</span>
        {user ? (
          <button
            type="button"
            className="link-btn link-btn--inv"
            onClick={() => void signOutUser().then(() => setUser(null))}
          >
            Sign out
          </button>
        ) : (
          <span />
        )}
      </header>

      <div className="qr-page__main">
        {loading ? (
          <div className="spinner spinner--inv" />
        ) : !user ? (
          <div className="qr-card">
            <SignInBox
              title="Exco sign-in"
              description="Sign in with an authorized Exco account to display the venue QR."
              nextPath="/qr"
              googleConfigured={googleConfigured}
              devAuthEnabled={devAuthEnabled}
              defaultDevEmail="kingsleyalozor@gmail.com"
              error={error}
              onDevLoggedIn={loadSession}
            />
          </div>
        ) : error && !qrData ? (
          <div className="qr-card form-stack">
            <h2>Unable to display QR</h2>
            <div className="banner banner--error">{error}</div>
            <div className="inline-actions">
              <button type="button" className="btn btn--sm btn--primary" onClick={() => void fetchToken()}>
                Retry
              </button>
              <button
                type="button"
                className="btn btn--sm btn--secondary"
                onClick={() => void signOutUser().then(() => setUser(null))}
              >
                Switch account
              </button>
            </div>
          </div>
        ) : (
          <div className="qr-card qr-card--center">
            <div className="seg-control no-print" role="group" aria-label="QR code mode">
              <button
                type="button"
                className={`seg-btn${mode === 'rotating' ? ' seg-btn--active' : ''}`}
                onClick={() => setMode('rotating')}
              >
                Rotating (live)
              </button>
              <button
                type="button"
                className={`seg-btn${mode === 'fixed' ? ' seg-btn--active' : ''}`}
                onClick={() => setMode('fixed')}
              >
                Fixed (printable)
              </button>
            </div>

            <div className="qr-card__meta">
              {qrData?.venueName || 'NYSC Surulere CDS'}
              {mode === 'rotating' && qrData?.todayDay ? ` · ${qrData.todayDay}` : ''}
            </div>
            <h1>Scan to check in</h1>

            {mode === 'fixed' && qrData?.requireQr && (
              <div className="banner banner--warn no-print" style={{ textAlign: 'left', width: '100%' }}>
                Require QR is ON in Settings. Corps members scanning a fixed QR will still be asked
                for the rotating QR unless you turn Require QR off.
              </div>
            )}

            <div className="qr-box">
              {activeImg ? <img src={activeImg} alt="Venue check-in QR code" /> : <div className="spinner" />}
            </div>

            {mode === 'rotating' ? (
              <div className="qr-progress">
                <div className="qr-progress__track">
                  <div className="qr-progress__fill" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="muted num">Refreshes in {secondsLeft}s</span>
              </div>
            ) : (
              <div className="form-stack" style={{ width: '100%', alignItems: 'center' }}>
                <div className="muted mono">{fixedUrl}</div>
                <button
                  type="button"
                  className="btn btn--sm btn--primary no-print"
                  onClick={() => window.print()}
                >
                  Print poster
                </button>
              </div>
            )}

            <div className="qr-count no-print">
              <strong className="num">{qrData?.todayCount ?? 0}</strong> checked in today
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
