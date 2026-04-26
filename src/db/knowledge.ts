// src/db/knowledge.ts

import type Database from 'better-sqlite3';

export const KNOWLEDGE_CATEGORIES = ['identity', 'person', 'routine', 'context', 'insight'] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeEntry {
  category: KnowledgeCategory;
  key: string;
  value: string;
  source_msg_id?: string | null;
}

export interface KnowledgeRow {
  category: KnowledgeCategory;
  key: string;
  value: string;
  source_msg_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface KnowledgeStore {
  saveMany(entries: KnowledgeEntry[]): void;
  list(filter?: { category?: KnowledgeCategory }): KnowledgeRow[];
  search(query: string, filter?: { category?: KnowledgeCategory }): KnowledgeRow[];
  delete(id: { category: KnowledgeCategory; key: string }): boolean;
  listPage(opts: {
    category?: KnowledgeCategory;
    limit: number;
    offset: number;
  }): { rows: KnowledgeRow[]; total: number };
  searchPage(query: string, opts: {
    category?: KnowledgeCategory;
    limit: number;
    offset: number;
  }): { hits: Array<KnowledgeRow & { snippet: string }>; total: number };
  countByCategory(): Record<KnowledgeCategory, number>;
}

const DDL = `
  CREATE TABLE IF NOT EXISTS knowledge (
    category       TEXT NOT NULL,
    key            TEXT NOT NULL,
    value          TEXT NOT NULL,
    source_msg_id  TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    PRIMARY KEY (category, key)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    key,
    value,
    content='knowledge',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER IF NOT EXISTS knowledge_fts_ai AFTER INSERT ON knowledge BEGIN
    INSERT INTO knowledge_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
  END;
  CREATE TRIGGER IF NOT EXISTS knowledge_fts_ad AFTER DELETE ON knowledge BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, key, value) VALUES ('delete', old.rowid, old.key, old.value);
  END;
  CREATE TRIGGER IF NOT EXISTS knowledge_fts_au AFTER UPDATE ON knowledge BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, key, value) VALUES ('delete', old.rowid, old.key, old.value);
    INSERT INTO knowledge_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
  END;
`;

export function createKnowledgeStore(db: Database.Database): KnowledgeStore {
  db.exec(DDL);

  const upsert = db.prepare(`
    INSERT INTO knowledge (category, key, value, source_msg_id, created_at, updated_at)
    VALUES (@category, @key, @value, @source_msg_id, @created_at, @updated_at)
    ON CONFLICT(category, key) DO UPDATE SET
      value = excluded.value,
      source_msg_id = excluded.source_msg_id,
      updated_at = excluded.updated_at
  `);
  const selectAll = db.prepare<[], KnowledgeRow>(`SELECT * FROM knowledge ORDER BY category, key`);
  const selectByCat = db.prepare<{ category: string }, KnowledgeRow>(
    `SELECT * FROM knowledge WHERE category = @category ORDER BY key`
  );
  const searchAll = db.prepare<{ q: string }, KnowledgeRow>(`
    SELECT k.* FROM knowledge k
    JOIN knowledge_fts f ON k.rowid = f.rowid
    WHERE knowledge_fts MATCH @q
    ORDER BY rank
  `);
  const searchCat = db.prepare<{ q: string; category: string }, KnowledgeRow>(`
    SELECT k.* FROM knowledge k
    JOIN knowledge_fts f ON k.rowid = f.rowid
    WHERE knowledge_fts MATCH @q AND k.category = @category
    ORDER BY rank
  `);
  const del = db.prepare<{ category: string; key: string }>(
    `DELETE FROM knowledge WHERE category = @category AND key = @key`
  );

  function saveMany(entries: KnowledgeEntry[]): void {
    const now = Date.now();
    const tx = db.transaction((es: KnowledgeEntry[]) => {
      for (const e of es) {
        if (!KNOWLEDGE_CATEGORIES.includes(e.category)) {
          throw new Error(`invalid KnowledgeCategory: ${e.category}`);
        }
        upsert.run({
          category: e.category, key: e.key, value: e.value,
          source_msg_id: e.source_msg_id ?? null,
          created_at: now, updated_at: now,
        });
      }
    });
    tx(entries);
  }

  function list(filter?: { category?: KnowledgeCategory }): KnowledgeRow[] {
    if (filter?.category) return selectByCat.all({ category: filter.category });
    return selectAll.all();
  }

  function search(query: string, filter?: { category?: KnowledgeCategory }): KnowledgeRow[] {
    // FTS5 requires escaping double quotes in user queries. Simple phrase quoting:
    const q = `"${query.replace(/"/g, '""')}"`;
    if (filter?.category) return searchCat.all({ q, category: filter.category });
    return searchAll.all({ q });
  }

  function deleteOne(id: { category: KnowledgeCategory; key: string }): boolean {
    return del.run(id).changes > 0;
  }

  function listPage(opts: { category?: KnowledgeCategory; limit: number; offset: number }) {
    const where = opts.category ? 'WHERE category = ?' : '';
    const params: Array<string | number> = opts.category ? [opts.category] : [];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM knowledge ${where}`)
      .get(...params) as { n: number }).n;
    const rows = db.prepare(
      `SELECT category, key, value, source_msg_id, created_at, updated_at
       FROM knowledge ${where}
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, opts.limit, opts.offset) as KnowledgeRow[];
    return { rows, total };
  }

  function searchPage(
    query: string,
    opts: { category?: KnowledgeCategory; limit: number; offset: number },
  ) {
    const q = `"${query.replace(/"/g, '""')}"`;
    const catWhere = opts.category ? 'AND k.category = ?' : '';
    const catParams: string[] = opts.category ? [opts.category] : [];

    const totalRow = db.prepare(
      `SELECT COUNT(*) AS n
       FROM knowledge_fts f
       JOIN knowledge k ON k.rowid = f.rowid
       WHERE knowledge_fts MATCH ? ${catWhere}`,
    ).get(q, ...catParams) as { n: number };

    // FTS5 snippet: column index 1 = value column
    const hits = db.prepare(
      `SELECT k.category, k.key, k.value, k.source_msg_id, k.created_at, k.updated_at,
              snippet(knowledge_fts, 1, '<mark>', '</mark>', '…', 16) AS snippet
       FROM knowledge_fts f
       JOIN knowledge k ON k.rowid = f.rowid
       WHERE knowledge_fts MATCH ? ${catWhere}
       ORDER BY rank
       LIMIT ? OFFSET ?`,
    ).all(q, ...catParams, opts.limit, opts.offset) as Array<KnowledgeRow & { snippet: string }>;

    return { hits, total: totalRow.n };
  }

  function countByCategory(): Record<KnowledgeCategory, number> {
    const out: Record<KnowledgeCategory, number> = {
      identity: 0, person: 0, routine: 0, context: 0, insight: 0,
    };
    const rows = db.prepare(
      `SELECT category, COUNT(*) AS n FROM knowledge GROUP BY category`,
    ).all() as Array<{ category: KnowledgeCategory; n: number }>;
    for (const r of rows) out[r.category] = r.n;
    return out;
  }

  return { saveMany, list, search, delete: deleteOne, listPage, searchPage, countByCategory };
}
