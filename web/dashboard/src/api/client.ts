export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown,
  ) { super(message); this.name = 'ApiError'; }
}

async function parseResponse(res: Response): Promise<unknown> {
  if (res.ok) return res.json();
  let body: { error?: { code?: string; message?: string; details?: unknown } } = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  throw new ApiError(
    body.error?.code ?? 'UNKNOWN',
    res.status,
    body.error?.message ?? `HTTP ${res.status}`,
    body.error?.details,
  );
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  return (await parseResponse(res)) as T;
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await parseResponse(res)) as T;
}
