// src-v3/db/user-db.ts

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
import { createPopulateRunsStore, type PopulateRunsStore } from './populate-runs.js';

export interface AlwaysBundle {
  profile: ProfileRecord[];
  relationships: RelationshipRecord[];
  ongoing: JournalRecord[];
  recent: JournalRecord[];
  tasks: TaskRecord[];
  habits: HabitStatusInfo[];
}

export interface UserDb {
  userId: string;
  memory: MemoryStore;
  messages: MessageStore;
  sessions: SessionStore;
  cronjobs: CronjobStore;
  tasks: TaskStore;
  habits: HabitStore;
  populateRuns: PopulateRunsStore;
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
  const populateRuns = createPopulateRunsStore(db);

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
    populateRuns,
    loadAlwaysBundle,
    close: () => db.close(),
  };
}
