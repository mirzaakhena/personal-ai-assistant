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

  it('listEventTasks returns only pending tasks with trigger_type=event', () => {
    const s = createTaskStore(db);
    s.create({ title: 'plain', });
    s.create({ title: 'time-trigger', trigger_type: 'time', trigger_pattern: '0 18 * * *' });
    const e1 = s.create({
      title: 'beli batere, sikat gigi, sabun',
      trigger_type: 'event',
      trigger_pattern: 'kalau ke indomaret',
    });
    const e2 = s.create({
      title: 'makan silverqueen',
      trigger_type: 'event',
      trigger_pattern: 'kalau ARC keluar',
    });
    s.update(e2.id, { status: 'done' });

    const events = s.listEventTasks({ cap: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(e1.id);
    expect(events[0].trigger_pattern).toBe('kalau ke indomaret');
  });

  it('listEventTasks honors the cap and orders newest-first', async () => {
    const s = createTaskStore(db);
    for (let i = 0; i < 5; i++) {
      s.create({
        title: `task-${i}`,
        trigger_type: 'event',
        trigger_pattern: `pattern-${i}`,
      });
      // small delay so created_at differs
      await new Promise((r) => setTimeout(r, 2));
    }
    const limited = s.listEventTasks({ cap: 3 });
    expect(limited).toHaveLength(3);
    expect(limited[0].title).toBe('task-4');
    expect(limited[2].title).toBe('task-2');
  });

  it('listEventTasks defaults cap to 20 when unspecified', () => {
    const s = createTaskStore(db);
    for (let i = 0; i < 25; i++) {
      s.create({
        title: `t${i}`,
        trigger_type: 'event',
        trigger_pattern: `p${i}`,
      });
    }
    expect(s.listEventTasks({}).length).toBe(20);
  });

  it('update can promote a plain task to event-triggered', () => {
    const s = createTaskStore(db);
    const t = s.create({ title: 'cek pintu' });
    const res = s.update(t.id, {
      trigger_type: 'event',
      trigger_pattern: 'kalau keluar rumah',
    });
    expect(res.updated).toBe(true);
    expect(res.task?.trigger_type).toBe('event');
    expect(res.task?.trigger_pattern).toBe('kalau keluar rumah');
    expect(s.get(t.id)?.trigger_type).toBe('event');
  });

  it('update can clear trigger_type and trigger_pattern by passing null', () => {
    const s = createTaskStore(db);
    const t = s.create({
      title: 'x',
      trigger_type: 'event',
      trigger_pattern: 'p',
    });
    const res = s.update(t.id, { trigger_type: null, trigger_pattern: null });
    expect(res.task?.trigger_type).toBeNull();
    expect(res.task?.trigger_pattern).toBeNull();
  });

  it('update rejects invalid trigger_type', () => {
    const s = createTaskStore(db);
    const t = s.create({ title: 'x' });
    expect(() =>
      s.update(t.id, { trigger_type: 'bogus' as any })
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

describe('TaskStore — dashboard helpers', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tsk-dash-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('listPage filters by status', () => {
    const s = createTaskStore(db);
    const a = s.create({ title: 'a' });           // pending by default
    const b = s.create({ title: 'b' });
    s.update(b.id, { status: 'done' });
    const r = s.listPage({ status: 'pending', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.rows[0].id).toBe(a.id);
  });

  it('listPage filters by trigger_type', () => {
    const s = createTaskStore(db);
    s.create({ title: 'a', trigger_type: 'time' });
    s.create({ title: 'b', trigger_type: 'event' });
    const r = s.listPage({ trigger_type: 'event', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.rows[0].title).toBe('b');
  });

  it('countByStatus aggregates and zeros absent', () => {
    const s = createTaskStore(db);
    s.create({ title: 'a' }); // pending
    s.create({ title: 'b' }); // pending
    const c = s.create({ title: 'c' });
    s.update(c.id, { status: 'done' });
    const counts = s.countByStatus();
    expect(counts.pending).toBe(2);
    expect(counts.done).toBe(1);
    expect(counts.cancelled).toBe(0);
  });
});
