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
  ongoing: number;
  tasks: number;
  habits: number;
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
 * Uses existing list methods with high caps; data sizes are small (tens, not
 * thousands) so this stays fast without dedicated COUNT queries.
 */
export function getContextHintCounts(userDb: UserDb): ContextHintCounts {
  return {
    ongoing: userDb.memory.listOngoing().length,
    tasks: userDb.tasks.listPending({ cap: 1000 }).length,
    habits: userDb.habits.listActiveWithStatus({ cap: 1000 }).length,
    relationships: userDb.memory.listRelationshipsBundle({
      recentDays: 36500, recentCap: 1000, totalCap: 1000
    }).length,
  };
}
