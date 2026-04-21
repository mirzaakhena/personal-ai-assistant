// src-v4/db/user-db.ts

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import {
  createMemoryStore, type MemoryStore,
  type ProfileRecord, type JournalRecord, type RelationshipRecord,
} from './memory.js';
import { createMessageStore, type MessageStore } from './message.js';
import { createSessionStore, type SessionStore } from './sessions.js';
import { createCronjobStore, type CronjobStore } from './cronjobs.js';
import { createTaskStore, type TaskStore, type TaskRecord } from './tasks.js';
import { createHabitStore, type HabitStore, type HabitStatusInfo } from './habits.js';
import { createQueryCostStore, type QueryCostStore } from './query-costs.js';
import { todayInJakartaYMD } from '../utils/time.js';

export interface AlwaysBundle {
  profile: ProfileRecord[];
  relationships: RelationshipRecord[];
  ongoing: JournalRecord[];
  recent: JournalRecord[];
  tasks: TaskRecord[];
  habits: HabitStatusInfo[];
}

export interface CoreIdentity {
  name?: string;
  current_location?: string;
  language?: string;
}

export interface ContextHintCounts {
  /** Journal rows with status='ongoing' */
  ongoing: number;
  /** Pending tasks (any due date) */
  tasks: number;
  /** Subset of `tasks` whose due_date === today (WIB) */
  tasks_due_today: number;
  /** All active habits */
  habits: number;
  /** Daily-period habits whose today's target is met (or boolean=done) */
  habits_today_done: number;
  /** Total count of daily-period habits (denominator for today_done) */
  habits_today_total: number;
  /** Max streak_periods across all active habits */
  habits_longest_streak: number;
  /** Total known relationships */
  relationships: number;
}

export interface UserDb {
  userId: string;
  memory: MemoryStore;
  messages: MessageStore;
  sessions: SessionStore;
  cronjobs: CronjobStore;
  tasks: TaskStore;
  habits: HabitStore;
  queryCosts: QueryCostStore;
  loadAlwaysBundle(): AlwaysBundle;
  close(): void;
}

export function createUserDb(userId: string, baseDir: string = 'data/users'): UserDb {
  const dir = join(baseDir, userId);
  mkdirSync(dir, { recursive: true });

  const dbPath = join(dir, 'app.db');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Order matters: messages before journal (FK)
  const messages = createMessageStore(db);
  const memory = createMemoryStore(db);
  const sessions = createSessionStore(db);
  const cronjobs = createCronjobStore(db);
  const tasks = createTaskStore(db);
  const habits = createHabitStore(db);
  const queryCosts = createQueryCostStore(db);

  function loadAlwaysBundle(): AlwaysBundle {
    // Profile composition:
    // - L3: always (uncapped — identity layer is small)
    // - L2 critical (importance='critical'): always (e.g., allergies)
    // - L2 normal (importance='normal' or NULL): top 15 by recency
    const l3 = memory.listProfile({ layer: 'L3' });
    const l2critical = memory.listProfile({ layer: 'L2', importance: 'critical' });
    const l2allNormal = memory.listProfile({ layer: 'L2' })
      .filter(p => p.importance === null || p.importance === 'normal')
      .sort((a, b) => b.last_updated - a.last_updated)
      .slice(0, 15);

    return {
      profile: [...l3, ...l2critical, ...l2allNormal],
      relationships: memory.listRelationshipsBundle({ recentDays: 7, recentCap: 5, totalCap: 10 }),
      ongoing: memory.listOngoing(),
      recent: memory.listRecentAnyStatus(5),
      tasks: tasks.listPending({ cap: 15 }),
      habits: habits.listActiveWithStatus({ cap: 10 }),
    };
  }

  return {
    userId,
    memory, messages, sessions, cronjobs, tasks, habits,
    queryCosts,
    loadAlwaysBundle,
    close: () => db.close(),
  };
}

/**
 * Read the three identity-layer profile entries needed for the wake-up briefing.
 * Returns only keys that exist in the profile — missing keys are undefined.
 *
 * Mapping:
 *   category="identity",   key="name"    → CoreIdentity.name
 *   category="location",   key="current" → CoreIdentity.current_location
 *   category="preference", key="language"→ CoreIdentity.language
 */
export function getCoreIdentity(userDb: UserDb): CoreIdentity {
  const identity: CoreIdentity = {};
  const l3 = userDb.memory.listProfile({ layer: 'L3' });
  for (const entry of l3) {
    if (entry.category === 'identity' && entry.key === 'name') {
      identity.name = entry.value;
    } else if (entry.category === 'location' && entry.key === 'current') {
      identity.current_location = entry.value;
    } else if (entry.category === 'preference' && entry.key === 'language') {
      identity.language = entry.value;
    }
  }
  return identity;
}

/**
 * Count active/ongoing records across the four domain areas for context_hints.
 * Also computes "today-scoped" summaries so the wake-up briefing can surface
 * tasks due today and today's habit progress without forcing a tool call.
 *
 * Uses existing list methods with high caps; data sizes are small (tens, not
 * thousands) so this stays fast without dedicated COUNT queries.
 */
export function getContextHintCounts(
  userDb: UserDb,
  now: Date = new Date()
): ContextHintCounts {
  const todayYMD = todayInJakartaYMD(now);
  const tasks = userDb.tasks.listPending({ cap: 1000 });
  const habits = userDb.habits.listActiveWithStatus({ cap: 1000 });

  const tasks_due_today = tasks.filter((t) => t.due_date === todayYMD).length;

  let habits_today_done = 0;
  let habits_today_total = 0;
  let habits_longest_streak = 0;
  for (const h of habits) {
    if (h.habit.cadence_config.period === 'day') {
      habits_today_total += 1;
      const target = h.target;
      const done = h.done_this_period;
      const satisfied = target === null ? done > 0 : done >= target;
      if (satisfied) habits_today_done += 1;
    }
    if (h.streak_periods > habits_longest_streak) {
      habits_longest_streak = h.streak_periods;
    }
  }

  return {
    ongoing: userDb.memory.listOngoing().length,
    tasks: tasks.length,
    tasks_due_today,
    habits: habits.length,
    habits_today_done,
    habits_today_total,
    habits_longest_streak,
    relationships: userDb.memory.listRelationshipsBundle({
      recentDays: 36500,
      recentCap: 1000,
      totalCap: 1000,
    }).length,
  };
}
