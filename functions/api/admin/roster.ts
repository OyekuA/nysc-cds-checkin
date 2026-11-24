import { requireAdmin } from '../../_lib/auth';
import { ensureSchema, writeAuditLog } from '../../_lib/db';
import { normalizeStateCode } from '../../_lib/geo';
import { Env, errorResponse, jsonResponse } from '../../_lib/types';

interface RosterRow {
  code_id: string;
  code: string;
  name: string;
  claimed_sub: string | null;
  claimed_email: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT m.code_id, m.code, m.name, c.google_sub AS claimed_sub, c.email AS claimed_email
     FROM members m
     LEFT JOIN claims c ON c.code_id = m.code_id
     ORDER BY m.code ASC`
  ).all<RosterRow>();

  return jsonResponse({
    members: results.map((r) => ({
      codeId: r.code_id,
      code: r.code,
      name: r.name || '',
      claimedUid: r.claimed_sub ?? null,
      claimedEmail: r.claimed_email ?? null,
    })),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const body = (await request.json().catch(() => ({}))) as {
    entries?: Array<{ code?: string; name?: string }>;
  };

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    return errorResponse('Provide at least one state code to import.', 400);
  }
  if (body.entries.length > 2000) {
    return errorResponse('Import at most 2,000 rows per batch.', 400);
  }

  const deduped = new Map<string, { codeId: string; code: string; name: string }>();
  const errors: string[] = [];

  for (let i = 0; i < body.entries.length; i++) {
    const rawCode = String(body.entries[i]?.code ?? '').trim();
    const rawName = String(body.entries[i]?.name ?? '').trim().slice(0, 120);
    if (!rawCode) continue;
    const norm = normalizeStateCode(rawCode);
    if (!norm) {
      errors.push(`Row ${i + 1}: invalid state code "${rawCode}"`);
      continue;
    }
    deduped.set(norm.codeId, { codeId: norm.codeId, code: norm.code, name: rawName });
  }

  const items = Array.from(deduped.values());
  // Chunk D1 batch inserts cleanly in groups of 100
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100);
    await env.DB.batch(
      chunk.map((item) =>
        env.DB.prepare(
          `INSERT INTO members (code_id, code, name, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(code_id) DO UPDATE SET
             name = CASE WHEN excluded.name != '' THEN excluded.name ELSE members.name END,
             updated_at = datetime('now')`
        ).bind(item.codeId, item.code, item.name)
      )
    );
  }

  await writeAuditLog(env, auth.user.email, 'import_roster', {
    imported: items.length,
    errorCount: errors.length,
  });

  return jsonResponse({
    imported: items.length,
    errors: errors.slice(0, 50),
  });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if ('response' in auth) return auth.response;

  await ensureSchema(env);
  const url = new URL(request.url);
  const codeId = url.searchParams.get('codeId') || '';
  const unbindClaim = url.searchParams.get('unbindClaim') !== 'false';
  if (!codeId) {
    return errorResponse('Missing codeId.', 400);
  }

  const stmts = [env.DB.prepare(`DELETE FROM members WHERE code_id = ?`).bind(codeId)];
  if (unbindClaim) {
    stmts.push(env.DB.prepare(`DELETE FROM claims WHERE code_id = ?`).bind(codeId));
  }
  await env.DB.batch(stmts);

  await writeAuditLog(env, auth.user.email, 'delete_roster_entry', { codeId, unbindClaim });
  return jsonResponse({ ok: true });
};
