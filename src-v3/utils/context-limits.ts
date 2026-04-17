// src-v3/utils/context-limits.ts
//
// Context window size inference from model ID.
// Source: Anthropic public pricing + model cards.

const ONE_MILLION = 1_000_000;
const TWO_HUNDRED_K = 200_000;

/**
 * Infer the context window size (in tokens) for a given model ID.
 * Sonnet and Opus have optional 1M-context variants marked with [1m] or -1m.
 * Everything else defaults to 200K.
 */
export function getContextLimit(modelId: string | null | undefined): number {
  if (!modelId) return TWO_HUNDRED_K;
  const lower = modelId.toLowerCase();
  if (lower.includes('[1m]') || lower.includes('-1m') || lower.includes(' 1m')) {
    return ONE_MILLION;
  }
  return TWO_HUNDRED_K;
}

/** Total tokens that occupied the context on the LAST query (input side). */
export function contextUsedFromUsage(usage: {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): number {
  return usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
}

/** Format large token count compact: 12,345 or 45.2K or 1.2M */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Format unix-epoch-seconds reset time as "in Xh Ym" relative to now. */
export function formatResetsIn(resetsAtSeconds: number | null): string {
  if (resetsAtSeconds === null) return '—';
  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = resetsAtSeconds - nowSec;
  if (diffSec <= 0) return 'now';
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format unix-epoch-seconds reset time as "HH:MM" in Jakarta tz. */
export function formatResetsAtLocal(resetsAtSeconds: number | null): string {
  if (resetsAtSeconds === null) return '—';
  const ms = resetsAtSeconds * 1000;
  // Format in Jakarta timezone (server default)
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
  });
}
