type QueryStats = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

type SessionStats = {
  model: string;
  sessionId: string;
  accumulated: QueryStats;
  lastQuery: QueryStats;
};

const statsMap = new Map<string, SessionStats>();

export function updateStats(
  phoneNumber: string,
  sessionId: string,
  model: string,
  costUsd: number,
  inputTokens: number,
  outputTokens: number,
): void {
  const existing = statsMap.get(phoneNumber);
  const lastQuery: QueryStats = { costUsd, inputTokens, outputTokens };

  if (existing && existing.sessionId === sessionId) {
    statsMap.set(phoneNumber, {
      model,
      sessionId,
      accumulated: {
        costUsd: existing.accumulated.costUsd + costUsd,
        inputTokens: existing.accumulated.inputTokens + inputTokens,
        outputTokens: existing.accumulated.outputTokens + outputTokens,
      },
      lastQuery,
    });
  } else {
    statsMap.set(phoneNumber, {
      model,
      sessionId,
      accumulated: { costUsd, inputTokens, outputTokens },
      lastQuery,
    });
  }
}

export function clearStats(phoneNumber: string): void {
  statsMap.delete(phoneNumber);
}

export function getStats(phoneNumber: string): SessionStats | undefined {
  return statsMap.get(phoneNumber);
}
