/**
 * Format Unix ms as ISO 8601 with +07:00 (WIB / Jakarta) offset.
 * Used in tool I/O so timestamps are human-readable in the user's TZ.
 */
export function toIsoJakarta(ms: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  // Shift to Jakarta time (UTC+7), then format as if UTC to get +07:00 offset literal
  const jakartaMs = ms + 7 * 60 * 60 * 1000;
  const j = new Date(jakartaMs);
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}T${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}:${pad(j.getUTCSeconds())}+07:00`;
}

/** Parse ISO 8601 string to Unix ms. */
export function parseIsoToMs(iso: string): number {
  return new Date(iso).getTime();
}
