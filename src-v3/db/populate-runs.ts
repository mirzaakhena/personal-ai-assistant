// src-v3/db/populate-runs.ts

import Database from 'better-sqlite3';

export type PopulateRunStatus = 'success' | 'partial' | 'failed';

export interface PopulateRunRecord {
  session_pseudo_id: string;
  first_msg_id: string;
  last_msg_id: string;
  first_msg_at: number;
  last_msg_at: number;
  message_count: number;
  processed_at: number;
  ops_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  status: PopulateRunStatus;
  error: string | null;
  summary: string | null;
}

export interface PopulateRunsStore {
  insert(rec: PopulateRunRecord): void;
  getById(sessionPseudoId: string): PopulateRunRecord | undefined;
  list(opts?: { status?: PopulateRunStatus; limit?: number }): PopulateRunRecord[];
  processedIds(): Set<string>;
}

export function createPopulateRunsStore(db: Database.Database): PopulateRunsStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS populate_runs (
      session_pseudo_id  TEXT PRIMARY KEY,
      first_msg_id       TEXT NOT NULL,
      last_msg_id        TEXT NOT NULL,
      first_msg_at       INTEGER NOT NULL,
      last_msg_at        INTEGER NOT NULL,
      message_count      INTEGER NOT NULL,
      processed_at       INTEGER NOT NULL,
      ops_count          INTEGER NOT NULL,
      input_tokens       INTEGER,
      output_tokens      INTEGER,
      cost_usd           REAL,
      status             TEXT NOT NULL,
      error              TEXT,
      summary            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_populate_first_msg ON populate_runs(first_msg_at);
  `);

  const stmtInsert = db.prepare(`
    INSERT OR REPLACE INTO populate_runs (
      session_pseudo_id, first_msg_id, last_msg_id, first_msg_at, last_msg_at,
      message_count, processed_at, ops_count, input_tokens, output_tokens, cost_usd,
      status, error, summary
    ) VALUES (
      @session_pseudo_id, @first_msg_id, @last_msg_id, @first_msg_at, @last_msg_at,
      @message_count, @processed_at, @ops_count, @input_tokens, @output_tokens, @cost_usd,
      @status, @error, @summary
    )
  `);

  const stmtGet = db.prepare<[string], PopulateRunRecord>(
    `SELECT * FROM populate_runs WHERE session_pseudo_id = ?`
  );
  const stmtListAll = db.prepare<[], PopulateRunRecord>(
    `SELECT * FROM populate_runs ORDER BY first_msg_at ASC`
  );
  const stmtListByStatus = db.prepare<[PopulateRunStatus, number], PopulateRunRecord>(
    `SELECT * FROM populate_runs WHERE status = ? ORDER BY first_msg_at ASC LIMIT ?`
  );
  const stmtProcessed = db.prepare<[], { session_pseudo_id: string }>(
    `SELECT session_pseudo_id FROM populate_runs WHERE status = 'success'`
  );

  return {
    insert(rec) { stmtInsert.run(rec); },
    getById(id) { return stmtGet.get(id); },
    list(opts) {
      if (opts?.status) {
        return stmtListByStatus.all(opts.status, opts.limit ?? 1000);
      }
      return stmtListAll.all();
    },
    processedIds() {
      return new Set(stmtProcessed.all().map(r => r.session_pseudo_id));
    },
  };
}
