import React, { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import {
  AuthUser,
  consumeAuthErrorFromUrl,
  getCurrentSession,
  signOutUser,
} from '../lib/auth';
import { extractErrorMessage, getTodayLagos } from '../lib/format';
import { AdminBootstrapResponse, AppSettings, DEFAULT_SETTINGS } from '../lib/types';
import { SignInBox } from '../components/SignInBox';
import { AttendanceTab } from './admin/AttendanceTab';
import { ReportsTab } from './admin/ReportsTab';
import { RosterTab } from './admin/RosterTab';
import { SettingsTab } from './admin/SettingsTab';

type AdminTab = 'attendance' | 'roster' | 'settings' | 'reports';

export const AdminPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [devAuthEnabled, setDevAuthEnabled] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const [authError, setAuthError] = useState<string | null>(() => consumeAuthErrorFromUrl());

  const [tab, setTab] = useState<AdminTab>('attendance');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [admins, setAdmins] = useState<string[]>([]);
  const [primaryAdmin, setPrimaryAdmin] = useState('kingsleyalozor@gmail.com');
  const [rosterCount, setRosterCount] = useState(0);
  const [selectedDay, setSelectedDay] = useState(getTodayLagos);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const sess = await getCurrentSession();
      setUser(sess.user);
      setDevAuthEnabled(sess.devAuthEnabled);
      setGoogleConfigured(sess.googleConfigured);
      if (!sess.user) {
        setAuthorized(false);
        return;
      }

      const res = await apiRequest<AdminBootstrapResponse>('/api/admin/bootstrap', { retries: 1 });
      setAuthorized(true);
      setAuthError(null);
      setSettings(res.settings);
      setAdmins(res.admins);
      if (res.primaryAdmin) setPrimaryAdmin(res.primaryAdmin);
      setRosterCount(res.rosterCount);
      setSelectedDay(res.todayDay);
    } catch (err) {
      setAuthorized(false);
      setAuthError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const toggleSetting = async (patch: Partial<AppSettings>, message: string) => {
    try {
      const res = await apiRequest<{ settings: AppSettings }>('/api/admin/settings', {
        method: 'PUT',
        body: patch,
      });
      setSettings(res.settings);
      notify('ok', message);
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  if (loading) {
    return (
      <section className="auth-gate">
        <div className="center-state">
          <div className="spinner" />
          <p className="muted">Loading admin...</p>
        </div>
      </section>
    );
  }

  if (!user || !authorized) {
    return (
      <section className="auth-gate">
        <div className="panel">
          {!user ? (
            <SignInBox
              title="Exco Admin"
              description="Sign in with an authorized Exco Google account."
              nextPath="/admin"
              googleConfigured={googleConfigured}
              devAuthEnabled={devAuthEnabled}
              defaultDevEmail="kingsleyalozor@gmail.com"
              error={authError}
              onDevLoggedIn={bootstrap}
            />
          ) : (
            <div className="form-stack">
              <h2>Access denied</h2>
              {authError && <div className="banner banner--error">{authError}</div>}
              <div className="inline-actions">
                <button
                  type="button"
                  className="btn btn--sm btn--secondary"
                  onClick={() => void signOutUser().then(() => setUser(null))}
                >
                  Sign out ({user.email})
                </button>
                <a href="/" className="btn btn--sm btn--primary">
                  Go to check-in
                </a>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="admin-shell">
      <header className="topbar">
        <div className="topbar__inner">
          <div>
            <h1 className="topbar__title">NYSC Surulere CDS</h1>
            <div className="muted">{user.email}</div>
          </div>
          <div className="inline-actions">
            <a href="/qr" target="_blank" rel="noopener noreferrer" className="btn btn--sm btn--primary">
              Venue QR
            </a>
            <a href="/" className="btn btn--sm btn--secondary">
              Check-in
            </a>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => void signOutUser().then(() => setUser(null))}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="admin-body">
        <div className="control-bar">
          <nav className="nav-tabs" role="tablist">
            {(
              [
                ['attendance', 'Attendance'],
                ['roster', `Roster (${rosterCount})`],
                ['settings', 'Settings'],
                ['reports', 'Monthly Clearance'],
              ] as Array<[AdminTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`nav-tab${tab === id ? ' nav-tab--active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="control-bar__toggles">
            <label className="switch-label">
              <input
                type="checkbox"
                checked={settings.checkInOpen}
                onChange={() =>
                  void toggleSetting(
                    { checkInOpen: !settings.checkInOpen },
                    settings.checkInOpen ? 'Attendance closed.' : 'Attendance opened.'
                  )
                }
              />
              <span>Session open</span>
            </label>
            <label className="switch-label">
              <input
                type="checkbox"
                checked={settings.requireQr}
                onChange={() =>
                  void toggleSetting(
                    { requireQr: !settings.requireQr },
                    settings.requireQr ? 'Venue QR set to optional.' : 'Venue QR required.'
                  )
                }
              />
              <span>Require QR</span>
            </label>
          </div>
        </div>

        {toast && (
          <div className={`banner ${toast.kind === 'ok' ? 'banner--ok' : 'banner--error'}`} role="status">
            {toast.text}
          </div>
        )}

        {tab === 'attendance' && (
          <AttendanceTab
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            rosterCount={rosterCount}
            notify={notify}
          />
        )}

        {tab === 'roster' && <RosterTab onCountChange={setRosterCount} notify={notify} />}

        {tab === 'settings' && (
          <SettingsTab
            settings={settings}
            admins={admins}
            primaryAdmin={primaryAdmin}
            onSettingsSaved={setSettings}
            onAdminsChanged={setAdmins}
            notify={notify}
          />
        )}

        {tab === 'reports' && <ReportsTab notify={notify} />}
      </div>
    </div>
  );
};
