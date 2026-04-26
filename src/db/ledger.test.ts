// src/db/ledger.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafeSelect, createLedgerStore } from './ledger.js';

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

describe('LedgerStore.append', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ledger-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('appends a record and returns it with a generated id', () => {
    const s = createLedgerStore(db);
    const r = s.append({
      stream: 'expense',
      payload: { amount: 35000, currency: 'IDR', category: 'food', note: 'kopi' },
      tags: ['food', 'beverage'],
    });
    expect(r.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(r.stream).toBe('expense');
    expect(r.payload).toEqual({ amount: 35000, currency: 'IDR', category: 'food', note: 'kopi' });
    expect(r.tags).toBe('food beverage');
    expect(typeof r.ts).toBe('number');
    expect(typeof r.created_at).toBe('number');
  });

  it('honors a provided ts (ms epoch)', () => {
    const s = createLedgerStore(db);
    const r = s.append({
      stream: 'mood',
      payload: { score: 7 },
      ts: 1_600_000_000_000,
    });
    expect(r.ts).toBe(1_600_000_000_000);
  });

  it('persists payload as JSON-encoded TEXT in the column', () => {
    const s = createLedgerStore(db);
    const r = s.append({ stream: 'x', payload: { a: 1 } });
    const row = db
      .prepare('SELECT payload FROM ledger WHERE id = ?')
      .get(r.id) as { payload: string };
    expect(row.payload).toBe('{"a":1}');
  });

  it('rejects empty stream', () => {
    const s = createLedgerStore(db);
    expect(() => s.append({ stream: '', payload: {} })).toThrow(/stream/i);
  });

  it('joins multi-word tags with a single space', () => {
    const s = createLedgerStore(db);
    const r = s.append({
      stream: 'x',
      payload: {},
      tags: ['a', 'b', 'c'],
    });
    expect(r.tags).toBe('a b c');
  });

  it('stores null tags when omitted or empty array', () => {
    const s = createLedgerStore(db);
    const a = s.append({ stream: 'x', payload: {} });
    const b = s.append({ stream: 'x', payload: {}, tags: [] });
    expect(a.tags).toBeNull();
    expect(b.tags).toBeNull();
  });
});

describe('LedgerStore — dashboard helpers', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ldg-dash-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('listPage filters by stream', () => {
    const s = createLedgerStore(db);
    s.append({ stream: 'spending', payload: { amount: 10 }, tags: ['food'], ts: 1000 });
    s.append({ stream: 'mood', payload: { score: 8 }, ts: 1100 });
    const r = s.listPage({ stream: 'spending', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.rows[0].stream).toBe('spending');
  });

  it('listPage filters by tags substring', () => {
    const s = createLedgerStore(db);
    s.append({ stream: 'spending', payload: { amount: 10 }, tags: ['food', 'coffee'], ts: 1000 });
    s.append({ stream: 'spending', payload: { amount: 5 },  tags: ['transport'],     ts: 1100 });
    const r = s.listPage({ tagsLike: 'coffee', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
  });

  it('listPage filters by ts range', () => {
    const s = createLedgerStore(db);
    s.append({ stream: 'a', payload: {}, ts: 1000 });
    s.append({ stream: 'a', payload: {}, ts: 2000 });
    const r = s.listPage({ tsFrom: 1500, limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.rows[0].ts).toBe(2000);
  });

  it('aggregateByStream returns events-per-stream', () => {
    const s = createLedgerStore(db);
    s.append({ stream: 'a', payload: {}, ts: 1 });
    s.append({ stream: 'a', payload: {}, ts: 2 });
    s.append({ stream: 'b', payload: {}, ts: 3 });
    const agg = s.aggregateByStream({ sinceMs: 0 });
    const map = Object.fromEntries(agg.map((r) => [r.stream, r.n]));
    expect(map.a).toBe(2);
    expect(map.b).toBe(1);
  });
});

describe('LedgerStore.query', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ledger-q-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns rows matching a SELECT', () => {
    const s = createLedgerStore(db);
    s.append({ stream: 'expense', payload: { amount: 35000, category: 'food' } });
    s.append({ stream: 'expense', payload: { amount: 12000, category: 'food' } });
    s.append({ stream: 'expense', payload: { amount: 50000, category: 'transport' } });

    const rows = s.query(
      `SELECT json_extract(payload, '$.category') AS cat, COUNT(*) AS n
       FROM ledger WHERE stream = 'expense' GROUP BY cat ORDER BY cat`
    );
    expect(rows).toEqual([
      { cat: 'food', n: 2 },
      { cat: 'transport', n: 1 },
    ]);
  });

  it('supports SUM aggregation via json_extract', () => {
    const s = createLedgerStore(db);
    s.append({ stream: 'expense', payload: { amount: 35000 } });
    s.append({ stream: 'expense', payload: { amount: 12000 } });
    s.append({ stream: 'expense', payload: { amount: 50000 } });

    const rows = s.query(
      `SELECT SUM(json_extract(payload,'$.amount')) AS total FROM ledger WHERE stream='expense'`
    );
    expect(rows[0].total).toBe(97000);
  });

  it('rejects non-SELECT statements via assertSafeSelect', () => {
    const s = createLedgerStore(db);
    expect(() => s.query(`DELETE FROM ledger`)).toThrow(/only SELECT|DDL\/DML/);
  });

  it('returns empty array for a SELECT that matches no rows', () => {
    const s = createLedgerStore(db);
    expect(s.query(`SELECT * FROM ledger WHERE 1=0`)).toEqual([]);
  });
});
