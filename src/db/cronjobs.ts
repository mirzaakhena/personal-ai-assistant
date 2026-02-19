import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';

mkdirSync('data', { recursive: true });

const db = new Database('data/cronjobs.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS cronjobs (
    id            TEXT PRIMARY KEY,
    phone_number  TEXT NOT NULL,
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

export interface Cronjob {
  id: string;
  phone_number: string;
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

export interface CronjobExecution {
  id: string;
  cronjob_id: string;
  scheduled_at: number;
  executed_at: number | null;
  status: ExecutionStatus;
  created_at: number;
}

const stmtInsertCronjob = db.prepare(`
  INSERT INTO cronjobs (id, phone_number, message, type, schedule_cron, schedule_human, scheduled_at, end_date, status, created_at, updated_at)
  VALUES (@id, @phone_number, @message, @type, @schedule_cron, @schedule_human, @scheduled_at, @end_date, @status, @created_at, @updated_at)
`);

const stmtUpdateCronjobStatus = db.prepare(`
  UPDATE cronjobs SET status = @status, updated_at = @updated_at WHERE id = @id
`);

const stmtGetCronjobById = db.prepare<[string], Cronjob>(`
  SELECT * FROM cronjobs WHERE id = ?
`);

const stmtGetCronjobsByPhone = db.prepare<[string], Cronjob>(`
  SELECT * FROM cronjobs WHERE phone_number = ? ORDER BY created_at DESC
`);

const stmtGetCronjobsByPhoneActive = db.prepare<[string], Cronjob>(`
  SELECT * FROM cronjobs WHERE phone_number = ? AND status NOT IN ('CANCELLED', 'COMPLETED', 'EXECUTED', 'FAILED', 'MISSED') ORDER BY created_at DESC
`);

const stmtGetPendingOnceCronjobs = db.prepare<[], Cronjob>(`
  SELECT * FROM cronjobs WHERE type = 'once' AND status = 'PENDING'
`);

const stmtGetActiveRecurringCronjobs = db.prepare<[], Cronjob>(`
  SELECT * FROM cronjobs WHERE type = 'recurring' AND status = 'ACTIVE'
`);

const stmtInsertExecution = db.prepare(`
  INSERT INTO cronjob_executions (id, cronjob_id, scheduled_at, executed_at, status, created_at)
  VALUES (@id, @cronjob_id, @scheduled_at, @executed_at, @status, @created_at)
`);

const stmtUpdateExecutionStatus = db.prepare(`
  UPDATE cronjob_executions SET status = @status, executed_at = @executed_at WHERE id = @id
`);

const stmtGetLastExecutionForJob = db.prepare<[string], CronjobExecution>(`
  SELECT * FROM cronjob_executions WHERE cronjob_id = ? ORDER BY scheduled_at DESC LIMIT 1
`);

export function insertCronjob(job: Cronjob): void {
  stmtInsertCronjob.run(job);
}

export function updateCronjobStatus(id: string, status: CronjobStatus): void {
  stmtUpdateCronjobStatus.run({ id, status, updated_at: Date.now() });
}

export function getCronjobById(id: string): Cronjob | undefined {
  return stmtGetCronjobById.get(id);
}

export function getCronjobsByPhone(phoneNumber: string, activeOnly = false): Cronjob[] {
  if (activeOnly) return stmtGetCronjobsByPhoneActive.all(phoneNumber);
  return stmtGetCronjobsByPhone.all(phoneNumber);
}

export function getPendingOnceCronjobs(): Cronjob[] {
  return stmtGetPendingOnceCronjobs.all();
}

export function getActiveRecurringCronjobs(): Cronjob[] {
  return stmtGetActiveRecurringCronjobs.all();
}

export function insertExecution(exec: CronjobExecution): void {
  stmtInsertExecution.run(exec);
}

export function updateExecutionStatus(id: string, status: ExecutionStatus, executed_at?: number): void {
  stmtUpdateExecutionStatus.run({ id, status, executed_at: executed_at ?? null });
}

export function getLastExecutionForJob(cronjobId: string): CronjobExecution | undefined {
  return stmtGetLastExecutionForJob.get(cronjobId);
}
