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

describe('JournalStore — dashboard helpers', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jnl-dash-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('listPage paginates with total count', () => {
    const s = createJournalStore(db);
    for (let i = 0; i < 5; i++) s.save({ content: `entry ${i}` });
    const r = s.listPage({ limit: 3, offset: 0 });
    expect(r.total).toBe(5);
    expect(r.rows.length).toBe(3);
  });

  it('listPage filters by createdAt range', () => {
    const s = createJournalStore(db);
    s.save({ content: 'a' });
    s.save({ content: 'b' });
    const now = Date.now();
    const r = s.listPage({ createdFrom: now - 1000 * 60 * 60, createdTo: now + 1000, limit: 50, offset: 0 });
    expect(r.total).toBe(2);
  });

  it('countByWeek buckets entries', () => {
    const s = createJournalStore(db);
    s.save({ content: 'a' });
    s.save({ content: 'b' });
    const buckets = s.countByWeek({ sinceMs: 0 });
    expect(buckets.length).toBeGreaterThanOrEqual(1);
    expect(buckets.reduce((acc, b) => acc + b.n, 0)).toBeGreaterThanOrEqual(2);
  });
});
