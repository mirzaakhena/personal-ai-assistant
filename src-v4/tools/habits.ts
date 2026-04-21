// src-v4/tools/habits.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  HabitStore, HabitRecord, HabitStatusInfo,
  CadenceType, HabitStatus, CadenceConfig,
} from '../db/habits.js';
import { toIsoJakarta } from '../utils/time.js';

export interface HabitResult {
  id: string;
  title: string;
  cadence_type: CadenceType;
  cadence_config: CadenceConfig;
  status: HabitStatus;
  notes: string | null;
  created_at: string;
  last_updated: string;
}

export interface HabitStatusResult {
  habit: HabitResult;
  done_this_period: number;
  target: number | null;
  progress_pct: number;
  streak_periods: number;
  last_completed_at: string | null;
}

export interface HabitCompletionResult {
  id: string;
  habit_id: string;
  slot: string | null;
  value: number | null;
  completed_at: string;
  period_key: string;
}

export interface HabitHandlers {
  saveHabit(rec: {
    title: string;
    cadence_type: CadenceType;
    cadence_config: CadenceConfig;
    notes?: string;
  }): HabitResult;
  updateHabit(id: string, patch: {
    title?: string;
    cadence_config?: CadenceConfig;
    status?: HabitStatus;
    notes?: string;
  }): { updated: boolean; habit?: HabitResult };
  logHabitCompletion(rec: { habit_id: string; slot?: string; value?: number }): HabitCompletionResult;
  listHabits(opts?: { status?: HabitStatus }): HabitStatusResult[];
  getHabitStatus(id: string): HabitStatusResult | null;
}

function sanitizeHabit(r: HabitRecord): HabitResult {
  return {
    id: r.id,
    title: r.title,
    cadence_type: r.cadence_type,
    cadence_config: r.cadence_config,
    status: r.status,
    notes: r.notes,
    created_at: toIsoJakarta(r.created_at),
    last_updated: toIsoJakarta(r.last_updated),
  };
}

function sanitizeStatus(s: HabitStatusInfo): HabitStatusResult {
  return {
    habit: sanitizeHabit(s.habit),
    done_this_period: s.done_this_period,
    target: s.target,
    progress_pct: s.progress_pct,
    streak_periods: s.streak_periods,
    last_completed_at: s.last_completed_at !== null ? toIsoJakarta(s.last_completed_at) : null,
  };
}

export function buildHabitHandlers(store: HabitStore): HabitHandlers {
  return {
    saveHabit(rec) {
      return sanitizeHabit(store.insert({
        title: rec.title,
        cadence_type: rec.cadence_type,
        cadence_config: rec.cadence_config,
        status: 'active',
        notes: rec.notes ?? null,
      }));
    },
    updateHabit(id, patch) {
      const updated = store.update(id, patch);
      return updated ? { updated: true, habit: sanitizeHabit(updated) } : { updated: false };
    },
    logHabitCompletion(rec) {
      const c = store.logCompletion(rec);
      return {
        id: c.id,
        habit_id: c.habit_id,
        slot: c.slot,
        value: c.value,
        completed_at: toIsoJakarta(c.completed_at),
        period_key: c.period_key,
      };
    },
    listHabits(opts) {
      return store.listActiveWithStatus({ cap: 100 }).map(sanitizeStatus)
        .filter(h => !opts?.status || h.habit.status === opts.status);
    },
    getHabitStatus(id) {
      const s = store.getStatus(id);
      return s ? sanitizeStatus(s) : null;
    },
  };
}

const cadenceTypeEnum = z.enum(['slot', 'count', 'quantity', 'boolean', 'duration']);
const habitStatusEnum = z.enum(['active', 'paused', 'archived']);
const periodEnum = z.enum(['day', 'week', 'month']);

const cadenceConfigSchema = z.object({
  period: periodEnum,
  slots: z.array(z.string()).optional(),
  target: z.number().optional(),
  unit: z.string().optional(),
});

function ok(payload: object): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, ...payload }) }] };
}
function fail(err: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: String(err) }) }] };
}
function listOk(results: object[]): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ count: results.length, results }) }] };
}

