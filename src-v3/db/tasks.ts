// src-v3/db/tasks.ts

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export type TaskType = 'errand' | 'grocery' | 'routine_item' | 'generic';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'high' | 'medium' | 'low' | null;

export interface TaskRecord {
  id: string;
  type: TaskType;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  trigger_keywords: string[] | null;
  due_date: string | null;
  related_ids: string[] | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface TaskListFilter {
  status?: TaskStatus;
  type?: TaskType;
  priority?: TaskPriority;
  dueBefore?: string;
  cap?: number;
  order?: 'priority' | 'recency' | 'due';
}

export interface TaskSearchFilter {
  query?: string;
  status?: TaskStatus;
  cap?: number;
}

export interface TaskStore {
  insert(rec: Omit<TaskRecord, 'id' | 'created_at' | 'updated_at' | 'completed_at'>): TaskRecord;
  getById(id: string): TaskRecord | undefined;
  update(id: string, patch: Partial<Omit<TaskRecord, 'id' | 'created_at'>>): TaskRecord | undefined;
  list(filter?: TaskListFilter): TaskRecord[];
  search(filter: TaskSearchFilter): TaskRecord[];
  listPending(opts?: { cap?: number }): TaskRecord[];
  delete(id: string): boolean;
}

const DEFAULT_CAP = 20;
const MAX_CAP = 100;

type TaskRow = Omit<TaskRecord, 'trigger_keywords' | 'related_ids'> & {
  trigger_keywords: string | null;
  related_ids: string | null;
};

function toJsonArray(v: string[] | null | undefined): string | null {
  if (!v || v.length === 0) return null;
  return JSON.stringify(v);
}
function fromJsonArray(v: string | null | undefined): string[] | null {
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
function rowToRecord(r: TaskRow): TaskRecord {
  return {
    ...r,
    trigger_keywords: fromJsonArray(r.trigger_keywords),
    related_ids: fromJsonArray(r.related_ids),
  };
}

export function createTaskStore(db: Database.Database): TaskStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id                TEXT PRIMARY KEY,
      type              TEXT NOT NULL,
      title             TEXT NOT NULL,
      notes             TEXT,
      status            TEXT NOT NULL DEFAULT 'pending',
      priority          TEXT,
      trigger_keywords  TEXT,
      due_date          TEXT,
      related_ids       TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      completed_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);

    CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
      title, notes, trigger_keywords,
      content='tasks', content_rowid='rowid', tokenize='unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON tasks BEGIN
      INSERT INTO tasks_fts(rowid, title, notes, trigger_keywords)
      VALUES (new.rowid, new.title, new.notes, new.trigger_keywords);
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON tasks BEGIN
      INSERT INTO tasks_fts(tasks_fts, rowid, title, notes, trigger_keywords)
      VALUES('delete', old.rowid, old.title, old.notes, old.trigger_keywords);
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE ON tasks BEGIN
      INSERT INTO tasks_fts(tasks_fts, rowid, title, notes, trigger_keywords)
      VALUES('delete', old.rowid, old.title, old.notes, old.trigger_keywords);
      INSERT INTO tasks_fts(rowid, title, notes, trigger_keywords)
      VALUES (new.rowid, new.title, new.notes, new.trigger_keywords);
    END;
  `);

  // Auto-populate FTS5 on first run if table has rows but FTS index is empty
  const fCounts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tasks) AS m,
      (SELECT COUNT(*) FROM tasks_fts_docsize) AS d
  `).get() as { m: number; d: number };
  if (fCounts.m > 0 && fCounts.d === 0) {
    db.exec(`INSERT INTO tasks_fts(tasks_fts) VALUES('rebuild')`);
  }

  const stmtInsert = db.prepare(`
    INSERT INTO tasks (id, type, title, notes, status, priority, trigger_keywords, due_date, related_ids, created_at, updated_at, completed_at)
    VALUES (@id, @type, @title, @notes, @status, @priority, @trigger_keywords, @due_date, @related_ids, @created_at, @updated_at, @completed_at)
  `);
  const stmtGetById = db.prepare<[string], TaskRow>(`SELECT * FROM tasks WHERE id = ?`);
  const stmtDelete = db.prepare(`DELETE FROM tasks WHERE id = ?`);

  function nowMs(): number { return Date.now(); }

  return {
    insert(rec) {
      const id = uuidv4();
      const now = nowMs();
      const full: TaskRecord = {
        ...rec,
        id,
        created_at: now,
        updated_at: now,
        completed_at: null,
      };
      const row = {
        ...full,
        trigger_keywords: toJsonArray(full.trigger_keywords),
        related_ids: toJsonArray(full.related_ids),
      };
      stmtInsert.run(row);
      return full;
    },

    getById(id) {
      const row = stmtGetById.get(id);
      return row ? rowToRecord(row) : undefined;
    },

    update(id, patch) {
      const existing = stmtGetById.get(id);
      if (!existing) return undefined;

      const fields: string[] = [];
      const params: Record<string, unknown> = { id };
      const now = nowMs();

      if (patch.type !== undefined) { fields.push('type = @type'); params.type = patch.type; }
      if (patch.title !== undefined) { fields.push('title = @title'); params.title = patch.title; }
      if (patch.notes !== undefined) { fields.push('notes = @notes'); params.notes = patch.notes; }
      if (patch.status !== undefined) {
        fields.push('status = @status');
        params.status = patch.status;
        if ((patch.status === 'done' || patch.status === 'cancelled') && !existing.completed_at) {
          fields.push('completed_at = @completed_at');
          params.completed_at = now;
        }
      }
      if (patch.priority !== undefined) { fields.push('priority = @priority'); params.priority = patch.priority; }
      if (patch.trigger_keywords !== undefined) {
        fields.push('trigger_keywords = @trigger_keywords');
        params.trigger_keywords = toJsonArray(patch.trigger_keywords);
      }
      if (patch.due_date !== undefined) { fields.push('due_date = @due_date'); params.due_date = patch.due_date; }
      if (patch.related_ids !== undefined) {
        fields.push('related_ids = @related_ids');
        params.related_ids = toJsonArray(patch.related_ids);
      }
      if (patch.completed_at !== undefined) {
        fields.push('completed_at = @completed_at');
        params.completed_at = patch.completed_at;
      }

      fields.push('updated_at = @updated_at');
      params.updated_at = now;

      if (fields.length === 1) return rowToRecord(existing);

      const sql = `UPDATE tasks SET ${fields.join(', ')} WHERE id = @id`;
      db.prepare(sql).run(params);
      return rowToRecord(stmtGetById.get(id)!);
    },

    list(filter) {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filter?.status) { conditions.push('status = ?'); params.push(filter.status); }
      if (filter?.type) { conditions.push('type = ?'); params.push(filter.type); }
      if (filter?.priority !== undefined) {
        if (filter.priority === null) {
          conditions.push('priority IS NULL');
        } else {
          conditions.push('priority = ?');
          params.push(filter.priority);
        }
      }
      if (filter?.dueBefore) { conditions.push('due_date < ?'); params.push(filter.dueBefore); }

      const order = filter?.order ?? 'recency';
      let orderClause: string;
      if (order === 'priority') {
        orderClause = `ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, created_at DESC`;
      } else if (order === 'due') {
        orderClause = `ORDER BY due_date ASC NULLS LAST, created_at DESC`;
      } else {
        orderClause = `ORDER BY created_at DESC`;
      }

      const rawCap = filter?.cap ?? DEFAULT_CAP;
      const cap = Math.max(1, Math.min(MAX_CAP, Math.floor(rawCap)));
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `SELECT * FROM tasks ${whereClause} ${orderClause} LIMIT ${cap}`;
      const stmt = db.prepare<unknown[], TaskRow>(sql);
      return stmt.all(...params).map(rowToRecord);
    },

    search(filter) {
      if (!filter.query || filter.query.length === 0) {
        return this.list({ status: filter.status, cap: filter.cap });
      }
      const rawCap = filter.cap ?? DEFAULT_CAP;
      const cap = Math.max(1, Math.min(MAX_CAP, Math.floor(rawCap)));

      if (filter.status) {
        const sql = `
          SELECT t.* FROM tasks t
          JOIN tasks_fts fts ON t.rowid = fts.rowid
          WHERE tasks_fts MATCH ? AND t.status = ?
          ORDER BY rank
          LIMIT ${cap}
        `;
        const stmt = db.prepare<unknown[], TaskRow>(sql);
        return stmt.all(filter.query, filter.status).map(rowToRecord);
      }

      const sql = `
        SELECT t.* FROM tasks t
        JOIN tasks_fts fts ON t.rowid = fts.rowid
        WHERE tasks_fts MATCH ?
        ORDER BY rank
        LIMIT ${cap}
      `;
      const stmt = db.prepare<unknown[], TaskRow>(sql);
      return stmt.all(filter.query).map(rowToRecord);
    },

    listPending(opts) {
      return this.list({ status: 'pending', order: 'priority', cap: opts?.cap ?? 15 });
    },

    delete(id) {
      const res = stmtDelete.run(id);
      return res.changes > 0;
    },
  };
}
