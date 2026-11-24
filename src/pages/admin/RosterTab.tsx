import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { extractErrorMessage, parseRosterText } from '../../lib/format';
import { RosterMember } from '../../lib/types';

interface RosterTabProps {
  onCountChange: (count: number) => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

export const RosterTab: React.FC<RosterTabProps> = ({ onCountChange, notify }) => {
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ members: RosterMember[] }>('/api/admin/roster', { retries: 1 });
      setRoster(res.members);
      onCountChange(res.members.length);
    } catch (err) {
      notify('err', extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [notify, onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (m) =>
        m.code.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.claimedEmail ?? '').toLowerCase().includes(q)
    );
  }, [roster, search]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportText(await file.text());
    e.target.value = '';
  };

  const handleImport = async () => {
    const entries = parseRosterText(importText);
    if (entries.length === 0) {
      notify('err', 'No valid rows found. Format: LA/26A/0123, Full Name');
      return;
    }
    setImporting(true);
    setImportErrors([]);
    try {
      const res = await apiRequest<{ imported: number; errors: string[] }>('/api/admin/roster', {
        method: 'POST',
        body: { entries },
      });
      setImportErrors(res.errors);
      notify(
        'ok',
        `Imported ${res.imported} member${res.imported === 1 ? '' : 's'}${res.errors.length ? ` (${res.errors.length} skipped)` : ''}.`
      );
      if (res.errors.length === 0) setImportText('');
      await load();
    } catch (err) {
      notify('err', extractErrorMessage(err));
    } finally {
      setImporting(false);
    }
  };

  const handleUnbind = async (code: string) => {
    if (!window.confirm(`Unbind the Google account linked to ${code}?`)) return;
    try {
      await apiRequest('/api/admin/unbind', { method: 'POST', body: { code } });
      notify('ok', `Unbound Google account for ${code}.`);
      await load();
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleDelete = async (m: RosterMember) => {
    if (!window.confirm(`Remove ${m.code} (${m.name || 'Unnamed'}) from the roster?`)) return;
    try {
      await apiRequest(
        `/api/admin/roster?codeId=${encodeURIComponent(m.codeId)}&unbindClaim=true`,
        { method: 'DELETE' }
      );
      notify('ok', `Removed ${m.code}.`);
      await load();
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  return (
    <div className="section-stack">
      <section className="panel">
        <div className="panel__head">
          <h3>Import roster</h3>
          <p className="muted">
            Upload a CSV or paste one member per line as <code>LA/26A/0123, Full Name</code>.
          </p>
        </div>

        <textarea
          rows={4}
          placeholder={'LA/26A/0123, Ada Obi\nLA/26A/0124, Chidi Okafor'}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />

        <div className="inline-actions" style={{ marginTop: 12 }}>
          <label className="btn btn--sm btn--secondary">
            Choose CSV
            <input type="file" accept=".csv,.txt" onChange={handleFile} hidden />
          </label>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={handleImport}
            disabled={importing || !importText.trim()}
          >
            {importing ? 'Importing...' : 'Import members'}
          </button>
        </div>

        {importErrors.length > 0 && (
          <div className="banner banner--warn" style={{ marginTop: 12 }}>
            <strong>Skipped rows</strong>
            <ul className="plain-list">
              {importErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="toolbar">
          <h3 style={{ margin: 0 }}>Members ({roster.length})</h3>
          <input
            type="search"
            placeholder="Search code, name, or linked Gmail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="center-state">
            <div className="spinner" />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Linked Google account</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="table__empty">
                      No matching members.
                    </td>
                  </tr>
                ) : (
                  filtered.slice(0, 300).map((m) => (
                    <tr key={m.codeId}>
                      <td className="mono">{m.code}</td>
                      <td>{m.name || '-'}</td>
                      <td className="muted">
                        {m.claimedEmail || (m.claimedUid ? 'Linked' : 'Not linked')}
                      </td>
                      <td className="td-right">
                        <span className="row-actions">
                          {m.claimedUid && (
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => void handleUnbind(m.code)}
                            >
                              Unbind
                            </button>
                          )}
                          <button
                            type="button"
                            className="link-btn link-btn--danger"
                            onClick={() => void handleDelete(m)}
                          >
                            Delete
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {filtered.length > 300 && (
              <p className="caption">
                Showing first 300 of {filtered.length} matches. Narrow your search to see others.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
