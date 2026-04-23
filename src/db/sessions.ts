// src/db/sessions.ts

import Database from 'better-sqlite3';

export interface SessionStore {
  get(): string | undefined;
  getLastActivity(): number | undefined;
  save(sessionId: string): void;
  delete(): void;
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
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

  const DDL_META = `
    CREATE TABLE IF NOT EXISTS session_meta (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );
  `;
  db.exec(DDL_META);

  const metaGet = db.prepare<{ k: string }, { value: string }>(
    `SELECT value FROM session_meta WHERE key = @k`
  );
  const metaSet = db.prepare<{ k: string; v: string }>(`
    INSERT INTO session_meta (key, value) VALUES (@k, @v)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  function getMeta(key: string): string | null {
    return metaGet.get({ k: key })?.value ?? null;
  }
  function setMeta(key: string, value: string): void {
    metaSet.run({ k: key, v: value });
  }

  return {
    get() { return stmtGet.get()?.session_id; },
    getLastActivity() { return stmtGetLastActivity.get()?.updated_at; },
    save(sessionId) { stmtUpsert.run(sessionId, Date.now()); },
    delete() { stmtDelete.run(); },
    getMeta,
    setMeta,
  };
}
