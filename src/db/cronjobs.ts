// src/db/cronjobs.ts

import Database from 'better-sqlite3';

export type CronjobType = 'once' | 'recurring';

export type CronjobStatus =
  | 'PENDING'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'FAILED'
  | 'MISSED'
  | 'CANCELLED'
  | 'ACTIVE'
  | 'COMPLETED';

export type ExecutionStatus = 'EXECUTING' | 'EXECUTED' | 'FAILED' | 'MISSED';

export interface CronjobRecord {
  id: string;
  message: string;
  type: CronjobType;
  schedule_cron: string | null;
  schedule_human: string;
  scheduled_at: number | null;
  end_date: number | null;
  status: CronjobStatus;
  created_at: number;
  updated_at: number;
}

export interface ExecutionRecord {
  id: string;
  cronjob_id: string;
  scheduled_at: number;
  executed_at: number | null;
  status: ExecutionStatus;
  created_at: number;
}

export interface CronjobStore {
  insertJob(job: CronjobRecord): void;
  updateJobStatus(id: string, status: CronjobStatus): void;
  updateJobMessage(id: string, message: string): void;
  getJobById(id: string): CronjobRecord | undefined;
  getJobs(activeOnly?: boolean): CronjobRecord[];
  getPendingOnceJobs(): CronjobRecord[];
  getActiveRecurringJobs(): CronjobRecord[];
  insertExecution(exec: ExecutionRecord): void;
  updateExecutionStatus(id: string, status: ExecutionStatus, executedAt?: number): void;
  getLastExecutionForJob(cronjobId: string): ExecutionRecord | undefined;
}

const TERMINAL_STATUSES = ['CANCELLED', 'COMPLETED', 'EXECUTED', 'FAILED', 'MISSED'];

export function createCronjobStore(db: Database.Database): CronjobStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cronjobs (
      id            TEXT PRIMARY KEY,
      message       TEXT NOT NULL,
      type          TEXT NOT NULL,
      schedule_cron TEXT,
      schedule_human TEXT NOT NULL,
      scheduled_at  INTEGER,
      end_date      INTEGER,
      status        TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cronjob_executions (
      id           TEXT PRIMARY KEY,
      cronjob_id   TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      executed_at  INTEGER,
      status       TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      FOREIGN KEY (cronjob_id) REFERENCES cronjobs(id)
    );
  `);

  const stmtInsertJob = db.prepare(`
    INSERT INTO cronjobs (id, message, type, schedule_cron, schedule_human, scheduled_at, end_date, status, created_at, updated_at)
    VALUES (@id, @message, @type, @schedule_cron, @schedule_human, @scheduled_at, @end_date, @status, @created_at, @updated_at)
  `);

  const stmtUpdateJobStatus = db.prepare(`UPDATE cronjobs SET status = @status, updated_at = @updated_at WHERE id = @id`);
  const stmtUpdateJobMessage = db.prepare(`UPDATE cronjobs SET message = @message, updated_at = @updated_at WHERE id = @id`);
  const stmtGetJobById = db.prepare<[string], CronjobRecord>(`SELECT * FROM cronjobs WHERE id = ?`);
  const stmtGetAllJobs = db.prepare<[], CronjobRecord>(`SELECT * FROM cronjobs ORDER BY created_at DESC`);

  const placeholders = TERMINAL_STATUSES.map(() => '?').join(',');
  const stmtGetActiveJobs = db.prepare<string[], CronjobRecord>(
    `SELECT * FROM cronjobs WHERE status NOT IN (${placeholders}) ORDER BY created_at DESC`
  );

  const stmtGetPendingOnce = db.prepare<[], CronjobRecord>(`SELECT * FROM cronjobs WHERE type = 'once' AND status = 'PENDING'`);
  const stmtGetActiveRecurring = db.prepare<[], CronjobRecord>(`SELECT * FROM cronjobs WHERE type = 'recurring' AND status = 'ACTIVE'`);

  const stmtInsertExecution = db.prepare(`
    INSERT INTO cronjob_executions (id, cronjob_id, scheduled_at, executed_at, status, created_at)
    VALUES (@id, @cronjob_id, @scheduled_at, @executed_at, @status, @created_at)
  `);
  const stmtUpdateExecutionStatus = db.prepare(`
    UPDATE cronjob_executions SET status = @status, executed_at = @executed_at WHERE id = @id
  `);
  const stmtGetLastExecution = db.prepare<[string], ExecutionRecord>(`
    SELECT * FROM cronjob_executions WHERE cronjob_id = ? ORDER BY scheduled_at DESC LIMIT 1
  `);

  return {
    insertJob(job) { stmtInsertJob.run(job); },
    updateJobStatus(id, status) { stmtUpdateJobStatus.run({ id, status, updated_at: Date.now() }); },
    updateJobMessage(id, message) { stmtUpdateJobMessage.run({ id, message, updated_at: Date.now() }); },
    getJobById(id) { return stmtGetJobById.get(id); },
    getJobs(activeOnly = false) {
      if (activeOnly) return stmtGetActiveJobs.all(...TERMINAL_STATUSES);
      return stmtGetAllJobs.all();
    },
    getPendingOnceJobs() { return stmtGetPendingOnce.all(); },
    getActiveRecurringJobs() { return stmtGetActiveRecurring.all(); },
    insertExecution(exec) { stmtInsertExecution.run(exec); },
    updateExecutionStatus(id, status, executedAt) {
      stmtUpdateExecutionStatus.run({ id, status, executed_at: executedAt ?? null });
    },
    getLastExecutionForJob(cronjobId) { return stmtGetLastExecution.get(cronjobId); },
  };
}
