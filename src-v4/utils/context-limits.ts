// src-v4/utils/context-limits.ts
//
// Context window size inference from model ID.
// Source: Anthropic public pricing + model cards.

const ONE_MILLION = 1_000_000;
const TWO_HUNDRED_K = 200_000;

/**
 * Infer the context window size (in tokens) for a given model ID.
 *
 * Model defaults (verified via docs.claude.com, 2026-04):
 *   - Opus 4.6 / 4.7: 1M native default (no opt-in)
 *   - Sonnet 4.6: 200K default; 1M opt-in via [1m] suffix (standard pricing since Mar 2026)
 *   - Haiku 4.5: 200K (no 1M variant)
 *
 * Env override: set CLAUDE_CONTEXT_LIMIT=<number> to force a specific limit.
 */
export function getContextLimit(modelId: string | null | undefined): number {
  const envOverride = process.env.CLAUDE_CONTEXT_LIMIT;
  if (envOverride) {
    const n = Number(envOverride);
    if (Number.isFinite(n) && n > 0) return n;
  }

  if (!modelId) return TWO_HUNDRED_K;
  const lower = modelId.toLowerCase();

  // Explicit 1M opt-in for any model: `[1m]` suffix or `-1m` / ` 1m` marker
  if (lower.includes('[1m]') || lower.includes('-1m') || lower.includes(' 1m')) {
    return ONE_MILLION;
  }

  // Opus 4.6+ ships 1M by default (no opt-in required)
  if (/opus-4-(6|7|8|9|\d{2,})/.test(lower)) return ONE_MILLION;

  // Sonnet without [1m] suffix → 200K default (even Sonnet 4.6)
  // Haiku any version → 200K
  // Older Opus / Sonnet → 200K
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
