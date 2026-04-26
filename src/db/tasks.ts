// src/db/tasks.ts

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export const TASK_STATUSES = ['pending', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TRIGGER_TYPES = ['time', 'event', 'always'] as const;
export type TaskTriggerType = (typeof TASK_TRIGGER_TYPES)[number];

export interface TaskRecord {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  due_date: string | null;
  source_msg_id: string | null;
  trigger_type: TaskTriggerType | null;
  trigger_pattern: string | null;
  created_at: number;
  updated_at: number;
}

export interface TaskStore {
  create(rec: {
    title: string;
    notes?: string;
    due_date?: string;
    source_msg_id?: string;
    trigger_type?: TaskTriggerType;
    trigger_pattern?: string;
  }): TaskRecord;
  update(id: string, patch: {
    status?: TaskStatus;
    title?: string;
    notes?: string;
    due_date?: string | null;
    trigger_type?: TaskTriggerType | null;
    trigger_pattern?: string | null;
  }): { updated: boolean; task?: TaskRecord };
  listPending(filter: { status?: TaskStatus; cap?: number }): TaskRecord[];
  listEventTasks(filter: { cap?: number }): TaskRecord[];
  listPage(opts: {
    status?: TaskStatus;
    trigger_type?: TaskTriggerType;
    dueDateFrom?: string;
    dueDateTo?: string;
    limit: number;
    offset: number;
  }): { rows: TaskRecord[]; total: number };
  countByStatus(): Record<TaskStatus, number>;
  get(id: string): TaskRecord | null;
  delete(id: string): boolean;
}

const DDL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    due_date        TEXT,
    source_msg_id   TEXT,
    trigger_type    TEXT,
    trigger_pattern TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date) WHERE due_date IS NOT NULL;
`;

const TRIGGER_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_tasks_trigger ON tasks(trigger_type) WHERE trigger_type IS NOT NULL;
`;

function ensureTriggerColumns(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const existing = new Set(cols.map((c) => c.name));
  if (!existing.has('trigger_type')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN trigger_type TEXT`);
  }
  if (!existing.has('trigger_pattern')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN trigger_pattern TEXT`);
  }
}

