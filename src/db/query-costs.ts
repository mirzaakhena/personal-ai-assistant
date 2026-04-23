// src/db/query-costs.ts

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export interface QueryCostRecord {
  id: string;
  session_id: string | null;
  timestamp: number;            // ms epoch when query completed
  model: string | null;
  input_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  actual_cost_usd: number;      // what SDK reports (0 for subscription auth, >0 for API)
  simulated_api_cost_usd: number; // computed from tokens + pricing table
  duration_ms: number;
  num_turns: number;
}

export interface CostAggregate {
  queries: number;
  input_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  actual_cost_usd: number;
  simulated_api_cost_usd: number;
  duration_ms: number;
}

export interface QueryCostStore {
  insert(rec: Omit<QueryCostRecord, 'id'>): QueryCostRecord;
  aggregateSince(sinceMs: number): CostAggregate;
  aggregateSession(sessionId: string): CostAggregate;
  listRecent(cap?: number): QueryCostRecord[];
}

const EMPTY_AGG: CostAggregate = {
  queries: 0,
  input_tokens: 0,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  output_tokens: 0,
  actual_cost_usd: 0,
  simulated_api_cost_usd: 0,
  duration_ms: 0,
};

export function createQueryCostStore(db: Database.Database): QueryCostStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS query_costs (
      id                      TEXT PRIMARY KEY,
      session_id              TEXT,
      timestamp               INTEGER NOT NULL,
      model                   TEXT,
      input_tokens            INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens   INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens       INTEGER NOT NULL DEFAULT 0,
      output_tokens           INTEGER NOT NULL DEFAULT 0,
      actual_cost_usd         REAL NOT NULL DEFAULT 0,
      simulated_api_cost_usd  REAL NOT NULL DEFAULT 0,
      duration_ms             INTEGER NOT NULL DEFAULT 0,
      num_turns               INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_query_costs_ts ON query_costs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_query_costs_session ON query_costs(session_id);
  `);

  const stmtInsert = db.prepare(`
    INSERT INTO query_costs (
      id, session_id, timestamp, model,
      input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
      actual_cost_usd, simulated_api_cost_usd, duration_ms, num_turns
    ) VALUES (
      @id, @session_id, @timestamp, @model,
      @input_tokens, @cache_creation_tokens, @cache_read_tokens, @output_tokens,
      @actual_cost_usd, @simulated_api_cost_usd, @duration_ms, @num_turns
    )
  `);

  const stmtAggSince = db.prepare<[number], CostAggregate>(`
    SELECT
      COUNT(*) as queries,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(actual_cost_usd), 0) as actual_cost_usd,
      COALESCE(SUM(simulated_api_cost_usd), 0) as simulated_api_cost_usd,
      COALESCE(SUM(duration_ms), 0) as duration_ms
    FROM query_costs
    WHERE timestamp >= ?
  `);

  const stmtAggSession = db.prepare<[string], CostAggregate>(`
    SELECT
      COUNT(*) as queries,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
      COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(actual_cost_usd), 0) as actual_cost_usd,
      COALESCE(SUM(simulated_api_cost_usd), 0) as simulated_api_cost_usd,
      COALESCE(SUM(duration_ms), 0) as duration_ms
    FROM query_costs
    WHERE session_id = ?
  `);

  const stmtListRecent = db.prepare<[number], QueryCostRecord>(`
    SELECT * FROM query_costs ORDER BY timestamp DESC LIMIT ?
  `);

  return {
    insert(rec) {
      const id = uuidv4();
      const full: QueryCostRecord = { ...rec, id };
      stmtInsert.run(full);
      return full;
    },
    aggregateSince(sinceMs) {
      const row = stmtAggSince.get(sinceMs);
      return row ?? EMPTY_AGG;
    },
    aggregateSession(sessionId) {
      const row = stmtAggSession.get(sessionId);
      return row ?? EMPTY_AGG;
    },
    listRecent(cap = 20) {
      const limit = Math.max(1, Math.min(200, Math.floor(cap)));
      return stmtListRecent.all(limit);
    },
  };
}
