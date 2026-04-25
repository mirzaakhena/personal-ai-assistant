// src/db/ledger.ts
//
// Per-user generic structured time-series store. AI uses this for
// user-defined data accumulation (expenses, mood logs, learning logs, …).
// Schema per-stream is owned by skills, not infra; this module only
// provides append + SELECT-only query primitives.

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
