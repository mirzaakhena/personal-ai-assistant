// src/db/reactions.ts

import Database from 'better-sqlite3';

export type ReactionActor = 'user' | 'assistant';

export interface ReactionRecord {
  id: number;
  message_id: string;
  actor: ReactionActor;
  old_emojis: string[];
  new_emojis: string[];
  timestamp: number;
}

export interface ReactionStore {
  insert(record: Omit<ReactionRecord, 'id'>): number;
  listRecent(limit: number): ReactionRecord[];
  listByMessageId(messageId: string): ReactionRecord[];
  count(): number;
  listPage(opts: {
    actor?: 'user' | 'assistant';
    limit: number;
    offset: number;
  }): { rows: ReactionRecord[]; total: number };
}

interface RawRow {
  id: number;
  message_id: string;
  actor: string;
  old_emojis: string;
  new_emojis: string;
  timestamp: number;
}

const MAX_LIMIT = 100;

function parseEmojis(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

function rowToRecord(row: RawRow): ReactionRecord {
  return {
    id: row.id,
    message_id: row.message_id,
    actor: row.actor === 'assistant' ? 'assistant' : 'user',
    old_emojis: parseEmojis(row.old_emojis),
    new_emojis: parseEmojis(row.new_emojis),
    timestamp: row.timestamp,
  };
}

export function createReactionStore(db: Database.Database): ReactionStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id  TEXT NOT NULL,
      actor       TEXT NOT NULL,
      old_emojis  TEXT NOT NULL,
      new_emojis  TEXT NOT NULL,
      timestamp   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_reactions_timestamp ON reactions(timestamp);
  `);

  const stmtInsert = db.prepare(`
    INSERT INTO reactions (message_id, actor, old_emojis, new_emojis, timestamp)
    VALUES (@message_id, @actor, @old_emojis, @new_emojis, @timestamp)
  `);

  const stmtListRecent = db.prepare<[number], RawRow>(`
    SELECT * FROM reactions ORDER BY timestamp DESC LIMIT ?
  `);

  const stmtListByMessageId = db.prepare<[string], RawRow>(`
    SELECT * FROM reactions WHERE message_id = ? ORDER BY timestamp ASC
  `);

  function count(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM reactions').get() as { n: number }).n;
  }

  function listPage(opts: { actor?: 'user' | 'assistant'; limit: number; offset: number }) {
    const where = opts.actor ? 'WHERE actor = ?' : '';
    const params: Array<string | number> = opts.actor ? [opts.actor] : [];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM reactions ${where}`)
      .get(...params) as { n: number }).n;
    const rawRows = db.prepare(
      `SELECT * FROM reactions ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    ).all(...params, opts.limit, opts.offset) as RawRow[];
    return { rows: rawRows.map(rowToRecord), total };
  }

  return {
    insert(record) {
      const result = stmtInsert.run({
        message_id: record.message_id,
        actor: record.actor,
        old_emojis: JSON.stringify(record.old_emojis),
        new_emojis: JSON.stringify(record.new_emojis),
        timestamp: record.timestamp,
      });
      return Number(result.lastInsertRowid);
    },
    listRecent(limit) {
      const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
      return stmtListRecent.all(safeLimit).map(rowToRecord);
    },
    listByMessageId(messageId) {
      return stmtListByMessageId.all(messageId).map(rowToRecord);
    },
    count,
    listPage,
  };
}
