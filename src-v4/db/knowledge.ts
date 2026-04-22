// src-v4/db/knowledge.ts

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

  return { saveMany, list, search, delete: deleteOne };
}
