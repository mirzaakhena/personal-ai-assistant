// src/db/tasks.ts

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export const TASK_STATUSES = ['pending', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskRecord {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  due_date: string | null;
  source_msg_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface TaskStore {
  create(rec: {
    title: string;
    notes?: string;
    due_date?: string;
    source_msg_id?: string;
  }): TaskRecord;
  update(id: string, patch: {
    status?: TaskStatus;
    title?: string;
    notes?: string;
    due_date?: string | null;
  }): { updated: boolean; task?: TaskRecord };
  listPending(filter: { status?: TaskStatus; cap?: number }): TaskRecord[];
  get(id: string): TaskRecord | null;
  delete(id: string): boolean;
}

const DDL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    notes          TEXT,
    status         TEXT NOT NULL DEFAULT 'pending',
    due_date       TEXT,
    source_msg_id  TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date) WHERE due_date IS NOT NULL;
`;

export function createTaskStore(db: Database.Database): TaskStore {
  db.exec(DDL);

  const insert = db.prepare<TaskRecord>(`
    INSERT INTO tasks (id, title, notes, status, due_date, source_msg_id, created_at, updated_at)
    VALUES (@id, @title, @notes, @status, @due_date, @source_msg_id, @created_at, @updated_at)
  `);
  const selectById = db.prepare<{ id: string }, TaskRecord>(`SELECT * FROM tasks WHERE id = @id`);
  const selectPending = db.prepare<{ cap: number }, TaskRecord>(
    `SELECT * FROM tasks WHERE status = 'pending' ORDER BY COALESCE(due_date, '9999') ASC LIMIT @cap`
  );
  const selectByStatus = db.prepare<{ status: string; cap: number }, TaskRecord>(
    `SELECT * FROM tasks WHERE status = @status ORDER BY updated_at DESC LIMIT @cap`
  );
  const del = db.prepare<{ id: string }>(`DELETE FROM tasks WHERE id = @id`);

  function create(rec: {
    title: string; notes?: string; due_date?: string; source_msg_id?: string;
  }): TaskRecord {
    const now = Date.now();
    const row: TaskRecord = {
      id: randomUUID(),
      title: rec.title,
      notes: rec.notes ?? null,
      status: 'pending',
      due_date: rec.due_date ?? null,
      source_msg_id: rec.source_msg_id ?? null,
      created_at: now,
      updated_at: now,
    };
    insert.run(row);
    return row;
  }

  function update(id: string, patch: {
    status?: TaskStatus; title?: string; notes?: string; due_date?: string | null;
  }): { updated: boolean; task?: TaskRecord } {
    const current = selectById.get({ id });
    if (!current) return { updated: false };
    if (patch.status && !TASK_STATUSES.includes(patch.status)) {
      throw new Error(`invalid TaskStatus: ${patch.status}`);
    }
    const next: TaskRecord = {
      ...current,
      status: patch.status ?? current.status,
      title: patch.title ?? current.title,
      notes: patch.notes !== undefined ? patch.notes : current.notes,
      due_date: patch.due_date !== undefined ? patch.due_date : current.due_date,
      updated_at: Date.now(),
    };
    db.prepare(`
      UPDATE tasks SET status = @status, title = @title, notes = @notes,
                       due_date = @due_date, updated_at = @updated_at
      WHERE id = @id
    `).run(next);
    return { updated: true, task: next };
  }

  function listPending(filter: { status?: TaskStatus; cap?: number }): TaskRecord[] {
    const cap = filter.cap ?? 50;
    if (filter.status) return selectByStatus.all({ status: filter.status, cap });
    return selectPending.all({ cap });
  }

  function get(id: string): TaskRecord | null { return selectById.get({ id }) ?? null; }

  function deleteOne(id: string): boolean { return del.run({ id }).changes > 0; }

  return { create, update, listPending, get, delete: deleteOne };
}
