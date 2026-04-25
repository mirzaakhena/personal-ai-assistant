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

  it('persists trigger_type and trigger_pattern when provided', () => {
    const s = createTaskStore(db);
    const t = s.create({
      title: 'beli batere, sikat gigi, sabun',
      trigger_type: 'event',
      trigger_pattern: 'kalau ke indomaret',
    });
    expect(t.trigger_type).toBe('event');
    expect(t.trigger_pattern).toBe('kalau ke indomaret');

    const got = s.get(t.id);
    expect(got?.trigger_type).toBe('event');
    expect(got?.trigger_pattern).toBe('kalau ke indomaret');
  });

  it('defaults trigger_type and trigger_pattern to null when omitted', () => {
    const s = createTaskStore(db);
    const t = s.create({ title: 'plain todo' });
    expect(t.trigger_type).toBeNull();
    expect(t.trigger_pattern).toBeNull();
  });

  it('rejects invalid trigger_type', () => {
    const s = createTaskStore(db);
    expect(() =>
      s.create({ title: 'x', trigger_type: 'bogus' as any })
    ).toThrow(/invalid TaskTriggerType/);
  });

  it('legacy DB without trigger columns is auto-migrated on store init', () => {
    db.exec(`DROP TABLE IF EXISTS tasks`);
    db.exec(`
      CREATE TABLE tasks (
        id             TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        notes          TEXT,
        status         TEXT NOT NULL DEFAULT 'pending',
        due_date       TEXT,
        source_msg_id  TEXT,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      )
    `);
    db.prepare(
      `INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`
    ).run('legacy-1', 'pre-existing', Date.now(), Date.now());

    const s = createTaskStore(db);
    const got = s.get('legacy-1');
    expect(got?.title).toBe('pre-existing');
    expect(got?.trigger_type).toBeNull();
    expect(got?.trigger_pattern).toBeNull();
  });
});
