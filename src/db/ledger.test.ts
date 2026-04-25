// src/db/ledger.test.ts

import { describe, it, expect } from 'vitest';
import { assertSafeSelect } from './ledger.js';

describe('assertSafeSelect', () => {
  it('accepts a plain SELECT', () => {
    expect(() => assertSafeSelect(`SELECT * FROM ledger`)).not.toThrow();
  });

  it('accepts SELECT with WHERE / ORDER / LIMIT', () => {
    expect(() =>
      assertSafeSelect(
        `SELECT id, ts FROM ledger WHERE stream = 'expense' ORDER BY ts DESC LIMIT 10`
      )
    ).not.toThrow();
  });

  it('accepts WITH ... SELECT (CTE)', () => {
    expect(() =>
      assertSafeSelect(
        `WITH monthly AS (SELECT strftime('%Y-%m', ts/1000, 'unixepoch') AS m, SUM(json_extract(payload,'$.amount')) AS total FROM ledger WHERE stream='expense' GROUP BY m) SELECT * FROM monthly`
      )
    ).not.toThrow();
  });

  it('accepts comments inside the query', () => {
    expect(() =>
      assertSafeSelect(`-- top of month\nSELECT * FROM ledger /* inline */ WHERE 1=1`)
    ).not.toThrow();
  });

  it('rejects empty / whitespace-only input', () => {
    expect(() => assertSafeSelect('')).toThrow(/empty/i);
    expect(() => assertSafeSelect('   \n  ')).toThrow(/empty/i);
  });

  it('rejects multi-statement queries (semicolon)', () => {
    expect(() =>
      assertSafeSelect(`SELECT 1; SELECT 2`)
    ).toThrow(/multi-statement|semicolon/i);
  });

  it('rejects a trailing semicolon', () => {
    expect(() => assertSafeSelect(`SELECT 1;`)).toThrow(/multi-statement|semicolon/i);
  });

  it('rejects non-SELECT verbs (INSERT, UPDATE, DELETE)', () => {
    expect(() => assertSafeSelect(`INSERT INTO ledger VALUES (1)`)).toThrow();
    expect(() => assertSafeSelect(`UPDATE ledger SET ts = 0`)).toThrow();
    expect(() => assertSafeSelect(`DELETE FROM ledger`)).toThrow();
  });

  it('rejects DDL (CREATE, DROP, ALTER)', () => {
    expect(() => assertSafeSelect(`CREATE TABLE x(a)`)).toThrow();
    expect(() => assertSafeSelect(`DROP TABLE ledger`)).toThrow();
    expect(() => assertSafeSelect(`ALTER TABLE ledger ADD COLUMN x TEXT`)).toThrow();
  });

  it('rejects ATTACH / DETACH / PRAGMA / VACUUM / REINDEX / ANALYZE', () => {
    for (const stmt of [
      `ATTACH DATABASE 'x' AS y`,
      `DETACH DATABASE y`,
      `PRAGMA table_info(ledger)`,
      `VACUUM`,
      `REINDEX`,
      `ANALYZE`,
    ]) {
      expect(() => assertSafeSelect(stmt)).toThrow();
    }
  });

  it('rejects DML hidden after a comment', () => {
    expect(() =>
      assertSafeSelect(`/* comment */ DELETE FROM ledger`)
    ).toThrow();
  });

  it('accepts inert keywords appearing in column names but not as verbs', () => {
    // The query string contains "create" inside a column alias — still rejected
    // by the simple-keyword regex. This is acceptable for a security boundary
    // (false positive over false negative). Documented as a known limitation.
    expect(() => assertSafeSelect(`SELECT 1 AS create_count FROM ledger`)).toThrow();
  });
});
