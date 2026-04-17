// src-v3/db/memory.ts

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

// ── Types ────────────────────────────────────────────────

export type Layer = 'L2' | 'L3';
export type JournalType = 'emotion' | 'life_context' | 'problem' | 'event' | 'trait_observation' | 'conversation_summary';
export type JournalStatus = 'ongoing' | 'resolved' | null;
export type Intensity = 'low' | 'medium' | 'high' | null;
export type EventOutcome = 'done' | 'missed' | null;
export type Importance = 'critical' | 'normal' | null;
export type Circle = 'inner' | 'extended_family' | 'close' | 'casual' | null;

export interface ProfileRecord {
  id: string;
  category: string;
  layer: Layer;
  key: string;
  value: string;
  confidence: number | null;
  source_session_id: string | null;
  source_msg_id: string | null;
  importance: Importance;
  last_updated: number;
  created_at: number;
}

export interface JournalRecord {
  id: string;
  type: JournalType;
  content: string;
  status: JournalStatus;
  intensity: Intensity;
  recurrence_count: number;
  related_ids: string[] | null;
  event_date: string | null;
  event_outcome: EventOutcome;
  follow_up_needed: number;
  inferred_trait: string | null;
  confidence: number | null;
  session_id: string | null;
  source_msg_id: string | null;
  created_at: number;
  resolved_at: number | null;
}

export interface RelationshipRecord {
  id: string;
  name: string;
  role: string;
  dynamic: string | null;
  circle: Circle;
  related_ids: string[] | null;
  source_session_id: string | null;
  last_mentioned: number;
  created_at: number;
}

export interface JournalSearchFilter {
  query?: string;
  type?: JournalType;
  status?: JournalStatus;
  fromTime?: number;
  toTime?: number;
  limit?: number;
  order?: 'newest' | 'oldest' | 'relevant';
}

export interface MemoryStore {
  upsertProfile(rec: Omit<ProfileRecord, 'id' | 'created_at' | 'last_updated' | 'importance'> & { importance?: Importance }): ProfileRecord;
  getProfile(category: string, key: string): ProfileRecord | undefined;
  listProfile(opts?: { layer?: Layer; category?: string; importance?: Importance }): ProfileRecord[];

  insertJournal(rec: Omit<JournalRecord, 'id' | 'created_at'> & { id?: string; created_at?: number }): JournalRecord;
  getJournal(id: string): JournalRecord | undefined;
  searchJournal(filter: JournalSearchFilter): JournalRecord[];
  resolveJournal(id: string, outcome?: EventOutcome): boolean;
  listOngoing(): JournalRecord[];
  listRecentAnyStatus(cap?: number): JournalRecord[];

  upsertRelationship(rec: Omit<RelationshipRecord, 'id' | 'created_at' | 'last_mentioned'>): RelationshipRecord;
  listRelationships(): RelationshipRecord[];
  listRelationshipsBundle(opts: { recentDays: number; recentCap: number; totalCap: number }): RelationshipRecord[];
  getRelationshipByName(name: string): RelationshipRecord | undefined;
}

// ── Helpers ──────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function nowMs(): number { return Date.now(); }

function toJsonArray(v: string[] | null | undefined): string | null {
  if (!v || v.length === 0) return null;
  return JSON.stringify(v);
}

