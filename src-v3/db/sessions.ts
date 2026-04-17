// src-v3/db/sessions.ts

import Database from 'better-sqlite3';

export interface SessionStore {
  get(): string | undefined;
  getLastActivity(): number | undefined;
  save(sessionId: string): void;
  delete(): void;
}

export function createSessionStore(db: Database.Database): SessionStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  const stmtGet = db.prepare<[], { session_id: string }>(
    'SELECT session_id FROM sessions WHERE id = 1'
  );

  const stmtGetLastActivity = db.prepare<[], { updated_at: number }>(
    'SELECT updated_at FROM sessions WHERE id = 1'
  );

  const stmtUpsert = db.prepare(
    `INSERT INTO sessions (id, session_id, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`
  );

  const stmtDelete = db.prepare('DELETE FROM sessions WHERE id = 1');

  return {
    get() { return stmtGet.get()?.session_id; },
    getLastActivity() { return stmtGetLastActivity.get()?.updated_at; },
    save(sessionId) { stmtUpsert.run(sessionId, Date.now()); },
    delete() { stmtDelete.run(); },
  };
}
