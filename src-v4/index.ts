// src-v4/index.ts

import 'dotenv/config';
import { join } from 'node:path';
import { createConsoleGateway } from './gateway/console.js';
import { createTelegramGateway } from './gateway/telegram.js';
import { createUserDbCache } from './db/user-db-cache.js';
import { log } from './utils/logger.js';
import type { Gateway } from './gateway/types.js';

const GATEWAY_KIND = (process.env.GATEWAY ?? 'console').toLowerCase();
const DATA_DIR = process.env.DATA_DIR ?? 'data';
const USERS_BASE_DIR = join(DATA_DIR, 'users');

/**
 * v3→v4 session cleanup (one-time, idempotent).
 *
 * A user's stored sessionId from v3 must not be resumed under v4's prompt —
 * the compiled system prompt differs fundamentally. We detect "never had a
 * v4 session" by checking for any row in session_summaries; if none exists
 * and a sessionId is present, we clear it so the user's next message
 * triggers a fresh v4 session with a full wake-up briefing.
 *
 * Safe to run on every boot: once a user completes any v4 summarize, the
 * cleanup becomes a no-op for them.
 */
function cleanupV3Sessions(): void {
  const cache = createUserDbCache(USERS_BASE_DIR);
  const users = cache.listKnownUsers();
  let cleared = 0;
  for (const userId of users) {
    const userDb = cache.get(userId);
    const sessionId = userDb.sessions.get();
    if (!sessionId) continue;
    const anyV4Summary = userDb.sessions.getLatestSummaryForUser(userId);
    if (!anyV4Summary) {
      userDb.sessions.delete();
      cleared += 1;
    }
  }
  if (cleared > 0) {
    log.debug(`v3→v4 cleanup: cleared ${cleared} stale sessionId(s)`);
  }
  cache.closeAll();
}

function pickGateway(): Gateway {
  if (GATEWAY_KIND === 'telegram') {
    return createTelegramGateway({
      token: process.env.TELEGRAM_BOT_TOKEN ?? '',
      whitelist: process.env.TELEGRAM_WHITELIST?.split(',').map(Number) ?? [],
      dataDir: DATA_DIR,
    });
  }
  return createConsoleGateway({
    dataDir: DATA_DIR,
    userId: process.env.CONSOLE_USER_ID ?? 'console-user',
  });
}

cleanupV3Sessions();

const gateway = pickGateway();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.debug(`received ${signal}, shutting down...`);
  // gateway.stop() is idempotent and handles session summarization
  // internally (see gateway/console.ts and gateway/telegram.ts).
  try {
    await gateway.stop();
  } catch (err) {
    log.error('shutdown error', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await gateway.start();
