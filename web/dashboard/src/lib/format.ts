// web/dashboard/src/lib/format.ts

const TZ = 'Asia/Jakarta';

export function fmtTimestamp(ms: number | null | undefined): string {
  if (ms == null) return '';
  return new Date(ms).toLocaleString('en-GB', { timeZone: TZ, hour12: false });
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function fmtJson(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
