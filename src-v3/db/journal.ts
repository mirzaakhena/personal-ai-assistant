// src-v3/db/journal.ts

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export type Sender = 'user' | 'assistant' | 'system';

export interface MessageRecord {
  id: string;
  user_id: string;
  gateway: string;
  session_id: string | null;
  sender: Sender;
  timestamp: number;
  type: string;
  body: string | null;
  has_media: number;
  media_mimetype: string | null;
  media_filename: string | null;
  media_size: number | null;
  media_path: string | null;
  quoted_msg_id: string | null;
  is_forwarded: number;
  raw_json: string | null;
}

export interface SearchFilter {
  userId: string;
  fromTime?: number;
  toTime?: number;
  sender?: Sender;
  query?: string;
  gateway?: string;
  hasMedia?: boolean;
  limit?: number;
  order?: 'newest' | 'oldest';
}

export interface JournalStore {
  insert(record: MessageRecord): void;
  getById(id: string): MessageRecord | undefined;
  search(filter: SearchFilter): MessageRecord[];
  count(userId: string): number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function createJournalStore(dbPath: string = 'data/journal.db'): JournalStore {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      gateway         TEXT NOT NULL,
      session_id      TEXT,
      sender          TEXT NOT NULL,
      timestamp       INTEGER NOT NULL,
      type            TEXT NOT NULL,
      body            TEXT,
      has_media       INTEGER NOT NULL DEFAULT 0,
      media_mimetype  TEXT,
      media_filename  TEXT,
      media_size      INTEGER,
      media_path      TEXT,
      quoted_msg_id   TEXT,
      is_forwarded    INTEGER NOT NULL DEFAULT 0,
      raw_json        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_user_ts ON messages(user_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_user_sender ON messages(user_id, sender);
  `);

  const stmtInsert = db.prepare(`
    INSERT OR IGNORE INTO messages (
      id, user_id, gateway, session_id, sender, timestamp, type, body,
      has_media, media_mimetype, media_filename, media_size, media_path,
      quoted_msg_id, is_forwarded, raw_json
    ) VALUES (
      @id, @user_id, @gateway, @session_id, @sender, @timestamp, @type, @body,
      @has_media, @media_mimetype, @media_filename, @media_size, @media_path,
      @quoted_msg_id, @is_forwarded, @raw_json
    )
  `);

  const stmtGetById = db.prepare<[string], MessageRecord>(`
    SELECT * FROM messages WHERE id = ?
  `);

  const stmtCount = db.prepare<[string], { n: number }>(`
    SELECT COUNT(*) AS n FROM messages WHERE user_id = ?
  `);

  function buildSearchQuery(filter: SearchFilter): { sql: string; params: unknown[] } {
    const conditions: string[] = ['user_id = ?'];
    const params: unknown[] = [filter.userId];

    if (filter.fromTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filter.fromTime);
    }
    if (filter.toTime !== undefined) {
      conditions.push('timestamp < ?');
      params.push(filter.toTime);
    }
    if (filter.sender !== undefined) {
      conditions.push('sender = ?');
      params.push(filter.sender);
    }
    if (filter.query !== undefined && filter.query.length > 0) {
      // Case-insensitive search via LOWER() on both sides; handles Unicode better than default LIKE
      conditions.push("LOWER(body) LIKE LOWER('%' || ? || '%')");
      params.push(filter.query);
    }
    if (filter.gateway !== undefined) {
      conditions.push('gateway = ?');
      params.push(filter.gateway);
    }
    if (filter.hasMedia !== undefined) {
      conditions.push('has_media = ?');
      params.push(filter.hasMedia ? 1 : 0);
    }

    const direction = filter.order === 'oldest' ? 'ASC' : 'DESC';
    const rawLimit = filter.limit ?? DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)));

    const sql = `
      SELECT * FROM messages
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp ${direction}
      LIMIT ${limit}
    `;
    return { sql, params };
  }

  return {
    insert(record) {
      stmtInsert.run(record);
    },
    getById(id) {
      return stmtGetById.get(id);
    },
    search(filter) {
      const { sql, params } = buildSearchQuery(filter);
      const stmt = db.prepare<unknown[], MessageRecord>(sql);
      return stmt.all(...params);
    },
    count(userId) {
      const row = stmtCount.get(userId);
      return row?.n ?? 0;
    },
  };
}
