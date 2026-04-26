// src/db/message.ts

import Database from 'better-sqlite3';

export type Sender = 'user' | 'assistant' | 'system';

export interface MessageRecord {
  id: string;
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
  fromTime?: number;
  toTime?: number;
  sender?: Sender;
  query?: string;
  gateway?: string;
  hasMedia?: boolean;
  limit?: number;
  order?: 'newest' | 'oldest' | 'relevant';
}

export interface MessageStore {
  insert(record: MessageRecord): void;
  getById(id: string): MessageRecord | undefined;
  getMessagesByIds(ids: string[]): MessageRecord[];
  getRecentMessages(opts: { limit: number; since?: number }): MessageRecord[];
  getMessagesForSession(sessionId: string, opts?: { limit?: number }): MessageRecord[];
  search(filter: SearchFilter): MessageRecord[];
  count(): number;
  getLatestUserMessage(): MessageRecord | null;
  listPage(opts: {
    gateway?: string; sender?: Sender; session_id?: string;
    timestampFrom?: number; timestampTo?: number;
    limit: number; offset: number;
  }): { rows: MessageRecord[]; total: number };
  searchPage(q: string, opts: {
    sender?: Sender; limit: number; offset: number;
  }): { hits: Array<MessageRecord & { snippet: string }>; total: number };
  getThread(sessionId: string, opts: { limit: number; offset: number }):
    { rows: MessageRecord[]; total: number };
  countByDay(opts: { sinceMs: number }): Array<{ day: string; n: number }>;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function createMessageStore(db: Database.Database): MessageStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
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

    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);

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

  // One-time FTS5 populate
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM messages WHERE body IS NOT NULL) AS m,
      (SELECT COUNT(*) FROM messages_fts_docsize) AS d
  `).get() as { m: number; d: number };
  if (counts.m > 0 && counts.d === 0) {
    db.exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`);
  }

  const stmtInsert = db.prepare(`
    INSERT OR IGNORE INTO messages (
      id, gateway, session_id, sender, timestamp, type, body,
      has_media, media_mimetype, media_filename, media_size, media_path,
      quoted_msg_id, is_forwarded, raw_json
    ) VALUES (
      @id, @gateway, @session_id, @sender, @timestamp, @type, @body,
      @has_media, @media_mimetype, @media_filename, @media_size, @media_path,
      @quoted_msg_id, @is_forwarded, @raw_json
    )
  `);

  const stmtGetById = db.prepare<[string], MessageRecord>(`SELECT * FROM messages WHERE id = ?`);
  const stmtCount = db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM messages`);

  const selectLatestUser = db.prepare<[], MessageRecord>(`
    SELECT * FROM messages WHERE sender = 'user'
    ORDER BY timestamp DESC LIMIT 1
  `);

  function getLatestUserMessage(): MessageRecord | null {
    return selectLatestUser.get() ?? null;
  }

  // Returns messages with timestamp >= since, ordered ascending (oldest first),
  // limited to `limit` rows taken from the END of the window (most recent).
  const stmtRecent = db.prepare<[number, number], MessageRecord>(`
    SELECT * FROM (
      SELECT * FROM messages
      WHERE timestamp >= ?
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp ASC
  `);

  function getMessagesByIds(ids: string[]): MessageRecord[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare<string[], MessageRecord>(
      `SELECT * FROM messages WHERE id IN (${placeholders})`
    );
    return stmt.all(...ids);
  }

  function buildSearchQuery(filter: SearchFilter): { sql: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let joinFts = false;

    if (filter.fromTime !== undefined) { conditions.push('m.timestamp >= ?'); params.push(filter.fromTime); }
    if (filter.toTime !== undefined) { conditions.push('m.timestamp < ?'); params.push(filter.toTime); }
    if (filter.sender !== undefined) { conditions.push('m.sender = ?'); params.push(filter.sender); }

    const hasQuery = filter.query !== undefined && filter.query.length > 0;
    if (hasQuery) {
      joinFts = true;
      conditions.push('fts.body MATCH ?');
      params.push(filter.query);
    }

    if (filter.gateway !== undefined) { conditions.push('m.gateway = ?'); params.push(filter.gateway); }
    if (filter.hasMedia !== undefined) { conditions.push('m.has_media = ?'); params.push(filter.hasMedia ? 1 : 0); }

    const defaultOrder: 'newest' | 'oldest' | 'relevant' = hasQuery ? 'relevant' : 'newest';
    const order = filter.order ?? defaultOrder;
    let orderClause: string;
    if (order === 'relevant' && joinFts) orderClause = 'ORDER BY rank';
    else if (order === 'oldest') orderClause = 'ORDER BY m.timestamp ASC';
    else orderClause = 'ORDER BY m.timestamp DESC';

    const rawLimit = filter.limit ?? DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)));

    const fromClause = joinFts
      ? 'FROM messages m JOIN messages_fts fts ON m.rowid = fts.rowid'
      : 'FROM messages m';
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `SELECT m.* ${fromClause} ${whereClause} ${orderClause} LIMIT ${limit}`;
    return { sql, params };
  }

  function listPage(opts: {
    gateway?: string; sender?: Sender; session_id?: string;
    timestampFrom?: number; timestampTo?: number;
    limit: number; offset: number;
  }) {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (opts.gateway)    { clauses.push('gateway = ?');    params.push(opts.gateway); }
    if (opts.sender)     { clauses.push('sender = ?');     params.push(opts.sender); }
    if (opts.session_id) { clauses.push('session_id = ?'); params.push(opts.session_id); }
    if (opts.timestampFrom != null) { clauses.push('timestamp >= ?'); params.push(opts.timestampFrom); }
    if (opts.timestampTo   != null) { clauses.push('timestamp <= ?'); params.push(opts.timestampTo); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM messages ${where}`)
      .get(...params) as { n: number }).n;
    const rows = db.prepare(
      `SELECT * FROM messages ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    ).all(...params, opts.limit, opts.offset) as MessageRecord[];
    return { rows, total };
  }

  function searchPage(q: string, opts: { sender?: Sender; limit: number; offset: number }) {
    const quoted = `"${q.replace(/"/g, '""')}"`;
    const senderClause = opts.sender ? 'AND m.sender = ?' : '';
    const senderParam: string[] = opts.sender ? [opts.sender] : [];
    const total = (db.prepare(
      `SELECT COUNT(*) AS n FROM messages_fts f
       JOIN messages m ON m.rowid = f.rowid
       WHERE messages_fts MATCH ? ${senderClause}`,
    ).get(quoted, ...senderParam) as { n: number }).n;
    const hits = db.prepare(
      `SELECT m.*, snippet(messages_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet
       FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
       WHERE messages_fts MATCH ? ${senderClause}
       ORDER BY rank
       LIMIT ? OFFSET ?`,
    ).all(quoted, ...senderParam, opts.limit, opts.offset) as Array<MessageRecord & { snippet: string }>;
    return { hits, total };
  }

  function getThread(sessionId: string, opts: { limit: number; offset: number }) {
    const total = (db.prepare(
      `SELECT COUNT(*) AS n FROM messages WHERE session_id = ?`,
    ).get(sessionId) as { n: number }).n;
    const rows = db.prepare(
      `SELECT * FROM messages WHERE session_id = ?
       ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    ).all(sessionId, opts.limit, opts.offset) as MessageRecord[];
    return { rows, total };
  }

  function countByDay(opts: { sinceMs: number }): Array<{ day: string; n: number }> {
    return db.prepare(
      `SELECT strftime('%Y-%m-%d', (timestamp / 1000 + 7*3600), 'unixepoch') AS day,
              COUNT(*) AS n
       FROM messages
       WHERE timestamp >= ?
       GROUP BY day
       ORDER BY day ASC`,
    ).all(opts.sinceMs) as Array<{ day: string; n: number }>;
  }

  return {
    insert(record) { stmtInsert.run(record); },
    getById(id) { return stmtGetById.get(id); },
    getMessagesByIds,
    getRecentMessages({ limit, since = 0 }) {
      const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
      return stmtRecent.all(since, safeLimit);
    },
    getMessagesForSession(sessionId, opts) {
      const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(opts?.limit ?? MAX_LIMIT)));
      const stmt = db.prepare<[string, number], MessageRecord>(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?`
      );
      return stmt.all(sessionId, limit);
    },
    search(filter) {
      const { sql, params } = buildSearchQuery(filter);
      const stmt = db.prepare<unknown[], MessageRecord>(sql);
      return stmt.all(...params);
    },
    count() { return stmtCount.get()?.n ?? 0; },
    getLatestUserMessage,
    listPage,
    searchPage,
    getThread,
    countByDay,
  };
}
