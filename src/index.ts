// src/index.ts

import 'dotenv/config';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createConsoleGateway } from './gateway/console.js';
import { createTelegramGateway } from './gateway/telegram.js';
import { log } from './utils/logger.js';
import type { Gateway } from './gateway/types.js';

const GATEWAY_KIND = (process.env.GATEWAY ?? 'console').toLowerCase();
const DATA_DIR = process.env.DATA_DIR ?? 'data';
const USERS_BASE_DIR = join(DATA_DIR, 'users');

/**
 * v5 memory migration gate — fail-fast if any existing user's DB hasn't been
 * migrated. New users (no directory yet) are allowed through — they have no
 * legacy data to migrate and will get a fresh v5 schema on first boot.
 *
 * The flag `v5_memory_migrated='true'` is set by scripts/migrate-v5-memory.ts
 * at the end of a successful migration run.
 *
 * Uses raw SQLite instead of createUserDb to avoid running v5 DDL against
 * old-schema databases (which would crash on schema mismatches).
 */
function checkV5Migration(): void {
  if (!existsSync(USERS_BASE_DIR)) return;
  const userIds = readdirSync(USERS_BASE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const unmigrated: string[] = [];
  for (const userId of userIds) {
    const dbPath = join(USERS_BASE_DIR, userId, 'app.db');
    if (!existsSync(dbPath)) continue; // new user, no legacy data
    const db = new Database(dbPath, { readonly: true });
    try {
      // session_meta table may not exist on old DBs — that means unmigrated.
      const hasTable = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='session_meta'`
      ).get() as { name: string } | undefined;
      if (!hasTable) {
        unmigrated.push(userId);
        continue;
      }
      const row = db.prepare(
        `SELECT value FROM session_meta WHERE key = 'v5_memory_migrated'`
      ).get() as { value: string } | undefined;
      if (row?.value !== 'true') {
        unmigrated.push(userId);
      }
    } finally {
      db.close();
    }
  }

  if (unmigrated.length > 0) {
    console.error('');
    for (const userId of unmigrated) {
      console.error(`❌  v5 memory migration has not been run for user: ${userId}`);
      console.error(`    Run: V5_MIGRATE_USER_ID=${userId} pnpm tsx scripts/migrate-v5-memory.ts`);
      console.error(`    (this is a one-shot migration; it backs up app.db before running)`);
      console.error('');
    }
    process.exit(1);
  }
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

// v5 migration gate runs FIRST — before any v5 DDL touches user databases.
checkV5Migration();

const gateway = pickGateway();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.debug(`received ${signal}, shutting down...`);
  // gateway.stop() is idempotent; it drops each user's active-session
  // pointer so the next boot starts with a fresh wake-up briefing.
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
