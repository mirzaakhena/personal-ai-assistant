// src-v3/utils/pricing.ts
//
// Claude model pricing (USD per 1M tokens) for simulated API cost estimation.
// Subscription (Claude Pro/Max) users don't pay per-token, but for subscription
// business-model validation we need to know "kalau user ini pakai API-key langsung,
// berapa biayanya?"
//
// Pricing as of 2025-11 (Anthropic public pricing). Update when Anthropic changes.
// Cache write/read multipliers are Anthropic's standard:
//   - cache write: 1.25× input price (for 5-minute TTL default)
//   - cache read:  0.10× input price

export interface ModelPricing {
  /** Input tokens, USD per 1M */
  input: number;
  /** Output tokens, USD per 1M */
  output: number;
  /** Cache write multiplier on input price (default 1.25) */
  cacheWriteMult: number;
  /** Cache read multiplier on input price (default 0.10) */
  cacheReadMult: number;
}

const CACHE_WRITE_MULT = 1.25;
const CACHE_READ_MULT = 0.10;

/**
 * Pricing table keyed by family name. We match loosely by prefix since model
 * IDs evolve (claude-sonnet-4-6 vs claude-sonnet-4-7, etc).
 */
const PRICING: Record<string, ModelPricing> = {
  'opus':   { input: 15.00, output: 75.00, cacheWriteMult: CACHE_WRITE_MULT, cacheReadMult: CACHE_READ_MULT },
  'sonnet': { input:  3.00, output: 15.00, cacheWriteMult: CACHE_WRITE_MULT, cacheReadMult: CACHE_READ_MULT },
  'haiku':  { input:  0.80, output:  4.00, cacheWriteMult: CACHE_WRITE_MULT, cacheReadMult: CACHE_READ_MULT },
};

/** Fallback when we can't identify the model. Uses Sonnet pricing (middle-ground). */
const FALLBACK_PRICING: ModelPricing = PRICING['sonnet'];

export function getPricingFor(modelId: string | null | undefined): ModelPricing {
  if (!modelId) return FALLBACK_PRICING;
  const lower = modelId.toLowerCase();
  if (lower.includes('opus')) return PRICING['opus'];
  if (lower.includes('sonnet')) return PRICING['sonnet'];
  if (lower.includes('haiku')) return PRICING['haiku'];
  return FALLBACK_PRICING;
}

export interface TokenUsage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

/**
 * Compute what this query would have cost if billed directly via API-key
 * (not subscription). Uses the pricing table above.
 */
export function computeSimulatedApiCostUsd(
  modelId: string | null | undefined,
  usage: TokenUsage,
): number {
  const p = getPricingFor(modelId);
  const perMillion = 1_000_000;
  const inputCost = (usage.inputTokens / perMillion) * p.input;
  const cacheWriteCost = (usage.cacheCreationTokens / perMillion) * p.input * p.cacheWriteMult;
  const cacheReadCost = (usage.cacheReadTokens / perMillion) * p.input * p.cacheReadMult;
  const outputCost = (usage.outputTokens / perMillion) * p.output;
  return inputCost + cacheWriteCost + cacheReadCost + outputCost;
}

/** Convenience: format USD to a short display string. */
export function formatUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