function fromJsonArray(v: string | null | undefined): string[] | null {
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

type ProfileRow = Omit<ProfileRecord, never>;
type JournalRow = Omit<JournalRecord, 'related_ids'> & { related_ids: string | null };
type RelationshipRow = Omit<RelationshipRecord, 'related_ids'> & { related_ids: string | null };

function journalRowToRecord(r: JournalRow): JournalRecord {
  return { ...r, related_ids: fromJsonArray(r.related_ids) };
}
function relationshipRowToRecord(r: RelationshipRow): RelationshipRecord {
  return { ...r, related_ids: fromJsonArray(r.related_ids) };
}

// ── Factory ──────────────────────────────────────────────

export function createMemoryStore(db: Database.Database): MemoryStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      id                 TEXT PRIMARY KEY,
      category           TEXT NOT NULL,
      layer              TEXT NOT NULL,
      key                TEXT NOT NULL,
      value              TEXT NOT NULL,
      confidence         REAL,
      source_session_id  TEXT,
      source_msg_id      TEXT,
      importance         TEXT,
      last_updated       INTEGER NOT NULL,
      created_at         INTEGER NOT NULL,
      UNIQUE(category, key)
    );
    CREATE INDEX IF NOT EXISTS idx_profile_layer ON profile(layer);

    CREATE TABLE IF NOT EXISTS journal (
      id                     TEXT PRIMARY KEY,
      type                   TEXT NOT NULL,
      content                TEXT NOT NULL,
      status                 TEXT,
      intensity              TEXT,
      recurrence_count       INTEGER NOT NULL DEFAULT 1,
      related_ids            TEXT,
      event_date             TEXT,
      event_outcome          TEXT,
      follow_up_needed       INTEGER NOT NULL DEFAULT 0,
      inferred_trait         TEXT,
      confidence             REAL,
      promoted_to_trait_id   TEXT,
      session_id             TEXT,
      source_msg_id          TEXT REFERENCES messages(id) ON DELETE SET NULL,
      created_at             INTEGER NOT NULL,
      resolved_at            INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_journal_status ON journal(status);
    CREATE INDEX IF NOT EXISTS idx_journal_type ON journal(type);
    CREATE INDEX IF NOT EXISTS idx_journal_inferred_trait ON journal(inferred_trait);

    CREATE VIRTUAL TABLE IF NOT EXISTS journal_fts USING fts5(
      content,
      inferred_trait,
      content='journal',
      content_rowid='rowid',
      tokenize='unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS journal_fts_ai AFTER INSERT ON journal BEGIN
      INSERT INTO journal_fts(rowid, content, inferred_trait) VALUES (new.rowid, new.content, new.inferred_trait);
    END;
    CREATE TRIGGER IF NOT EXISTS journal_fts_ad AFTER DELETE ON journal BEGIN
      INSERT INTO journal_fts(journal_fts, rowid, content, inferred_trait) VALUES ('delete', old.rowid, old.content, old.inferred_trait);
    END;
    CREATE TRIGGER IF NOT EXISTS journal_fts_au AFTER UPDATE ON journal BEGIN
      INSERT INTO journal_fts(journal_fts, rowid, content, inferred_trait) VALUES ('delete', old.rowid, old.content, old.inferred_trait);
      INSERT INTO journal_fts(rowid, content, inferred_trait) VALUES (new.rowid, new.content, new.inferred_trait);
    END;

    CREATE TABLE IF NOT EXISTS relationships (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL UNIQUE,
      role               TEXT NOT NULL,
      dynamic            TEXT,
      circle             TEXT,
      related_ids        TEXT,
      source_session_id  TEXT,
      last_mentioned     INTEGER NOT NULL,
      created_at         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_relationships_circle ON relationships(circle);
  `);

  // M5 migration: add importance column to existing pre-M5 DBs (idempotent)
  const profileCols = db.prepare("PRAGMA table_info(profile)").all() as { name: string }[];
  if (!profileCols.some(c => c.name === 'importance')) {
    db.exec(`ALTER TABLE profile ADD COLUMN importance TEXT`);
  }

  // v5.1 migration: add circle column to existing pre-v5.1 DBs (idempotent)
  const relCols = db.prepare("PRAGMA table_info(relationships)").all() as { name: string }[];
  if (!relCols.some(c => c.name === 'circle')) {
    db.exec(`ALTER TABLE relationships ADD COLUMN circle TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_relationships_circle ON relationships(circle)`);
  }

  // FTS5 auto-populate on first run
  const fCounts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM journal WHERE content IS NOT NULL) AS m,
      (SELECT COUNT(*) FROM journal_fts_docsize) AS d
  `).get() as { m: number; d: number };
  if (fCounts.m > 0 && fCounts.d === 0) {
    db.exec(`INSERT INTO journal_fts(journal_fts) VALUES('rebuild')`);
  }

  // ── Profile ──────────────────────────────────────────

  const stmtGetProfile = db.prepare<[string, string], ProfileRow>(`
    SELECT * FROM profile WHERE category = ? AND key = ?
  `);
  const stmtInsertProfile = db.prepare(`
    INSERT INTO profile (id, category, layer, key, value, confidence, source_session_id, source_msg_id, importance, last_updated, created_at)
    VALUES (@id, @category, @layer, @key, @value, @confidence, @source_session_id, @source_msg_id, @importance, @last_updated, @created_at)
  `);
  const stmtUpdateProfile = db.prepare(`
    UPDATE profile SET value = @value, layer = @layer, confidence = @confidence,
      source_session_id = @source_session_id, source_msg_id = @source_msg_id,
      importance = @importance, last_updated = @last_updated
    WHERE category = @category AND key = @key
  `);

  function upsertProfile(rec: Omit<ProfileRecord, 'id' | 'created_at' | 'last_updated' | 'importance'> & { importance?: Importance }): ProfileRecord {
    const existing = stmtGetProfile.get(rec.category, rec.key);
    const now = nowMs();
    const importance: Importance = rec.importance ?? null;
    if (existing) {
      stmtUpdateProfile.run({ ...rec, importance, last_updated: now });
      return stmtGetProfile.get(rec.category, rec.key)!;
    }
    const id = uuidv4();
    const full: ProfileRecord = { ...rec, importance, id, last_updated: now, created_at: now };
    stmtInsertProfile.run(full);
    return full;
  }

  function listProfile(opts?: { layer?: Layer; category?: string; importance?: Importance }): ProfileRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.layer) { conditions.push('layer = ?'); params.push(opts.layer); }
    if (opts?.category) { conditions.push('category = ?'); params.push(opts.category); }
    if (opts?.importance !== undefined) {
      if (opts.importance === null) {
        conditions.push('importance IS NULL');
      } else {
        conditions.push('importance = ?');
        params.push(opts.importance);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM profile ${whereClause}`;
    const stmt = db.prepare<unknown[], ProfileRow>(sql);
    return stmt.all(...params);
  }

  function getProfile(category: string, key: string): ProfileRecord | undefined {
    return stmtGetProfile.get(category, key);
  }

  // ── Journal ──────────────────────────────────────────

  const stmtInsertJournal = db.prepare(`
    INSERT INTO journal (
      id, type, content, status, intensity, recurrence_count, related_ids,
      event_date, event_outcome, follow_up_needed, inferred_trait, confidence,
      session_id, source_msg_id, created_at, resolved_at
    ) VALUES (
      @id, @type, @content, @status, @intensity, @recurrence_count, @related_ids,
      @event_date, @event_outcome, @follow_up_needed, @inferred_trait, @confidence,
      @session_id, @source_msg_id, @created_at, @resolved_at
    )
  `);
  const stmtGetJournal = db.prepare<[string], JournalRow>(`SELECT * FROM journal WHERE id = ?`);
  const stmtResolveJournal = db.prepare(`
    UPDATE journal SET status = 'resolved', resolved_at = @resolved_at, event_outcome = @event_outcome WHERE id = @id
  `);
  const stmtListOngoing = db.prepare<[], JournalRow>(`
    SELECT * FROM journal WHERE status = 'ongoing' ORDER BY created_at DESC LIMIT 10
  `);
  const stmtListRecentAnyStatus = db.prepare<[number], JournalRow>(`
    SELECT * FROM journal ORDER BY created_at DESC LIMIT ?
  `);

  function insertJournal(rec: Omit<JournalRecord, 'id' | 'created_at'> & { id?: string; created_at?: number }): JournalRecord {
    const id = rec.id ?? uuidv4();
    const created_at = rec.created_at ?? nowMs();
    const row = { ...rec, id, created_at, related_ids: toJsonArray(rec.related_ids) };
    stmtInsertJournal.run(row);
    return journalRowToRecord(stmtGetJournal.get(id)!);
  }

  function getJournal(id: string): JournalRecord | undefined {
    const row = stmtGetJournal.get(id);
    return row ? journalRowToRecord(row) : undefined;
  }

  function resolveJournal(id: string, outcome: EventOutcome = null): boolean {
    const res = stmtResolveJournal.run({ id, resolved_at: nowMs(), event_outcome: outcome });
    return res.changes > 0;
  }

  function listOngoing(): JournalRecord[] {
    return stmtListOngoing.all().map(journalRowToRecord);
  }

  function listRecentAnyStatus(cap: number = 5): JournalRecord[] {
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(cap)));
    return stmtListRecentAnyStatus.all(limit).map(journalRowToRecord);
  }

  function searchJournal(filter: JournalSearchFilter): JournalRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let joinFts = false;

    if (filter.fromTime !== undefined) { conditions.push('j.created_at >= ?'); params.push(filter.fromTime); }
    if (filter.toTime !== undefined) { conditions.push('j.created_at < ?'); params.push(filter.toTime); }
    if (filter.type !== undefined) { conditions.push('j.type = ?'); params.push(filter.type); }
    if (filter.status !== undefined) {
      if (filter.status === null) conditions.push('j.status IS NULL');
      else { conditions.push('j.status = ?'); params.push(filter.status); }
    }

    const hasQuery = filter.query !== undefined && filter.query.length > 0;
    if (hasQuery) {
      joinFts = true;
      conditions.push('fts.content MATCH ?');
      params.push(filter.query);
    }

    const defaultOrder: 'newest' | 'oldest' | 'relevant' = hasQuery ? 'relevant' : 'newest';
    const order = filter.order ?? defaultOrder;
    let orderClause: string;
    if (order === 'relevant' && joinFts) orderClause = 'ORDER BY rank';
    else if (order === 'oldest') orderClause = 'ORDER BY j.created_at ASC';
    else orderClause = 'ORDER BY j.created_at DESC';

    const rawLimit = filter.limit ?? DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)));

    const from = joinFts
      ? 'FROM journal j JOIN journal_fts fts ON j.rowid = fts.rowid'
      : 'FROM journal j';
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT j.* ${from} ${whereClause} ${orderClause} LIMIT ${limit}`;
    const stmt = db.prepare<unknown[], JournalRow>(sql);
    return stmt.all(...params).map(journalRowToRecord);
  }

  // ── Relationships ────────────────────────────────────

  const stmtGetRelByName = db.prepare<[string], RelationshipRow>(`SELECT * FROM relationships WHERE name = ?`);
  const stmtInsertRel = db.prepare(`
    INSERT INTO relationships (id, name, role, dynamic, circle, related_ids, source_session_id, last_mentioned, created_at)
    VALUES (@id, @name, @role, @dynamic, @circle, @related_ids, @source_session_id, @last_mentioned, @created_at)
  `);
  const stmtUpdateRel = db.prepare(`
    UPDATE relationships SET role = @role, dynamic = @dynamic, circle = @circle, related_ids = @related_ids,
      source_session_id = @source_session_id, last_mentioned = @last_mentioned
    WHERE name = @name
  `);
  const stmtListRel = db.prepare<[], RelationshipRow>(`SELECT * FROM relationships`);
  const stmtListInner = db.prepare<[], RelationshipRow>(`
    SELECT * FROM relationships WHERE circle = 'inner' ORDER BY last_mentioned DESC
  `);
  const stmtListRecentNonInner = db.prepare<[number, number], RelationshipRow>(`
    SELECT * FROM relationships
    WHERE (circle IS NULL OR circle != 'inner')
      AND last_mentioned >= ?
    ORDER BY last_mentioned DESC, created_at DESC
    LIMIT ?
  `);

  function upsertRelationship(rec: Omit<RelationshipRecord, 'id' | 'created_at' | 'last_mentioned'>): RelationshipRecord {
    const existing = stmtGetRelByName.get(rec.name);
    const now = nowMs();
    if (existing) {
      stmtUpdateRel.run({ ...rec, related_ids: toJsonArray(rec.related_ids), last_mentioned: now });
      return relationshipRowToRecord(stmtGetRelByName.get(rec.name)!);
    }
    const id = uuidv4();
    const full = { ...rec, id, created_at: now, last_mentioned: now, related_ids: toJsonArray(rec.related_ids) };
    stmtInsertRel.run(full);
    return relationshipRowToRecord(stmtGetRelByName.get(rec.name)!);
  }

  function listRelationships(): RelationshipRecord[] {
    return stmtListRel.all().map(relationshipRowToRecord);
  }
  function listRelationshipsBundle(opts: { recentDays: number; recentCap: number; totalCap: number }): RelationshipRecord[] {
    const since = nowMs() - opts.recentDays * 24 * 60 * 60 * 1000;
    const recentCap = Math.max(1, Math.min(MAX_LIMIT, Math.floor(opts.recentCap)));
    const totalCap = Math.max(1, Math.min(MAX_LIMIT, Math.floor(opts.totalCap)));

    const inner = stmtListInner.all().map(relationshipRowToRecord);
    const recent = stmtListRecentNonInner.all(since, recentCap).map(relationshipRowToRecord);

    // Dedupe by id (should not overlap but safety)
    const seen = new Set<string>();
    const merged: RelationshipRecord[] = [];
    for (const r of [...inner, ...recent]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
      if (merged.length >= totalCap) break;
    }
    return merged;
  }
  function getRelationshipByName(name: string): RelationshipRecord | undefined {
    const row = stmtGetRelByName.get(name);
    return row ? relationshipRowToRecord(row) : undefined;
  }

  return {
    upsertProfile, getProfile, listProfile,
    insertJournal, getJournal, searchJournal, resolveJournal, listOngoing, listRecentAnyStatus,
    upsertRelationship, listRelationships, listRelationshipsBundle, getRelationshipByName,
  };
}
