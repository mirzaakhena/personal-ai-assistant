// src-v4/db/habits.ts

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export type CadenceType = 'slot' | 'count' | 'quantity' | 'boolean' | 'duration';
export type HabitStatus = 'active' | 'paused' | 'archived';
export type Period = 'day' | 'week' | 'month';

export interface CadenceConfig {
  period: Period;
  slots?: string[];
  target?: number;
  unit?: string;
}

export interface HabitRecord {
  id: string;
  title: string;
  cadence_type: CadenceType;
  cadence_config: CadenceConfig;
  status: HabitStatus;
  notes: string | null;
  created_at: number;
  last_updated: number;
}

export interface HabitCompletionRecord {
  id: string;
  habit_id: string;
  slot: string | null;
  value: number | null;
  completed_at: number;
  period_key: string;
}

export interface HabitStatusInfo {
  habit: HabitRecord;
  done_this_period: number;
  target: number | null;
  progress_pct: number;
  streak_periods: number;
  last_completed_at: number | null;
}

export interface HabitStore {
  insert(rec: Omit<HabitRecord, 'id' | 'created_at' | 'last_updated'>): HabitRecord;
  getById(id: string): HabitRecord | undefined;
  update(id: string, patch: Partial<Pick<HabitRecord, 'title' | 'cadence_config' | 'status' | 'notes'>>): HabitRecord | undefined;
  list(opts?: { status?: HabitStatus }): HabitRecord[];
  logCompletion(rec: { habit_id: string; slot?: string; value?: number }): HabitCompletionRecord;
  getStatus(habitId: string): HabitStatusInfo | undefined;
  listActiveWithStatus(opts?: { cap?: number }): HabitStatusInfo[];
}

type HabitRow = Omit<HabitRecord, 'cadence_config'> & { cadence_config: string };

function rowToHabit(r: HabitRow): HabitRecord {
  return { ...r, cadence_config: JSON.parse(r.cadence_config) as CadenceConfig };
}

/** Build period_key from a Date and Period type, in WIB (UTC+7). */
function periodKeyFromDate(date: Date, period: Period): string {
  const ms = date.getTime() + 7 * 60 * 60 * 1000;
  const j = new Date(ms);
  const y = j.getUTCFullYear();
  const m = String(j.getUTCMonth() + 1).padStart(2, '0');
  const d = String(j.getUTCDate()).padStart(2, '0');
  if (period === 'day') return `${y}-${m}-${d}`;
  if (period === 'month') return `${y}-${m}`;
  // week: ISO week number
  const dayMs = 86400000;
  const tmp = new Date(Date.UTC(y, j.getUTCMonth(), j.getUTCDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7;
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((tmp.getTime() - firstThu.getTime()) / dayMs - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function previousPeriodKey(currentKey: string, period: Period): string {
  if (period === 'day') {
    const [y, m, d] = currentKey.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d - 1));
    return periodKeyFromDate(new Date(date.getTime() - 7 * 60 * 60 * 1000), 'day');
  }
  if (period === 'month') {
    const [y, m] = currentKey.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 2, 1));
    return periodKeyFromDate(new Date(date.getTime() - 7 * 60 * 60 * 1000), 'month');
  }
  const [yStr, wStr] = currentKey.split('-W');
  const y = Number(yStr);
  const w = Number(wStr);
  const prevW = w - 1;
  if (prevW >= 1) return `${y}-W${String(prevW).padStart(2, '0')}`;
  return `${y - 1}-W52`;
}

