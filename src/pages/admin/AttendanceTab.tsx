import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { downloadCsv, extractErrorMessage, formatTimeLagos } from '../../lib/format';
import { CheckInRecord } from '../../lib/types';

interface AttendanceTabProps {
  selectedDay: string;
  onSelectDay: (day: string) => void;
  rosterCount: number;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

export const AttendanceTab: React.FC<AttendanceTabProps> = ({
  selectedDay,
  onSelectDay,
  rosterCount,
  notify,
}) => {
  const [checkins, setCheckins] = useState<CheckInRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'on_time' | 'late' | 'manual'>('all');

  const [manualCode, setManualCode] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [manualStatus, setManualStatus] = useState<'auto' | 'on_time' | 'late'>('auto');
  const [manualBusy, setManualBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<{ checkins: CheckInRecord[] }>(
        `/api/admin/checkins?day=${encodeURIComponent(selectedDay)}`,
        { retries: 1 }
      );
      setCheckins(res.checkins);
    } catch (err) {
      notify('err', extractErrorMessage(err, 'Could not load check-ins.'));
    }
  }, [selectedDay, notify]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 6_000);
    return () => window.clearInterval(id);
  }, [load]);

  const stats = useMemo(() => {
    const total = checkins.length;
    const late = checkins.filter((r) => r.status === 'late').length;
    const manual = checkins.filter((r) => r.method === 'manual').length;
    const turnout = rosterCount > 0 ? Math.round((total / rosterCount) * 100) : 0;
    return { total, onTime: total - late, late, manual, turnout };
  }, [checkins, rosterCount]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return checkins.filter((r) => {
      if (filter === 'on_time' && r.status !== 'on_time') return false;
      if (filter === 'late' && r.status !== 'late') return false;
      if (filter === 'manual' && r.method !== 'manual') return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        String(r.number) === q
      );
    });
  }, [checkins, search, filter]);

  const handleManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim() || manualBusy) return;
    setManualBusy(true);
    try {
      const res = await apiRequest<CheckInRecord>('/api/admin/checkins', {
        method: 'POST',
        body: {
          code: manualCode.trim(),
          note: manualNote.trim() || undefined,
          statusOverride: manualStatus === 'auto' ? undefined : manualStatus,
          dayOverride: selectedDay,
        },
      });
      notify('ok', `Recorded ${res.code} as #${res.number}.`);
      setManualCode('');
      setManualNote('');
      await load();
    } catch (err) {
      notify('err', extractErrorMessage(err));
    } finally {
      setManualBusy(false);
    }
  };

  const handleRemove = async (r: CheckInRecord) => {
    if (!window.confirm(`Remove check-in #${r.number} (${r.code}) on ${r.day}?`)) return;
    try {
      await apiRequest(
        `/api/admin/checkins?day=${encodeURIComponent(r.day)}&codeId=${encodeURIComponent(r.codeId)}`,
        { method: 'DELETE' }
      );
      notify('ok', `Removed ${r.code}.`);
      await load();
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleCsv = () => {
    downloadCsv(
      `nysc-surulere-checkins-${selectedDay}.csv`,
      ['Number', 'Code', 'Name', 'Email', 'Status', 'Time (WAT)', 'Method', 'Distance (m)', 'Accuracy (m)', 'QR', 'Date', 'Note'],
      checkins.map((r) => [
        r.number,
        r.code,
        r.name,
        r.email,
        r.status === 'late' ? 'Late' : 'On Time',
        r.checkedInAtIso ? formatTimeLagos(r.checkedInAtIso, true) : '',
        r.method,
        r.distanceM,
        r.accuracyM,
        r.qrVerified ? 'Yes' : 'No',
        r.day,
        r.manualNote ?? '',
      ])
    );
  };

  return (
    <div className="section-stack">
      <div className="stat-strip">
        <div className="stat">
          <div className="stat__val num">{stats.total}</div>
          <div className="stat__lbl">Checked in</div>
        </div>
        <div className="stat">
          <div className="stat__val stat__val--ok num">{stats.onTime}</div>
          <div className="stat__lbl">On time</div>
        </div>
        <div className="stat">
          <div className="stat__val stat__val--warn num">{stats.late}</div>
          <div className="stat__lbl">Late</div>
        </div>
        <div className="stat">
          <div className="stat__val num">{stats.turnout}%</div>
          <div className="stat__lbl">
            Turnout ({stats.total}/{rosterCount})
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="toolbar">
          <input
            type="date"
            value={selectedDay}
            onChange={(e) => onSelectDay(e.target.value)}
            aria-label="Attendance date"
          />
          <input
            type="search"
            placeholder="Search code, name, email, or #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            aria-label="Status filter"
          >
            <option value="all">All ({stats.total})</option>
            <option value="on_time">On time ({stats.onTime})</option>
            <option value="late">Late ({stats.late})</option>
            <option value="manual">Manual ({stats.manual})</option>
          </select>
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => void load()}>
            Refresh
          </button>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={handleCsv}
            disabled={checkins.length === 0}
          >
            Export CSV
          </button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Code</th>
                <th>Name</th>
                <th>Time</th>
                <th>Status</th>
                <th>Verification</th>
                <th>Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table__empty">
                    No check-ins recorded for {selectedDay}.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.day}_${r.codeId}`}>
                    <td className="num"><strong>{r.number}</strong></td>
                    <td className="mono">{r.code}</td>
                    <td>{r.name || '-'}</td>
                    <td className="num">{r.checkedInAtIso ? formatTimeLagos(r.checkedInAtIso, true) : '-'}</td>
                    <td>
                      <span className={`tag ${r.status === 'late' ? 'tag--warn' : 'tag--ok'}`}>
                        {r.status === 'late' ? 'Late' : 'On time'}
                      </span>
                    </td>
                    <td className="muted">
                      {r.method === 'manual'
                        ? `Manual (${r.manualNote || 'Exco'})`
                        : `${r.distanceM !== null ? `${r.distanceM}m ±${r.accuracyM ?? '?'}m` : 'GPS'}${r.qrVerified ? ' · QR' : ''}`}
                    </td>
                    <td className="muted">{r.email || '-'}</td>
                    <td className="td-right">
                      <button
                        type="button"
                        className="link-btn link-btn--danger"
                        onClick={() => void handleRemove(r)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <form className="panel" onSubmit={handleManual}>
        <div className="panel__head">
          <h3>Manual check-in</h3>
          <p className="muted">
            Fallback for members physically present with a dead phone. Logged under your Exco account.
          </p>
        </div>
        <div className="grid-form">
          <input
            type="text"
            placeholder="State code (LA/26A/0123)"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            required
          />
          <input
            type="text"
            placeholder="Reason (optional)"
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
          />
          <select
            value={manualStatus}
            onChange={(e) => setManualStatus(e.target.value as typeof manualStatus)}
          >
            <option value="auto">Status: Auto</option>
            <option value="on_time">On time</option>
            <option value="late">Late</option>
          </select>
          <button type="submit" className="btn btn--sm btn--primary" disabled={manualBusy}>
            {manualBusy ? 'Saving...' : `Record for ${selectedDay}`}
          </button>
        </div>
      </form>
    </div>
  );
};
