export const LAGOS_TZ = 'Africa/Lagos';

export function getTodayLagos(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: LAGOS_TZ });
}

export function getCurrentMonthLagos(): string {
  return getTodayLagos().slice(0, 7);
}

export function formatTimeLagos(dateOrIso: Date | string, includeSeconds = false): string {
  const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    timeZone: LAGOS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
  });
}

export function formatDateLongLagos(dateOrIso: Date | string): string {
  const d = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    timeZone: LAGOS_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function normalizeStateCodeInput(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function isValidStateCode(raw: string, allowedStates: string[] = []): boolean {
  const cleaned = normalizeStateCodeInput(raw);
  const m = /^([A-Z]{2})\/(\d{2}[ABC])\/(\d{4,6})$/.exec(cleaned);
  if (!m) return false;
  if (allowedStates.length > 0 && !allowedStates.map((s) => s.toUpperCase()).includes(m[1])) {
    return false;
  }
  return true;
}

export function extractErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  const e = err as { message?: string };
  if (typeof e.message === 'string' && e.message.trim()) {
    return e.message.trim();
  }
  return fallback;
}

/**
 * Formula-injection-safe CSV cell escaping (prevents Excel =/+/-/@ injection) and clean Blob cleanup.
 */
export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const escapeCell = (val: string | number | null | undefined): string => {
    let s = val === null || val === undefined ? '' : String(val);
    if (/^[=+\-@\t\r]/.test(s)) {
      s = `'${s}`;
    }
    return `"${s.replace(/"/g, '""')}"`;
  };

  const csvLines = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ];

  // UTF-8 BOM ensures Excel opens Nigerian names cleanly without mangling characters
  const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Parses pasted or uploaded CSV/TSV roster lines such as:
 *   LA/26A/0123, Ada Obi
 *   LA/26A/0124
 */
export function parseRosterText(raw: string): Array<{ code: string; name: string }> {
  const lines = raw.split(/\r?\n/);
  const entries: Array<{ code: string; name: string }> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Split on comma, tab, or semicolon (preserving names with spaces)
    const parts = line.split(/[,\t;]+/).map((p) => p.trim().replace(/^"|"$/g, ''));
    if (parts.length === 0) continue;

    // Skip obvious header row like "Code, Name", "State Code, Full Name", or "S/N, Code, Name"
    if (/^(state\s*)?code$/i.test(parts[0]) || /^s\/?n$/i.test(parts[0])) {
      continue;
    }

    // Handle optional leading serial number column: "1, LA/26A/0123, John Doe"
    let codeCol = parts[0];
    let nameCol = parts.slice(1).join(' ').trim();
    if (/^\d+$/.test(parts[0]) && parts[1] && /[A-Z]{2}\//i.test(parts[1])) {
      codeCol = parts[1];
      nameCol = parts.slice(2).join(' ').trim();
    }

    if (codeCol) {
      entries.push({ code: codeCol, name: nameCol });
    }
  }
  return entries;
}
