// src-v3/utils/turns.ts

/**
 * In-memory turn counter per user.
 * Consumer decides when to increment (per user message)
 * and when to clear (e.g., on /new command).
 */
const turnCounts = new Map<string, number>();

/** Increment turn count for a user. Returns the new count. */
export function incrementTurnCount(userId: string): number {
  const current = turnCounts.get(userId) ?? 0;
  const next = current + 1;
  turnCounts.set(userId, next);
  return next;
}

/** Get current turn count for a user. Returns 0 if no turns recorded. */
export function getTurnCount(userId: string): number {
  return turnCounts.get(userId) ?? 0;
}

/** Clear turn count for a user (e.g., on session reset). */
export function clearTurnCount(userId: string): void {
  turnCounts.delete(userId);
}
