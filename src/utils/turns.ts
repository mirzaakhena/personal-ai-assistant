// src/utils/turns.ts

import type { SessionStore } from '../db/sessions.js';

/**
 * Per-user turn counter, persisted via session_meta.
 *
 * Survives bot restart so a long-running session keeps its turn count
 * intact and the turnResetThreshold trigger fires at the same point
 * regardless of process restarts.
 *
 * In-memory cache avoids hitting SQLite on every read; writes go through
 * to session_meta on every increment so persistence is durable.
 */

const KEY = 'turn_count';
const cache = new Map<string, number>();

function read(userId: string, sessions: SessionStore): number {
  const cached = cache.get(userId);
  if (cached !== undefined) return cached;
  const stored = parseInt(sessions.getMeta(KEY) ?? '0', 10) || 0;
  cache.set(userId, stored);
  return stored;
}

/** Increment turn count for a user. Returns the new count. */
export function incrementTurnCount(userId: string, sessions: SessionStore): number {
  const next = read(userId, sessions) + 1;
  cache.set(userId, next);
  sessions.setMeta(KEY, String(next));
  return next;
}

/** Get current turn count for a user. Returns 0 if no turns recorded. */
export function getTurnCount(userId: string, sessions: SessionStore): number {
  return read(userId, sessions);
}

/** Clear turn count for a user (e.g., on session reset). */
export function clearTurnCount(userId: string, sessions: SessionStore): void {
  cache.delete(userId);
  sessions.setMeta(KEY, '0');
}
