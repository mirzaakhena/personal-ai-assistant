import { MEMORY_FLUSH_TURN_THRESHOLD } from './constants.js';

/**
 * In-memory turn counter per phone number (session).
 * Tracks how many user messages have been sent in the current session.
 * Reset when the user starts a new session (/new).
 */
const turnCounts = new Map<string, number>();

export function incrementTurnCount(phoneNumber: string): number {
  const current = turnCounts.get(phoneNumber) ?? 0;
  const next = current + 1;
  turnCounts.set(phoneNumber, next);
  return next;
}

export function getTurnCount(phoneNumber: string): number {
  return turnCounts.get(phoneNumber) ?? 0;
}

export function clearTurnCount(phoneNumber: string): void {
  turnCounts.delete(phoneNumber);
}

export function shouldInjectFlushReminder(phoneNumber: string): boolean {
  return getTurnCount(phoneNumber) >= MEMORY_FLUSH_TURN_THRESHOLD;
}
