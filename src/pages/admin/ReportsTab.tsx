import React, { useState } from 'react';
import { apiRequest } from '../../lib/api';
import { downloadCsv, extractErrorMessage, getCurrentMonthLagos } from '../../lib/format';
import { MonthlyReportResponse } from '../../lib/types';

interface ReportsTabProps {
  notify: (kind: 'ok' | 'err', text: string) => void;
}

export const ReportsTab: React.FC<ReportsTabProps> = ({ notify }) => {
  const [month, setMonth] = useState(getCurrentMonthLagos);
  const [data, setData] = useState<MonthlyReportResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<MonthlyReportResponse>(
        `/api/admin/monthly-report?month=${encodeURIComponent(month)}`
      );
      setData(res);
    } catch (err) {
      notify('err', extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCsv = () => {
    if (!data) return;
    downloadCsv(
      `nysc-surulere-clearance-${data.month}.csv`,
      ['State Code', 'Name', 'Attended', 'Total CDS Days', 'Attendance %', 'On Time', 'Late', ...data.activeDays],
      data.rows.map((r) => [
        r.code,
        r.name,
        r.attended,
        r.totalSessions,
        `${r.percentage}%`,
        r.onTime,
        r.late,
        ...data.activeDays.map((day) => {
          const d = r.days[day];
          return d ? `#${d.number} (${d.status === 'late' ? 'Late' : 'On Time'} ${d.time})` : 'Absent';
        }),
      ])
    );
  };

  return (
    <section className="panel form-stack">
      <div className="panel__head">
        <h3>Monthly clearance report</h3>
        <p className="muted">
          Summarizes all CDS sessions held in a month and each member's attendance percentage.
        </p>
      </div>

      <div className="toolbar">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Report month"
        />
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={handleGenerate}
          disabled={loading}
        >
          {loading ? 'Generating...' : 'Generate'}
        </button>
        {data && (
          <button type="button" className="btn btn--sm btn--secondary" onClick={handleCsv}>
            Export CSV
          </button>
        )}
      </div>

      {data && (
        <>
          <p className="muted">
            <strong>{data.totalSessions}</strong> session{data.totalSessions === 1 ? '' : 's'} in{' '}
            {data.month}
            {data.activeDays.length > 0 ? `: ${data.activeDays.join(', ')}` : ''}
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Attended</th>
                  <th>On time</th>
                  <th>Late</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.codeId}>
                    <td className="mono">{r.code}</td>
                    <td>{r.name || '-'}</td>
                    <td className="num">
                      {r.attended} / {r.totalSessions}
                    </td>
                    <td className="num">{r.onTime}</td>
                    <td className="num">{r.late}</td>
                    <td className="num">
                      <span
                        className={`tag ${
                          r.percentage >= 75 ? 'tag--ok' : r.percentage >= 50 ? 'tag--warn' : 'tag--muted'
                        }`}
                      >
                        {r.percentage}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};
