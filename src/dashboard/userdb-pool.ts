// src/dashboard/userdb-pool.ts

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { type UserDb } from '../db/user-db.js';
import { createProfileStore } from '../db/profile.js';
import { createPreferenceStore } from '../db/preferences.js';
import { createKnowledgeStore } from '../db/knowledge.js';
import { createJournalStore } from '../db/journal.js';
import { createMessageStore } from '../db/message.js';
import { createSessionStore } from '../db/sessions.js';
import { createCronjobStore } from '../db/cronjobs.js';
import { createTaskStore } from '../db/tasks.js';
import { createLedgerStore } from '../db/ledger.js';
import { createQueryCostStore } from '../db/query-costs.js';
import { createReactionStore } from '../db/reactions.js';

export class DbBusyError extends Error {
  constructor(message = 'database is busy') {
    super(message);
    this.name = 'DbBusyError';
  }
}
export class UserNotFoundError extends Error {
  constructor(public userId: string) {
    super(`USER_NOT_FOUND: ${userId}`);
    this.name = 'UserNotFoundError';
  }
}

export type ActiveUser = { userId: string; db: UserDb };

export type DashboardUserDbPool = {
  listUserIds(): string[];
  acquire(userId: string): UserDb;
  runWithRetry<T>(fn: () => Promise<T> | T): Promise<T>;
  dispose(): void;
};

type CacheEntry = { db: UserDb; expiresAt: number };

const TTL_MS = 5 * 60 * 1000;
const SWEEP_MS = 60 * 1000;
const RETRY_DELAYS = [50, 100, 200];

export function createUserDbPool(opts: {
  baseDir: string;
  activeUser?: ActiveUser;
}): DashboardUserDbPool {
  const { baseDir, activeUser } = opts;
  const cache = new Map<string, CacheEntry>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [uid, e] of cache) {
      if (uid === activeUser?.userId) continue;
      if (e.expiresAt <= now) {
        e.db.close();
        cache.delete(uid);
      }
    }
  }, SWEEP_MS);
  sweep.unref?.();

  function listUserIds(): string[] {
    if (!existsSync(baseDir)) return [];
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  function acquire(userId: string): UserDb {
    if (activeUser && activeUser.userId === userId) return activeUser.db;

    const cached = cache.get(userId);
    if (cached) {
      cached.expiresAt = Date.now() + TTL_MS;
      return cached.db;
    }

    const dir = join(baseDir, userId);
    const dbPath = join(dir, 'app.db');
    if (!existsSync(dbPath)) throw new UserNotFoundError(userId);

    const db = openReadOnly(dbPath, userId);
    cache.set(userId, { db, expiresAt: Date.now() + TTL_MS });
    return db;
  }

  async function runWithRetry<T>(fn: () => Promise<T> | T): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < RETRY_DELAYS.length; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string }).code;
        if (code !== 'SQLITE_BUSY') throw err;
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));
      }
    }
    throw new DbBusyError(`SQLITE_BUSY after ${RETRY_DELAYS.length} retries`);
  }

  function dispose(): void {
    clearInterval(sweep);
    for (const [uid, e] of cache) {
      if (uid === activeUser?.userId) continue;
      e.db.close();
    }
    cache.clear();
  }

  return { listUserIds, acquire, runWithRetry, dispose };
}

/**
 * Opens a UserDb backed by a read-only-mode SQLite connection.
 * NOTE: passes `readonly: false` because the existing store factories run
 * `CREATE TABLE IF NOT EXISTS` DDL on construction, which a true readonly
 * connection rejects. The dashboard's discipline is to never call mutation
 * methods on these instances — see plan §3 "Key choices".
 */
function openReadOnly(dbPath: string, userId: string): UserDb {
  const conn = new Database(dbPath, { fileMustExist: true });
  conn.pragma('foreign_keys = ON');
  conn.pragma('journal_mode = DELETE');

  const messages = createMessageStore(conn);
  const profile = createProfileStore(conn);
  const preferences = createPreferenceStore(conn);
  const knowledge = createKnowledgeStore(conn);
  const journal = createJournalStore(conn);
  const sessions = createSessionStore(conn);
  const cronjobs = createCronjobStore(conn);
  const tasks = createTaskStore(conn);
  const ledger = createLedgerStore(conn);
  const queryCosts = createQueryCostStore(conn);
  const reactions = createReactionStore(conn);

  return {
    userId,
    profile, preferences, knowledge, journal, messages,
    sessions, cronjobs, tasks, ledger, queryCosts, reactions,
    close: () => conn.close(),
  };
}
