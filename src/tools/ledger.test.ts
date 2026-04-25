// src/tools/ledger.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedgerStore } from '../db/ledger.js';
import { createLedgerHandlers } from './ledger.js';

describe('createLedgerHandlers', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tools-ledger-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('appendLedger persists and returns the record', () => {
    const h = createLedgerHandlers(createLedgerStore(db));
    const r = h.appendLedger({
      stream: 'expense',
      payload: { amount: 35000, category: 'food' },
    });
    expect(r.stream).toBe('expense');
    expect(r.payload).toEqual({ amount: 35000, category: 'food' });
    expect(typeof r.id).toBe('string');
  });

  it('queryLedger runs the SELECT and returns rows', () => {
    const store = createLedgerStore(db);
    store.append({ stream: 'mood', payload: { score: 7 } });
    store.append({ stream: 'mood', payload: { score: 5 } });

    const h = createLedgerHandlers(store);
    const rows = h.queryLedger(
      `SELECT AVG(json_extract(payload,'$.score')) AS avg FROM ledger WHERE stream='mood'`
    );
    expect(rows[0].avg).toBe(6);
  });

  it('queryLedger surfaces the parser error verbatim', () => {
    const h = createLedgerHandlers(createLedgerStore(db));
    expect(() => h.queryLedger(`DELETE FROM ledger`)).toThrow(/only SELECT|DDL\/DML/);
  });
});
