// src-v3/utils/stats.ts

type QueryStats = {
  costUsd: number;
  durationMs: number;
  numTurns: number;
};

export type SessionStats = {
  sessionId: string;
  accumulated: QueryStats;
  lastQuery: QueryStats;
};

const statsMap = new Map<string, SessionStats>();

/**
 * Update stats for a user after a query completes.
 * If sessionId matches current session, accumulates on top.
 * If sessionId differs (new session), resets accumulated.
 */
export function updateStats(
  userId: string,
  sessionId: string,
  costUsd: number,
  durationMs: number,
  numTurns: number,
): void {
  const existing = statsMap.get(userId);
  const lastQuery: QueryStats = { costUsd, durationMs, numTurns };

  if (existing && existing.sessionId === sessionId) {
    statsMap.set(userId, {
      sessionId,
      accumulated: {
        costUsd: existing.accumulated.costUsd + costUsd,
        durationMs: existing.accumulated.durationMs + durationMs,
        numTurns: existing.accumulated.numTurns + numTurns,
      },
      lastQuery,
    });
  } else {
    statsMap.set(userId, {
      sessionId,
      accumulated: lastQuery,
      lastQuery,
    });
  }
}

/** Get stats for a user. Returns undefined if no stats recorded. */
export function getStats(userId: string): SessionStats | undefined {
  return statsMap.get(userId);
}

/** Clear stats for a user (e.g., on session reset). */
export function clearStats(userId: string): void {
  statsMap.delete(userId);
}
