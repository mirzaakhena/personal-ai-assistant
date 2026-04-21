// src-v4/db/sessions.ts

import Database from 'better-sqlite3';

export interface SessionSummaryRecord {
  id: string;
  session_id: string;
  user_id: string;
  summary: string;
  turns: number;
  ended_at: string;           // ISO 8601 with local offset
  ended_reason: 'turn_threshold' | 'graceful_shutdown' | 'manual';
  created_at: string;         // ISO 8601
}

export interface SessionStore {
  get(): string | undefined;
  getLastActivity(): number | undefined;
  save(sessionId: string): void;
  delete(): void;
  saveSummary(record: SessionSummaryRecord): void;
  getLatestSummaryForUser(userId: string): SessionSummaryRecord | undefined;
}

export function createSessionStore(db: Database.Database): SessionStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      summary       TEXT NOT NULL,
      turns         INTEGER NOT NULL,
      ended_at      TEXT NOT NULL,
      ended_reason  TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_summaries_user
      ON session_summaries(user_id, ended_at DESC);
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

  const stmtSaveSummary = db.prepare(`
    INSERT INTO session_summaries
      (id, session_id, user_id, summary, turns, ended_at, ended_reason, created_at)
    VALUES
      (@id, @session_id, @user_id, @summary, @turns, @ended_at, @ended_reason, @created_at)
  `);

  const stmtLatestSummary = db.prepare<[string], SessionSummaryRecord>(`
    SELECT * FROM session_summaries
    WHERE user_id = ?
    ORDER BY ended_at DESC
    LIMIT 1
  `);

  return {
    get() { return stmtGet.get()?.session_id; },
    getLastActivity() { return stmtGetLastActivity.get()?.updated_at; },
    save(sessionId) { stmtUpsert.run(sessionId, Date.now()); },
    delete() { stmtDelete.run(); },
    saveSummary(record) { stmtSaveSummary.run(record); },
    getLatestSummaryForUser(userId) { return stmtLatestSummary.get(userId); },
  };
}
