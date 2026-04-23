// src/db/user-db.ts

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { createProfileStore, type ProfileStore, type ProfileKey } from './profile.js';
import { createPreferenceStore, type PreferenceStore } from './preferences.js';
import { createKnowledgeStore, type KnowledgeStore, type KnowledgeCategory } from './knowledge.js';
import { createJournalStore, type JournalStore } from './journal.js';
import { createMessageStore, type MessageStore } from './message.js';
import { createSessionStore, type SessionStore } from './sessions.js';
import { createCronjobStore, type CronjobStore } from './cronjobs.js';
import { createTaskStore, type TaskStore } from './tasks.js';
import { createQueryCostStore, type QueryCostStore } from './query-costs.js';
import { todayInJakartaYMD } from '../utils/time.js';

export interface ContextHintCounts {
  tasks: number;
  tasks_due_today: number;
  journal_recent_7d: number;
  knowledge_total: number;
  knowledge_by_category: Record<KnowledgeCategory, number>;
}

export interface UserDb {
  userId: string;
  profile: ProfileStore;
  preferences: PreferenceStore;
  knowledge: KnowledgeStore;
  journal: JournalStore;
  messages: MessageStore;
  sessions: SessionStore;
  cronjobs: CronjobStore;
  tasks: TaskStore;
  queryCosts: QueryCostStore;
  close(): void;
}

export function createUserDb(userId: string, baseDir: string = 'data/users'): UserDb {
  const dir = join(baseDir, userId);
  mkdirSync(dir, { recursive: true });

  const dbPath = join(dir, 'app.db');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Order matters only for FK dependencies; all are independent here.
  const messages = createMessageStore(db);
  const profile = createProfileStore(db);
  const preferences = createPreferenceStore(db);
  const knowledge = createKnowledgeStore(db);
  const journal = createJournalStore(db);
  const sessions = createSessionStore(db);
  const cronjobs = createCronjobStore(db);
  const tasks = createTaskStore(db);
  const queryCosts = createQueryCostStore(db);

  return {
    userId,
    profile, preferences, knowledge, journal,
    messages, sessions, cronjobs, tasks, queryCosts,
    close: () => db.close(),
  };
}

/**
 * Return the flat profile object for wake-up rendering.
 * Missing slots are simply absent (undefined).
 */
export function getProfile(userDb: UserDb): Partial<Record<ProfileKey, string>> {
  return userDb.profile.getAll();
}

/**
 * Count active records across tasks, journal, knowledge for context_hints.
 * Journal uses "last 7d" since lifecycle is gone; knowledge shows total + per-category.
 */
export function getContextHintCounts(
  userDb: UserDb,
  now: Date = new Date()
): ContextHintCounts {
  const todayYMD = todayInJakartaYMD(now);
  const pendingTasks = userDb.tasks.listPending({ cap: 1000 });
  const tasks_due_today = pendingTasks.filter((t) => t.due_date === todayYMD).length;

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const journal_recent_7d = userDb.journal.countSince(Date.now() - sevenDaysMs);

  const allKnowledge = userDb.knowledge.list();
  const knowledge_by_category: Record<KnowledgeCategory, number> = {
    identity: 0, person: 0, routine: 0, context: 0, insight: 0,
  };
  for (const row of allKnowledge) knowledge_by_category[row.category] += 1;

  return {
    tasks: pendingTasks.length,
    tasks_due_today,
    journal_recent_7d,
    knowledge_total: allKnowledge.length,
    knowledge_by_category,
  };
}
