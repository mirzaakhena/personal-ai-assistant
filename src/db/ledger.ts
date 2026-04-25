// src/db/ledger.ts
//
// Per-user generic structured time-series store. AI uses this for
// user-defined data accumulation (expenses, mood logs, learning logs, …).
// Schema per-stream is owned by skills, not infra; this module only
// provides append + SELECT-only query primitives.

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/**
 * Validate that `sql` is a single SELECT (or WITH … SELECT) statement
 * with no DDL/DML side effects. Throws on rejection; returns void on
 * success.
 *
 * Approach: strip comments, reject semicolons (no multi-statement),
 * require SELECT or WITH at the start, reject any DDL/DML keyword
 * appearing as a word boundary anywhere else.
 *
 * Known limitation: keywords appearing inside string literals or as
 * substrings of identifiers will trigger false-positive rejection
 * (e.g. `SELECT 1 AS create_count`). This is acceptable for a
 * security boundary — AI consumer can rephrase. We do NOT trade
 * tighter parsing for the risk of letting destructive SQL through.
 */
export function assertSafeSelect(sql: string): void {
  const cleaned = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  if (cleaned.length === 0) {
    throw new Error('ledger_query: empty query');
  }

  if (cleaned.includes(';')) {
    throw new Error('ledger_query: multi-statement (semicolon) queries are not allowed');
  }

  if (!/^(SELECT|WITH)\b/i.test(cleaned)) {
    throw new Error('ledger_query: only SELECT (and WITH … SELECT) queries are allowed');
  }

  // Note: only the leading `\b` is anchored. We intentionally omit the
  // trailing `\b` so that identifiers like `create_count` (where `_` is a
  // word char and prevents a trailing boundary) are still rejected.
  // Conservative-by-design: false positives over false negatives.
  const banned =
    /\b(INSERT|UPDATE|DELETE|ATTACH|DETACH|PRAGMA|ALTER|DROP|CREATE|REPLACE|TRUNCATE|VACUUM|REINDEX|ANALYZE)/i;
  if (banned.test(cleaned)) {
    throw new Error('ledger_query: DDL/DML keywords are not permitted');
  }
}

export interface LedgerRecord {
  id: string;
  ts: number;
  stream: string;
  payload: unknown;
  tags: string | null;
  source_msg_id: string | null;
  created_at: number;
}

export interface LedgerStore {
  append(rec: {
    stream: string;
    payload: unknown;
    tags?: string[];
    ts?: number;
    source_msg_id?: string;
  }): LedgerRecord;

  query(sql: string): Record<string, unknown>[];
}

const DDL = `
  CREATE TABLE IF NOT EXISTS ledger (
    id            TEXT PRIMARY KEY,
    ts            INTEGER NOT NULL,
    stream        TEXT NOT NULL,
    payload       TEXT NOT NULL,
    tags          TEXT,
    source_msg_id TEXT,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_stream_ts ON ledger(stream, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_ledger_tags ON ledger(tags) WHERE tags IS NOT NULL;
`;

export function createLedgerStore(db: Database.Database): LedgerStore {
  db.exec(DDL);

  const insert = db.prepare(`
    INSERT INTO ledger (id, ts, stream, payload, tags, source_msg_id, created_at)
    VALUES (@id, @ts, @stream, @payload, @tags, @source_msg_id, @created_at)
  `);

  function append(rec: {
    stream: string;
    payload: unknown;
    tags?: string[];
    ts?: number;
    source_msg_id?: string;
  }): LedgerRecord {
    if (!rec.stream || rec.stream.length === 0) {
      throw new Error('ledger_append: stream must be a non-empty string');
    }
    const now = Date.now();
    const tags = rec.tags && rec.tags.length > 0 ? rec.tags.join(' ') : null;
    const payloadJson = JSON.stringify(rec.payload);

    const row = {
      id: randomUUID(),
      ts: rec.ts ?? now,
      stream: rec.stream,
      payload: payloadJson,
      tags,
      source_msg_id: rec.source_msg_id ?? null,
      created_at: now,
    };
    insert.run(row);
    return {
      id: row.id,
      ts: row.ts,
      stream: row.stream,
      payload: rec.payload,
      tags: row.tags,
      source_msg_id: row.source_msg_id,
      created_at: row.created_at,
    };
  }

  function query(sql: string): Record<string, unknown>[] {
    assertSafeSelect(sql);
    const stmt = db.prepare(sql);
    return stmt.all() as Record<string, unknown>[];
  }

  return { append, query };
}