export function createTaskStore(db: Database.Database): TaskStore {
  db.exec(DDL);
  ensureTriggerColumns(db);
  db.exec(TRIGGER_INDEX_DDL);

  const insert = db.prepare<TaskRecord>(`
    INSERT INTO tasks (id, title, notes, status, due_date, source_msg_id,
                       trigger_type, trigger_pattern, created_at, updated_at)
    VALUES (@id, @title, @notes, @status, @due_date, @source_msg_id,
            @trigger_type, @trigger_pattern, @created_at, @updated_at)
  `);
  const selectById = db.prepare<{ id: string }, TaskRecord>(`SELECT * FROM tasks WHERE id = @id`);
  const selectPending = db.prepare<{ cap: number }, TaskRecord>(
    `SELECT * FROM tasks WHERE status = 'pending' ORDER BY COALESCE(due_date, '9999') ASC LIMIT @cap`
  );
  const selectByStatus = db.prepare<{ status: string; cap: number }, TaskRecord>(
    `SELECT * FROM tasks WHERE status = @status ORDER BY updated_at DESC LIMIT @cap`
  );
  const selectEvents = db.prepare<{ cap: number }, TaskRecord>(
    `SELECT * FROM tasks
     WHERE status = 'pending' AND trigger_type = 'event'
     ORDER BY created_at DESC
     LIMIT @cap`
  );
  const del = db.prepare<{ id: string }>(`DELETE FROM tasks WHERE id = @id`);

  function create(rec: {
    title: string; notes?: string; due_date?: string; source_msg_id?: string;
    trigger_type?: TaskTriggerType; trigger_pattern?: string;
  }): TaskRecord {
    if (rec.trigger_type && !TASK_TRIGGER_TYPES.includes(rec.trigger_type)) {
      throw new Error(`invalid TaskTriggerType: ${rec.trigger_type}`);
    }
    const now = Date.now();
    const row: TaskRecord = {
      id: randomUUID(),
      title: rec.title,
      notes: rec.notes ?? null,
      status: 'pending',
      due_date: rec.due_date ?? null,
      source_msg_id: rec.source_msg_id ?? null,
      trigger_type: rec.trigger_type ?? null,
      trigger_pattern: rec.trigger_pattern ?? null,
      created_at: now,
      updated_at: now,
    };
    insert.run(row);
    return row;
  }

  function update(id: string, patch: {
    status?: TaskStatus;
    title?: string;
    notes?: string;
    due_date?: string | null;
    trigger_type?: TaskTriggerType | null;
    trigger_pattern?: string | null;
  }): { updated: boolean; task?: TaskRecord } {
    const current = selectById.get({ id });
    if (!current) return { updated: false };
    if (patch.status && !TASK_STATUSES.includes(patch.status)) {
      throw new Error(`invalid TaskStatus: ${patch.status}`);
    }
    if (patch.trigger_type && !TASK_TRIGGER_TYPES.includes(patch.trigger_type)) {
      throw new Error(`invalid TaskTriggerType: ${patch.trigger_type}`);
    }
    const next: TaskRecord = {
      ...current,
      status: patch.status ?? current.status,
      title: patch.title ?? current.title,
      notes: patch.notes !== undefined ? patch.notes : current.notes,
      due_date: patch.due_date !== undefined ? patch.due_date : current.due_date,
      trigger_type:
        patch.trigger_type !== undefined ? patch.trigger_type : current.trigger_type,
      trigger_pattern:
        patch.trigger_pattern !== undefined ? patch.trigger_pattern : current.trigger_pattern,
      updated_at: Date.now(),
    };
    db.prepare(`
      UPDATE tasks SET status = @status, title = @title, notes = @notes,
                       due_date = @due_date,
                       trigger_type = @trigger_type, trigger_pattern = @trigger_pattern,
                       updated_at = @updated_at
      WHERE id = @id
    `).run(next);
    return { updated: true, task: next };
  }

  function listPending(filter: { status?: TaskStatus; cap?: number }): TaskRecord[] {
    const cap = filter.cap ?? 50;
    if (filter.status) return selectByStatus.all({ status: filter.status, cap });
    return selectPending.all({ cap });
  }

  function listEventTasks(filter: { cap?: number }): TaskRecord[] {
    return selectEvents.all({ cap: filter.cap ?? 20 });
  }

  function listPage(opts: {
    status?: TaskStatus; trigger_type?: TaskTriggerType;
    dueDateFrom?: string; dueDateTo?: string;
    limit: number; offset: number;
  }): { rows: TaskRecord[]; total: number } {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (opts.status)       { clauses.push('status = ?');        params.push(opts.status); }
    if (opts.trigger_type) { clauses.push('trigger_type = ?');  params.push(opts.trigger_type); }
    if (opts.dueDateFrom)  { clauses.push('due_date >= ?');     params.push(opts.dueDateFrom); }
    if (opts.dueDateTo)    { clauses.push('due_date <= ?');     params.push(opts.dueDateTo); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM tasks ${where}`)
      .get(...params) as { n: number }).n;
    const rows = db.prepare(
      `SELECT * FROM tasks ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, opts.limit, opts.offset) as TaskRecord[];
    return { rows, total };
  }

  function countByStatus(): Record<TaskStatus, number> {
    const out: Record<TaskStatus, number> = { pending: 0, done: 0, cancelled: 0 };
    const rows = db.prepare(
      `SELECT status, COUNT(*) AS n FROM tasks GROUP BY status`,
    ).all() as Array<{ status: TaskStatus; n: number }>;
    for (const r of rows) if (r.status in out) out[r.status] = r.n;
    return out;
  }

  function get(id: string): TaskRecord | null { return selectById.get({ id }) ?? null; }

  function deleteOne(id: string): boolean { return del.run({ id }).changes > 0; }

  return { create, update, listPending, listEventTasks, listPage, countByStatus, get, delete: deleteOne };
}