export function createHabitsServer(handlers: HabitHandlers) {
  const saveHabitTool = tool(
    "save_habit",
    `Create a new habit (recurring activity with completion tracking).

cadence_type guides what to track:
- 'slot': specific named slots per period (sholat 5 waktu)
- 'count': N occurrences per period (olahraga 3x/minggu)
- 'quantity': accumulated value per period (minum 2L air/hari)
- 'boolean': done-or-not per period (baca al-Quran tiap hari)
- 'duration': total minutes per period (coding 1 jam/hari)

cadence_config examples:
  slot:     {period:"day", slots:["subuh","dzuhur","ashar","maghrib","isya"]}
  count:    {period:"week", target:3}
  quantity: {period:"day", target:2000, unit:"ml"}
  boolean:  {period:"day"}
  duration: {period:"day", target:60, unit:"min"}

Examples:
  save_habit({ title: "Sholat 5 waktu", cadence_type: "slot", cadence_config: {period:"day", slots:["subuh","dzuhur","ashar","maghrib","isya"]} })
  save_habit({ title: "Olahraga 3x/minggu", cadence_type: "count", cadence_config: {period:"week", target:3} })`,
    {
      title: z.string().min(1),
      cadence_type: cadenceTypeEnum,
      cadence_config: cadenceConfigSchema,
      notes: z.string().optional(),
    },
    async (args) => {
      try { return ok(handlers.saveHabit(args)); } catch (err) { return fail(err); }
    }
  );

  const updateHabitTool = tool(
    "update_habit",
    `Modify habit title, config, status, or notes.
Use status='paused' to temporarily disable, status='archived' to remove from active list.

Examples:
  update_habit({ id: "uuid", status: "paused" })
  update_habit({ id: "uuid", cadence_config: {period:"week", target:5} })`,
    {
      id: z.string().min(1),
      title: z.string().optional(),
      cadence_config: cadenceConfigSchema.optional(),
      status: habitStatusEnum.optional(),
      notes: z.string().optional(),
    },
    async (args) => {
      try {
        const { id, ...patch } = args;
        return ok(handlers.updateHabit(id, patch));
      } catch (err) { return fail(err); }
    }
  );

  const logHabitCompletionTool = tool(
    "log_habit_completion",
    `Record a completion event for a habit.

For slot-based: pass slot name (e.g., "subuh").
For quantity/duration: pass value (e.g., 250 for 250ml, 30 for 30min).
For count/boolean: pass nothing extra (just habit_id).

Examples:
  log_habit_completion({ habit_id: "uuid", slot: "dzuhur" })       // sholat
  log_habit_completion({ habit_id: "uuid" })                        // olahraga or boolean
  log_habit_completion({ habit_id: "uuid", value: 250 })            // 250ml water
  log_habit_completion({ habit_id: "uuid", value: 30 })             // 30 min coding`,
    {
      habit_id: z.string().min(1),
      slot: z.string().optional(),
      value: z.number().optional(),
    },
    async (args) => {
      try { return ok(handlers.logHabitCompletion(args)); } catch (err) { return fail(err); }
    }
  );

  const listHabitsTool = tool(
    "list_habits",
    `List habits with current period progress.

Examples:
  list_habits() → all active habits with progress
  list_habits({ status: "paused" }) → only paused`,
    {
      status: habitStatusEnum.optional(),
    },
    async (args) => {
      try { return listOk(handlers.listHabits(args)); } catch (err) { return fail(err); }
    }
  );

  const getHabitStatusTool = tool(
    "get_habit_status",
    `Get detailed status (progress, streak) for one habit by ID.

Examples:
  get_habit_status({ id: "uuid" })`,
    {
      id: z.string().min(1),
    },
    async (args) => {
      try { return ok({ status: handlers.getHabitStatus(args.id) }); } catch (err) { return fail(err); }
    }
  );

  return createSdkMcpServer({
    name: "habits",
    version: "1.0.0",
    tools: [
      saveHabitTool, updateHabitTool, logHabitCompletionTool, listHabitsTool, getHabitStatusTool,
    ],
  });
}
