// src-v3/db/user-db.ts

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { createMemoryStore, type MemoryStore } from './memory.js';
import { createMessageStore, type MessageStore } from './message.js';
import { createSessionStore, type SessionStore } from './sessions.js';
import { createCronjobStore, type CronjobStore } from './cronjobs.js';

export interface UserDb {
  userId: string;
  memory: MemoryStore;
  messages: MessageStore;
  sessions: SessionStore;
  cronjobs: CronjobStore;
  close(): void;
}

/**
 * Open (or create) the per-user SQLite database at data/users/<userId>/app.db.
 * All 4 stores share a single Database connection for cross-table FK + transactions.
 */
export function createUserDb(userId: string, baseDir: string = 'data/users'): UserDb {
  const dir = join(baseDir, userId);
  mkdirSync(dir, { recursive: true });

  const dbPath = join(dir, 'app.db');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Order matters: messages table must exist before journal's source_msg_id FK references it.
  // createMessageStore creates the messages table; createMemoryStore creates journal with the FK.
  const messages = createMessageStore(db);
  const memory = createMemoryStore(db);
  const sessions = createSessionStore(db);
  const cronjobs = createCronjobStore(db);

  return {
    userId,
    memory,
    messages,
    sessions,
    cronjobs,
    close: () => db.close(),
  };
}
