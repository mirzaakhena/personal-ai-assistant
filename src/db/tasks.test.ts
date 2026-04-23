import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskStore } from './tasks.js';

describe('tasks store (v5)', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'v5-tasks-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('creates with pending default', () => {
    const s = createTaskStore(db);
    const t = s.create({ title: 'buy milk' });
    expect(t.status).toBe('pending');
    expect(t.due_date).toBeNull();
  });

  it('updates status to done', () => {
    const s = createTaskStore(db);
    const t = s.create({ title: 'x' });
    const res = s.update(t.id, { status: 'done' });
    expect(res.updated).toBe(true);
    expect(res.task?.status).toBe('done');
  });

  it('updates status to cancelled', () => {
    const s = createTaskStore(db);
    const t = s.create({ title: 'x' });
    s.update(t.id, { status: 'cancelled' });
    expect(s.listPending({}).length).toBe(0);
  });

  it('rejects invalid status', () => {
    const s = createTaskStore(db);
    const t = s.create({ title: 'x' });
    expect(() => s.update(t.id, { status: 'bogus' as any })).toThrow(/invalid TaskStatus/);
  });

  it('listPending filters by status', () => {
    const s = createTaskStore(db);
    s.create({ title: 'a' });
    const b = s.create({ title: 'b' });
    s.update(b.id, { status: 'done' });
    expect(s.listPending({}).length).toBe(1);
    expect(s.listPending({ status: 'done' }).length).toBe(1);
    expect(s.listPending({ status: 'cancelled' }).length).toBe(0);
  });

  it('deletes hard', () => {
    const s = createTaskStore(db);
    const t = s.create({ title: 'x' });
    expect(s.delete(t.id)).toBe(true);
    expect(s.delete(t.id)).toBe(false);
  });
});
