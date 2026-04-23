// src/utils/stats.ts

import type { UserDb } from '../db/user-db.js';
import type { QueryResult, RateLimitInfo } from '../ai-engine/types.js';
import { computeSimulatedApiCostUsd } from './pricing.js';

/** In-memory snapshot for fast /status display without DB round-trips. */
type QueryStatsSnapshot = {
  costUsd: number;
  durationMs: number;
  numTurns: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  simulatedApiCostUsd: number;
};

export type SessionStats = {
  sessionId: string;
  model: string | null;
  accumulated: QueryStatsSnapshot;
  lastQuery: QueryStatsSnapshot;
};

const statsMap = new Map<string, SessionStats>();
const rateLimitMap = new Map<string, RateLimitInfo>();

const EMPTY_SNAPSHOT: QueryStatsSnapshot = {
  costUsd: 0,
  durationMs: 0,
  numTurns: 0,
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  simulatedApiCostUsd: 0,
};

/**
 * Record a completed query: persist to query_costs table AND update in-memory
 * session snapshot (for /status quick display).
 */
export function recordQuery(userDb: UserDb, userId: string, result: QueryResult): void {
  const usage = result.usage;
  const input_tokens = usage?.inputTokens ?? 0;
  const cache_creation_tokens = usage?.cacheCreationTokens ?? 0;
  const cache_read_tokens = usage?.cacheReadTokens ?? 0;
  const output_tokens = usage?.outputTokens ?? 0;

  const simulatedApiCost = usage
    ? computeSimulatedApiCostUsd(result.model, {
        inputTokens: input_tokens,
        cacheCreationTokens: cache_creation_tokens,
        cacheReadTokens: cache_read_tokens,
        outputTokens: output_tokens,
      })
    : 0;

  // Persist — per-query record, enables historical + monthly aggregation
  userDb.queryCosts.insert({
    session_id: result.sessionId || null,
    timestamp: Date.now(),
    model: result.model,
    input_tokens,
    cache_creation_tokens,
    cache_read_tokens,
    output_tokens,
    actual_cost_usd: result.costUsd,
    simulated_api_cost_usd: simulatedApiCost,
    duration_ms: result.durationMs,
    num_turns: result.numTurns,
  });

  // Update in-memory session snapshot
  const lastQuery: QueryStatsSnapshot = {
    costUsd: result.costUsd,
    durationMs: result.durationMs,
    numTurns: result.numTurns,
    inputTokens: input_tokens,
    cacheCreationTokens: cache_creation_tokens,
    cacheReadTokens: cache_read_tokens,
    outputTokens: output_tokens,
    simulatedApiCostUsd: simulatedApiCost,
  };

  const existing = statsMap.get(userId);
  if (existing && existing.sessionId === result.sessionId) {
    statsMap.set(userId, {
      sessionId: result.sessionId,
      model: result.model ?? existing.model,
      accumulated: addSnapshots(existing.accumulated, lastQuery),
      lastQuery,
    });
  } else {
    statsMap.set(userId, {
      sessionId: result.sessionId,
      model: result.model,
      accumulated: { ...lastQuery },
      lastQuery,
    });
  }
}

/** Track the latest rate-limit snapshot per user (from SDK rate_limit_event). */
export function recordRateLimit(userId: string, info: RateLimitInfo): void {
  rateLimitMap.set(userId, info);
}

/** Get the latest rate-limit snapshot (undefined if none received yet). */
export function getRateLimit(userId: string): RateLimitInfo | undefined {
  return rateLimitMap.get(userId);
}

function addSnapshots(a: QueryStatsSnapshot, b: QueryStatsSnapshot): QueryStatsSnapshot {
  return {
    costUsd: a.costUsd + b.costUsd,
    durationMs: a.durationMs + b.durationMs,
    numTurns: a.numTurns + b.numTurns,
    inputTokens: a.inputTokens + b.inputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    simulatedApiCostUsd: a.simulatedApiCostUsd + b.simulatedApiCostUsd,
  };
}

/** Get in-memory session stats for a user. Returns undefined if none yet. */
export function getStats(userId: string): SessionStats | undefined {
  return statsMap.get(userId);
}

/** Clear in-memory session stats (e.g., on session reset). DB record persists. */
export function clearStats(userId: string): void {
  statsMap.delete(userId);
  rateLimitMap.delete(userId);
}

/** Convenience: returns a zero snapshot (useful for rendering empty state). */
export function emptySnapshot(): QueryStatsSnapshot {
  return { ...EMPTY_SNAPSHOT };
}
