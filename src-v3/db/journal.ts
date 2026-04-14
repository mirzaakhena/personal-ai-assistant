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
  order?: 'newest' | 'oldest' | 'relevant';
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

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      body,
      content='messages',
      content_rowid='rowid',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
      INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
    END;
  `);

  // One-time populate FTS5 from existing messages (first run after FTS5 upgrade)
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM messages WHERE body IS NOT NULL) AS m,
      (SELECT COUNT(*) FROM messages_fts) AS f
  `).get() as { m: number; f: number };

  if (counts.m > 0 && counts.f === 0) {
    db.exec(`
      INSERT INTO messages_fts(rowid, body)
      SELECT rowid, body FROM messages WHERE body IS NOT NULL
    `);
  }

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
    const conditions: string[] = ['m.user_id = ?'];
    const params: unknown[] = [filter.userId];
    let joinFts = false;

    if (filter.fromTime !== undefined) {
      conditions.push('m.timestamp >= ?');
      params.push(filter.fromTime);
    }
    if (filter.toTime !== undefined) {
      conditions.push('m.timestamp < ?');
      params.push(filter.toTime);
    }
    if (filter.sender !== undefined) {
      conditions.push('m.sender = ?');
      params.push(filter.sender);
    }

    const hasQuery = filter.query !== undefined && filter.query.length > 0;
    if (hasQuery) {
      joinFts = true;
      conditions.push('fts.body MATCH ?');
      params.push(filter.query);
    }

    if (filter.gateway !== undefined) {
      conditions.push('m.gateway = ?');
      params.push(filter.gateway);
    }
    if (filter.hasMedia !== undefined) {
      conditions.push('m.has_media = ?');
      params.push(filter.hasMedia ? 1 : 0);
    }

    // Smart default: BM25 relevance when query is present, else newest first
    const defaultOrder: 'newest' | 'oldest' | 'relevant' = hasQuery ? 'relevant' : 'newest';
    const order = filter.order ?? defaultOrder;

    let orderClause: string;
    if (order === 'relevant' && joinFts) {
      orderClause = 'ORDER BY rank';
    } else if (order === 'oldest') {
      orderClause = 'ORDER BY m.timestamp ASC';
    } else {
      orderClause = 'ORDER BY m.timestamp DESC';
    }

    const rawLimit = filter.limit ?? DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)));

    const fromClause = joinFts
      ? 'FROM messages m JOIN messages_fts fts ON m.rowid = fts.rowid'
      : 'FROM messages m';

    const sql = `
      SELECT m.*
      ${fromClause}
      WHERE ${conditions.join(' AND ')}
      ${orderClause}
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
