import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJournalStore } from './journal.js';

describe('journal store', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'v5-jnl-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('saves and reads recent', () => {
    const s = createJournalStore(db);
    const row = s.save({ content: 'Mirza nangis di kereta' });
    expect(row.id).toBeDefined();
    expect(row.content).toBe('Mirza nangis di kereta');
    expect(s.listRecent({})).toHaveLength(1);
  });

  it('respects days filter', () => {
    const s = createJournalStore(db);
    const dayMs = 24 * 60 * 60 * 1000;
    s.insertRaw({
      id: 'old', content: 'old entry', event_date: null, source_msg_id: null,
      created_at: Date.now() - 30 * dayMs,
    });
    s.insertRaw({
      id: 'new', content: 'new entry', event_date: null, source_msg_id: null,
      created_at: Date.now() - 1 * dayMs,
    });
    expect(s.listRecent({ days: 7 })).toHaveLength(1);
    expect(s.listRecent({ days: 60 })).toHaveLength(2);
  });

  it('respects limit', () => {
    const s = createJournalStore(db);
    for (let i = 0; i < 5; i++) s.save({ content: `entry ${i}` });
    expect(s.listRecent({ limit: 3 })).toHaveLength(3);
  });

  it('orders by created_at desc', () => {
    const s = createJournalStore(db);
    s.save({ content: 'first' });
    s.save({ content: 'second' });
    const rows = s.listRecent({});
    expect(rows[0].content).toBe('second');
    expect(rows[1].content).toBe('first');
  });
});
