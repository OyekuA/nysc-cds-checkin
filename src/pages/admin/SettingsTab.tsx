import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { extractErrorMessage } from '../../lib/format';
import { acquireFreshGpsFix } from '../../lib/geolocation';
import { AppSettings } from '../../lib/types';

interface SettingsTabProps {
  settings: AppSettings;
  admins: string[];
  primaryAdmin: string;
  onSettingsSaved: (next: AppSettings) => void;
  onAdminsChanged: (next: string[]) => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  admins,
  primaryAdmin,
  onSettingsSaved,
  onAdminsChanged,
  notify,
}) => {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [statesText, setStatesText] = useState(settings.allowedStates.join(', '));
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [newAdmin, setNewAdmin] = useState('');

  useEffect(() => {
    setDraft(settings);
    setStatesText(settings.allowedStates.join(', '));
  }, [settings]);

  const handleUseCurrentLocation = async () => {
    setLocating(true);
    try {
      const fix = await acquireFreshGpsFix(null, 80);
      setDraft((p) => ({
        ...p,
        venue: {
          ...p.venue,
          lat: Number(fix.lat.toFixed(7)),
          lng: Number(fix.lng.toFixed(7)),
        },
      }));
      notify('ok', `Captured live GPS (±${fix.accuracyM} m). Click Save settings to apply.`);
    } catch (err) {
      notify('err', extractErrorMessage(err));
    } finally {
      setLocating(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const allowedStates = statesText
        .split(/[,\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{2}$/.test(s));

      const res = await apiRequest<{ settings: AppSettings }>('/api/admin/settings', {
        method: 'PUT',
        body: { ...draft, allowedStates },
      });
      onSettingsSaved(res.settings);
      notify('ok', 'Settings saved.');
    } catch (err) {
      notify('err', extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRotateSecret = async () => {
    if (!window.confirm('Rotate QR signing secret now? Any QR on screen will expire immediately.')) {
      return;
    }
    try {
      await apiRequest('/api/admin/settings', { method: 'POST' });
      notify('ok', 'QR signing secret rotated.');
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdmin.trim()) return;
    try {
      const res = await apiRequest<{ admins: string[] }>('/api/admin/admins', {
        method: 'POST',
        body: { email: newAdmin.trim() },
      });
      onAdminsChanged(res.admins);
      setNewAdmin('');
      notify('ok', 'Admin added.');
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleRemoveAdmin = async (email: string) => {
    if (!window.confirm(`Remove admin access for ${email}?`)) return;
    try {
      const res = await apiRequest<{ admins: string[] }>(
        `/api/admin/admins?email=${encodeURIComponent(email)}`,
        { method: 'DELETE' }
      );
      onAdminsChanged(res.admins);
      notify('ok', `Removed ${email}.`);
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  return (
    <div className="section-stack">
      <form className="panel form-stack" onSubmit={handleSave}>
        <div className="panel__head">
          <h3>Venue &amp; GPS</h3>
        </div>

        <div className="grid-form">
          <label className="field">
            <span>Venue name</span>
            <input
              type="text"
              value={draft.venue.name}
              onChange={(e) => setDraft((p) => ({ ...p, venue: { ...p.venue, name: e.target.value } }))}
            />
          </label>
          <label className="field">
            <span>Latitude</span>
            <input
              type="number"
              step="any"
              value={draft.venue.lat}
              onChange={(e) =>
                setDraft((p) => ({ ...p, venue: { ...p.venue, lat: Number(e.target.value) } }))
              }
            />
          </label>
          <label className="field">
            <span>Longitude</span>
            <input
              type="number"
              step="any"
              value={draft.venue.lng}
              onChange={(e) =>
                setDraft((p) => ({ ...p, venue: { ...p.venue, lng: Number(e.target.value) } }))
              }
            />
          </label>
          <div className="field field--end">
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              onClick={handleUseCurrentLocation}
              disabled={locating}
            >
              {locating ? 'Locking GPS...' : 'Use my location'}
            </button>
          </div>
        </div>

        <div className="grid-form">
          <label className="field">
            <span>Allowed radius (m)</span>
            <input
              type="number"
              min={20}
              max={2000}
              value={draft.radiusM}
              onChange={(e) => setDraft((p) => ({ ...p, radiusM: Number(e.target.value) }))}
            />
          </label>
          <label className="field">
            <span>Max GPS accuracy (m)</span>
            <input
              type="number"
              min={30}
              max={500}
              value={draft.maxAccuracyM}
              onChange={(e) => setDraft((p) => ({ ...p, maxAccuracyM: Number(e.target.value) }))}
            />
          </label>
          <label className="field">
            <span>State prefixes (blank = any)</span>
            <input
              type="text"
              placeholder="LA"
              value={statesText}
              onChange={(e) => setStatesText(e.target.value.toUpperCase())}
            />
          </label>
        </div>

        <hr className="rule" />

        <div className="panel__head">
          <h3>Session rules &amp; hours (WAT)</h3>
        </div>

        <div className="check-list">
          <label className="check">
            <input
              type="checkbox"
              checked={draft.checkInOpen}
              onChange={(e) => setDraft((p) => ({ ...p, checkInOpen: e.target.checked }))}
            />
            <span>Attendance session open</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.requireQr}
              onChange={(e) => setDraft((p) => ({ ...p, requireQr: e.target.checked }))}
            />
            <span>Require live rotating venue QR code</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.enforceDeviceLock}
              onChange={(e) => setDraft((p) => ({ ...p, enforceDeviceLock: e.target.checked }))}
            />
            <span>Limit to 1 check-in per phone per day</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.enforceWindow}
              onChange={(e) => setDraft((p) => ({ ...p, enforceWindow: e.target.checked }))}
            />
            <span>Enforce open/close time window</span>
          </label>
        </div>

        <div className="grid-form">
          <label className="field">
            <span>QR rotation (sec)</span>
            <input
              type="number"
              min={15}
              max={300}
              value={draft.qrRotationSeconds}
              onChange={(e) =>
                setDraft((p) => ({ ...p, qrRotationSeconds: Number(e.target.value) }))
              }
            />
          </label>
          <label className="field">
            <span>Opens</span>
            <input
              type="time"
              value={draft.windowStart}
              onChange={(e) => setDraft((p) => ({ ...p, windowStart: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Late after</span>
            <input
              type="time"
              value={draft.lateAfter}
              onChange={(e) => setDraft((p) => ({ ...p, lateAfter: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Closes</span>
            <input
              type="time"
              value={draft.windowEnd}
              onChange={(e) => setDraft((p) => ({ ...p, windowEnd: e.target.value }))}
            />
          </label>
        </div>

        <div className="inline-actions">
          <button type="submit" className="btn btn--sm btn--primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save settings'}
          </button>
          <button type="button" className="btn btn--sm btn--secondary" onClick={handleRotateSecret}>
            Rotate QR secret
          </button>
        </div>
      </form>

      <section className="panel form-stack">
        <div className="panel__head">
          <h3>Exco admins</h3>
        </div>
        <form className="toolbar" onSubmit={handleAddAdmin}>
          <input
            type="email"
            placeholder="exco.member@gmail.com"
            value={newAdmin}
            onChange={(e) => setNewAdmin(e.target.value)}
            required
          />
          <button type="submit" className="btn btn--sm btn--primary">
            Add admin
          </button>
        </form>
        <ul className="kv-list">
          {admins.map((email) => (
            <li key={email}>
              <span>{email}</span>
              {email === primaryAdmin ? (
                <span className="muted">Primary</span>
              ) : (
                <button
                  type="button"
                  className="link-btn link-btn--danger"
                  onClick={() => void handleRemoveAdmin(email)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
