export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  retries?: number;
  timeoutMs?: number;
}

/**
 * Same-origin JSON fetch wrapper with timeout and optional transient-error retry
 * for flaky mobile networks (e.g. Glo packet drops).
 */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, retries = 0, timeoutMs = 15_000 } = opts;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(path, {
        method,
        credentials: 'include',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
      if (!res.ok) {
        // Retry only on 502/503/504 transient server/network failures
        if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < retries) {
          await new Promise((r) => window.setTimeout(r, 700));
          continue;
        }
        throw new ApiError(data.error || `Request failed (${res.status}).`, res.status);
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (err instanceof ApiError) throw err;
      if (attempt < retries) {
        await new Promise((r) => window.setTimeout(r, 700));
        continue;
      }
      if ((err as { name?: string })?.name === 'AbortError') {
        throw new ApiError('Request timed out. Check your internet connection and try again.', 0);
      }
      throw new ApiError('Unable to reach the server. Check your internet connection and try again.', 0);
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastErr;
}