export function createHabitStore(db: Database.Database): HabitStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS habits (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL,
      cadence_type   TEXT NOT NULL,
      cadence_config TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'active',
      notes          TEXT,
      created_at     INTEGER NOT NULL,
      last_updated   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_habits_status ON habits(status);

    CREATE TABLE IF NOT EXISTS habit_completions (
      id           TEXT PRIMARY KEY,
      habit_id     TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      slot         TEXT,
      value        REAL,
      completed_at INTEGER NOT NULL,
      period_key   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_completions_habit_period ON habit_completions(habit_id, period_key);
    CREATE INDEX IF NOT EXISTS idx_completions_habit_date ON habit_completions(habit_id, completed_at);
  `);

  const stmtInsertHabit = db.prepare(`
    INSERT INTO habits (id, title, cadence_type, cadence_config, status, notes, created_at, last_updated)
    VALUES (@id, @title, @cadence_type, @cadence_config, @status, @notes, @created_at, @last_updated)
  `);
  const stmtGetHabit = db.prepare<[string], HabitRow>(`SELECT * FROM habits WHERE id = ?`);
  const stmtListAll = db.prepare<[], HabitRow>(`SELECT * FROM habits ORDER BY created_at DESC`);
  const stmtListByStatus = db.prepare<[HabitStatus], HabitRow>(`SELECT * FROM habits WHERE status = ? ORDER BY created_at DESC`);

  const stmtInsertCompletion = db.prepare(`
    INSERT INTO habit_completions (id, habit_id, slot, value, completed_at, period_key)
    VALUES (@id, @habit_id, @slot, @value, @completed_at, @period_key)
  `);

  function nowMs(): number { return Date.now(); }

  function insert(rec: Omit<HabitRecord, 'id' | 'created_at' | 'last_updated'>): HabitRecord {
    const id = uuidv4();
    const now = nowMs();
    const full: HabitRecord = { ...rec, id, created_at: now, last_updated: now };
    stmtInsertHabit.run({
      ...full,
      cadence_config: JSON.stringify(full.cadence_config),
    });
    return full;
  }

  function getById(id: string): HabitRecord | undefined {
    const row = stmtGetHabit.get(id);
    return row ? rowToHabit(row) : undefined;
  }

  function update(id: string, patch: Partial<Pick<HabitRecord, 'title' | 'cadence_config' | 'status' | 'notes'>>): HabitRecord | undefined {
    const existing = stmtGetHabit.get(id);
    if (!existing) return undefined;

    const fields: string[] = [];
    const params: Record<string, unknown> = { id };
    const now = nowMs();

    if (patch.title !== undefined) { fields.push('title = @title'); params.title = patch.title; }
    if (patch.cadence_config !== undefined) {
      fields.push('cadence_config = @cadence_config');
      params.cadence_config = JSON.stringify(patch.cadence_config);
    }
    if (patch.status !== undefined) { fields.push('status = @status'); params.status = patch.status; }
    if (patch.notes !== undefined) { fields.push('notes = @notes'); params.notes = patch.notes; }

    fields.push('last_updated = @last_updated');
    params.last_updated = now;

    if (fields.length === 1) return rowToHabit(existing);

    const sql = `UPDATE habits SET ${fields.join(', ')} WHERE id = @id`;
    db.prepare(sql).run(params);
    return rowToHabit(stmtGetHabit.get(id)!);
  }

  function list(opts?: { status?: HabitStatus }): HabitRecord[] {
    const rows = opts?.status ? stmtListByStatus.all(opts.status) : stmtListAll.all();
    return rows.map(rowToHabit);
  }

  function logCompletion(rec: { habit_id: string; slot?: string; value?: number }): HabitCompletionRecord {
    const habit = getById(rec.habit_id);
    if (!habit) throw new Error(`Habit ${rec.habit_id} not found`);

    const completed_at = nowMs();
    const period_key = periodKeyFromDate(new Date(completed_at), habit.cadence_config.period);

    const completion: HabitCompletionRecord = {
      id: uuidv4(),
      habit_id: rec.habit_id,
      slot: rec.slot ?? null,
      value: rec.value ?? null,
      completed_at,
      period_key,
    };
    stmtInsertCompletion.run(completion);
    return completion;
  }

  function getStatus(habitId: string): HabitStatusInfo | undefined {
    const habit = getById(habitId);
    if (!habit) return undefined;

    const config = habit.cadence_config;
    const period = config.period;
    const currentKey = periodKeyFromDate(new Date(), period);

    let done_this_period = 0;
    let target: number | null = null;

    if (habit.cadence_type === 'slot') {
      target = config.slots?.length ?? 0;
      const row = db.prepare<[string, string], { c: number }>(
        `SELECT COUNT(DISTINCT slot) AS c FROM habit_completions WHERE habit_id = ? AND period_key = ?`
      ).get(habitId, currentKey);
      done_this_period = row?.c ?? 0;
    } else if (habit.cadence_type === 'count') {
      target = config.target ?? null;
      const row = db.prepare<[string, string], { c: number }>(
        `SELECT COUNT(*) AS c FROM habit_completions WHERE habit_id = ? AND period_key = ?`
      ).get(habitId, currentKey);
      done_this_period = row?.c ?? 0;
    } else if (habit.cadence_type === 'quantity' || habit.cadence_type === 'duration') {
      target = config.target ?? null;
      const row = db.prepare<[string, string], { s: number | null }>(
        `SELECT SUM(value) AS s FROM habit_completions WHERE habit_id = ? AND period_key = ?`
      ).get(habitId, currentKey);
      done_this_period = row?.s ?? 0;
    } else if (habit.cadence_type === 'boolean') {
      target = null;
      const row = db.prepare<[string, string], { c: number }>(
        `SELECT COUNT(*) AS c FROM habit_completions WHERE habit_id = ? AND period_key = ?`
      ).get(habitId, currentKey);
      done_this_period = (row?.c ?? 0) > 0 ? 1 : 0;
    }

    const progress_pct = target && target > 0
      ? Math.min(100, Math.round((done_this_period / target) * 100))
      : (habit.cadence_type === 'boolean' ? done_this_period * 100 : 0);

    const habitNonNull = habit;
    function periodSatisfied(periodKey: string): boolean {
      if (habitNonNull.cadence_type === 'slot') {
        const row = db.prepare<[string, string], { c: number }>(
          `SELECT COUNT(DISTINCT slot) AS c FROM habit_completions WHERE habit_id = ? AND period_key = ?`
        ).get(habitId, periodKey);
        return (row?.c ?? 0) >= (config.slots?.length ?? 0);
      }
      if (habitNonNull.cadence_type === 'count') {
        const row = db.prepare<[string, string], { c: number }>(
          `SELECT COUNT(*) AS c FROM habit_completions WHERE habit_id = ? AND period_key = ?`
        ).get(habitId, periodKey);
        return (row?.c ?? 0) >= (config.target ?? 1);
      }
      if (habitNonNull.cadence_type === 'quantity' || habitNonNull.cadence_type === 'duration') {
        const row = db.prepare<[string, string], { s: number | null }>(
          `SELECT SUM(value) AS s FROM habit_completions WHERE habit_id = ? AND period_key = ?`
        ).get(habitId, periodKey);
        return (row?.s ?? 0) >= (config.target ?? 1);
      }
      if (habitNonNull.cadence_type === 'boolean') {
        const row = db.prepare<[string, string], { c: number }>(
          `SELECT COUNT(*) AS c FROM habit_completions WHERE habit_id = ? AND period_key = ?`
        ).get(habitId, periodKey);
        return (row?.c ?? 0) > 0;
      }
      return false;
    }

    let streak_periods = 0;
    let cursor = previousPeriodKey(currentKey, period);
    const MAX_STREAK_LOOKBACK = 365;
    for (let i = 0; i < MAX_STREAK_LOOKBACK; i++) {
      if (periodSatisfied(cursor)) {
        streak_periods++;
        cursor = previousPeriodKey(cursor, period);
      } else {
        break;
      }
    }

    const lastRow = db.prepare<[string], { ts: number }>(
      `SELECT MAX(completed_at) AS ts FROM habit_completions WHERE habit_id = ?`
    ).get(habitId);

    return {
      habit,
      done_this_period,
      target,
      progress_pct,
      streak_periods,
      last_completed_at: lastRow?.ts ?? null,
    };
  }

  function listActiveWithStatus(opts?: { cap?: number }): HabitStatusInfo[] {
    const cap = opts?.cap ?? 10;
    const habits = list({ status: 'active' }).slice(0, cap);
    return habits
      .map(h => getStatus(h.id))
      .filter((s): s is HabitStatusInfo => s !== undefined);
  }

  return {
    insert, getById, update, list,
    logCompletion, getStatus, listActiveWithStatus,
  };
}
