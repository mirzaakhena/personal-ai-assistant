// src/utils/logger.ts

import { TIMEZONE } from './model-config.js';

const GRAY  = '\x1b[90m';
const RED   = '\x1b[31m';
const RESET = '\x1b[0m';

const ANSI_RE = /\x1b\[[0-9;]*m/g;

const RING_CAP = 500;
const ringBuffer: string[] = [];

function pushRing(line: string): void {
  ringBuffer.push(line.replace(ANSI_RE, ''));
  if (ringBuffer.length > RING_CAP) {
    ringBuffer.splice(0, ringBuffer.length - RING_CAP);
  }
}

function ts(): string {
  return new Date().toLocaleTimeString('id-ID', {
    timeZone: TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const log = {
  /** System / operational info — dark gray */
  debug: (msg: string) => {
    const line = `[${ts()}] ${msg}`;
    pushRing(line);
    console.log(`${GRAY}${line}${RESET}`);
  },

  /** Conversation (user ↔ assistant) — default white */
  chat: (msg: string) => {
    const line = `[${ts()}] ${msg}`;
    pushRing(line);
    console.log(line);
  },

  /** Errors — red */
  error: (msg: string, err?: unknown) => {
    const detail = err instanceof Error ? err.message : err ? String(err) : '';
    const line = `[${ts()}] ${msg}${detail ? ' — ' + detail : ''}`;
    pushRing(line);
    console.error(`${RED}${line}${RESET}`);
  },
};

/**
 * Return the last `n` log lines (debug / chat / error combined, ANSI-stripped),
 * oldest first. Used by gateway `/log` commands so the operator can verify
 * AI behavior (tool calls, errors, fallbacks) without SSH-ing to the server.
 */
export function getRecentLogs(n: number = 20): string[] {
  if (n <= 0) return [];
  if (n >= ringBuffer.length) return ringBuffer.slice();
  return ringBuffer.slice(-n);
}

/** Test helper. Not used in production code paths. */
export function _clearRingBufferForTests(): void {
  ringBuffer.length = 0;
}
