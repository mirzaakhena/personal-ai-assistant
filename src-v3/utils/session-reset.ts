// src-v3/utils/session-reset.ts

import type { UserDb } from '../db/user-db.js';
import { log } from './logger.js';

/**
 * Daily session reset boundary — server local hour (default 2 = 02:00).
 * Matches when master cronjob fires. Crossing this boundary since last activity
 * means the session is stale and should be reset for a fresh start.
 */
const RESET_HOUR = Number(process.env.SESSION_RESET_HOUR ?? 2);

/**
 * Guard window — if user was active within this many minutes, skip reset
 * (night owl protection — don't reset mid-conversation at 2am).
 */
const GUARD_MINUTES = Number(process.env.SESSION_RESET_GUARD_MIN ?? 30);

/**
 * Compute the most recent occurrence of RESET_HOUR in the past (server local time).
 * If RESET_HOUR for today hasn't happened yet, return yesterday's.
 */
function mostRecentBoundary(now: Date, hour: number): Date {
  const boundary = new Date(now);
  boundary.setHours(hour, 0, 0, 0);
  if (boundary.getTime() > now.getTime()) {
    boundary.setDate(boundary.getDate() - 1);
  }
  return boundary;
}

/**
 * Inspect session state; if last activity predates the most recent daily boundary
 * AND user isn't in the guard window, clear the session so the next query starts
 * fresh with a full memory_context reload.
 *
 * Returns true if reset happened. Safe to call before every runQuery invocation.
 */
export function maybeResetSession(userDb: UserDb, context: string = ''): boolean {
  const lastActivity = userDb.sessions.getLastActivity();
  if (lastActivity === undefined) return false;

  const now = new Date();
  const boundary = mostRecentBoundary(now, RESET_HOUR);

  if (lastActivity >= boundary.getTime()) return false;

  const guardMs = GUARD_MINUTES * 60 * 1000;
  if (now.getTime() - lastActivity < guardMs) return false;

  userDb.sessions.delete();
  log.debug(`[session-reset]${context ? ' ' + context : ''} crossed ${RESET_HOUR}:00 boundary since last activity — session cleared`);
  return true;
}
