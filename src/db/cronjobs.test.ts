import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCronjobStore, type CronjobRecord } from './cronjobs.js';

describe('CronjobStore — dashboard helpers', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cron-dash-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  function mkJob(over: Partial<CronjobRecord>): CronjobRecord {
    const now = Date.now();
    return {
      id: 'jX', message: 'do thing', type: 'once',
      schedule_cron: null, schedule_human: 'in 5 min',
      scheduled_at: now + 60_000, end_date: null,
      status: 'PENDING', created_at: now, updated_at: now,
      ...over,
    };
  }

  it('listPage filters by type', () => {
    const s = createCronjobStore(db);
    s.insertJob(mkJob({ id: 'j1', type: 'once' }));
    s.insertJob(mkJob({ id: 'j2', type: 'recurring' }));
    const r = s.listPage({ type: 'once', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.rows[0].id).toBe('j1');
  });

  it('listPage filters by status', () => {
    const s = createCronjobStore(db);
    s.insertJob(mkJob({ id: 'j1', status: 'PENDING' }));
    s.insertJob(mkJob({ id: 'j2', status: 'EXECUTED' }));
    const r = s.listPage({ status: 'EXECUTED', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.rows[0].id).toBe('j2');
  });

  it('countByStatus aggregates', () => {
    const s = createCronjobStore(db);
    s.insertJob(mkJob({ id: 'j1', status: 'PENDING' }));
    s.insertJob(mkJob({ id: 'j2', status: 'PENDING' }));
    s.insertJob(mkJob({ id: 'j3', status: 'EXECUTED' }));
    const c = s.countByStatus();
    expect(c.PENDING ?? 0).toBe(2);
    expect(c.EXECUTED ?? 0).toBe(1);
  });
});
