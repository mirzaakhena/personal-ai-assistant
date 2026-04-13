// src-v3/db/sessions.ts

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export interface SessionStore {
  get(userId: string): string | undefined;
  save(userId: string, sessionId: string): void;
  delete(userId: string): void;
}

/**
 * Create a session store backed by SQLite.
 * @param dbPath - Path to the SQLite database file. Default: 'data/sessions.db'
 */
export function createSessionStore(dbPath: string = 'data/sessions.db'): SessionStore {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      user_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  const stmtGet = db.prepare<[string], { session_id: string }>(
    'SELECT session_id FROM sessions WHERE user_id = ?'
  );

  const stmtUpsert = db.prepare(
    `INSERT INTO sessions (user_id, session_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`
  );

  const stmtDelete = db.prepare('DELETE FROM sessions WHERE user_id = ?');

  return {
    get(userId: string): string | undefined {
      const row = stmtGet.get(userId);
      return row?.session_id;
    },

    save(userId: string, sessionId: string): void {
      stmtUpsert.run(userId, sessionId, Date.now());
    },

    delete(userId: string): void {
      stmtDelete.run(userId);
    },
  };
}
