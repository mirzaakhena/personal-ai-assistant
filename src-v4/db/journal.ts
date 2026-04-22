// src-v4/db/journal.ts

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface JournalRow {
  id: string;
  content: string;
  event_date: string | null;
  source_msg_id: string | null;
  created_at: number;
}

export interface JournalStore {
  save(entry: { content: string; event_date?: string; source_msg_id?: string }): JournalRow;
  insertRaw(row: JournalRow): void;  // for migration script use
  listRecent(opts: { days?: number; limit?: number }): JournalRow[];
  count(): number;
  countSince(sinceMs: number): number;
}

const DDL = `
  CREATE TABLE IF NOT EXISTS journal (
    id             TEXT PRIMARY KEY,
    content        TEXT NOT NULL,
    event_date     TEXT,
    source_msg_id  TEXT,
    created_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_journal_created_at ON journal(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_journal_event_date ON journal(event_date) WHERE event_date IS NOT NULL;
`;

export function createJournalStore(db: Database.Database): JournalStore {
  db.exec(DDL);

  let lastTs = 0;

  const insert = db.prepare<JournalRow>(`
    INSERT INTO journal (id, content, event_date, source_msg_id, created_at)
    VALUES (@id, @content, @event_date, @source_msg_id, @created_at)
  `);
  const selectRecentDays = db.prepare<{ since: number; limit: number }, JournalRow>(`
    SELECT * FROM journal WHERE created_at >= @since
    ORDER BY created_at DESC LIMIT @limit
  `);
  const selectRecentAll = db.prepare<{ limit: number }, JournalRow>(`
    SELECT * FROM journal ORDER BY created_at DESC LIMIT @limit
  `);
  const selectCount = db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM journal`);
  const selectCountSince = db.prepare<{ since: number }, { n: number }>(
    `SELECT COUNT(*) AS n FROM journal WHERE created_at >= @since`
  );

  function save(entry: { content: string; event_date?: string; source_msg_id?: string }): JournalRow {
    const now = Date.now();
    lastTs = now > lastTs ? now : lastTs + 1;
    const row: JournalRow = {
      id: randomUUID(),
      content: entry.content,
      event_date: entry.event_date ?? null,
      source_msg_id: entry.source_msg_id ?? null,
      created_at: lastTs,
    };
    insert.run(row);
    return row;
  }

  function insertRaw(row: JournalRow): void {
    insert.run(row);
  }

  function listRecent(opts: { days?: number; limit?: number }): JournalRow[] {
    const limit = opts.limit ?? 20;
    if (opts.days !== undefined) {
      const since = Date.now() - opts.days * 24 * 60 * 60 * 1000;
      return selectRecentDays.all({ since, limit });
    }
    return selectRecentAll.all({ limit });
  }

  function count(): number {
    return selectCount.get()!.n;
  }
  function countSince(sinceMs: number): number {
    return selectCountSince.get({ since: sinceMs })!.n;
  }

  return { save, insertRaw, listRecent, count, countSince };
}
