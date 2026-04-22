// scripts/rebuild-knowledge-fts.ts
//
// One-shot rebuild of knowledge_fts to include the `key` column.
// Applies to already-migrated v5 DBs whose knowledge_fts was created with
// value-only schema (name-slugs in keys weren't searchable).
//
// Usage:
//   pnpm tsx scripts/rebuild-knowledge-fts.ts                # console-user
//   V5_MIGRATE_USER_ID=1121398977 pnpm tsx scripts/rebuild-knowledge-fts.ts
//
// Safe to run multiple times (idempotent: drops + recreates).

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const USER_ID = process.env.V5_MIGRATE_USER_ID ?? 'console-user';
const BASE_DIR = process.env.V5_MIGRATE_BASE_DIR ?? 'data/users';
const DB_PATH = join(BASE_DIR, USER_ID, 'app.db');

function main() {
  if (!existsSync(DB_PATH)) {
    throw new Error(`DB not found: ${DB_PATH}`);
  }
  console.log(`[rebuild-fts] target: ${DB_PATH}`);

  const db = new Database(DB_PATH);
  try {
    db.pragma('foreign_keys = OFF');

    // Sanity check: knowledge table must exist (v5 schema)
    const hasKnowledge = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge'`
    ).get();
    if (!hasKnowledge) {
      throw new Error(`knowledge table not found — run migrate-v5-memory.ts first`);
    }

    const before = (db.prepare(`SELECT COUNT(*) AS n FROM knowledge`).get() as { n: number }).n;
    console.log(`[rebuild-fts] knowledge rows: ${before}`);

    // Drop old triggers + FTS (virtual table DROP cascades to shadow tables)
    db.exec(`
      DROP TRIGGER IF EXISTS knowledge_fts_ai;
      DROP TRIGGER IF EXISTS knowledge_fts_ad;
      DROP TRIGGER IF EXISTS knowledge_fts_au;
      DROP TABLE IF EXISTS knowledge_fts;
    `);
    console.log(`[rebuild-fts] dropped old FTS + triggers`);

    // Recreate with key column
    db.exec(`
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(
        key,
        value,
        content='knowledge',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER knowledge_fts_ai AFTER INSERT ON knowledge BEGIN
        INSERT INTO knowledge_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
      END;
      CREATE TRIGGER knowledge_fts_ad AFTER DELETE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, key, value) VALUES ('delete', old.rowid, old.key, old.value);
      END;
      CREATE TRIGGER knowledge_fts_au AFTER UPDATE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, key, value) VALUES ('delete', old.rowid, old.key, old.value);
        INSERT INTO knowledge_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
      END;
    `);
    console.log(`[rebuild-fts] created new FTS (key + value indexed)`);

    // Populate from existing knowledge rows
    db.exec(`
      INSERT INTO knowledge_fts(rowid, key, value)
        SELECT rowid, key, value FROM knowledge
    `);

    // Verify
    const indexed = (db.prepare(
      `SELECT COUNT(*) AS n FROM knowledge_fts`
    ).get() as { n: number }).n;
    console.log(`[rebuild-fts] indexed rows: ${indexed}`);

    if (indexed !== before) {
      throw new Error(`mismatch: ${indexed} indexed vs ${before} source rows`);
    }

    // Spot-check: does FTS now find name-in-key queries?
    const sample = db.prepare<{ q: string }, { key: string }>(
      `SELECT k.key FROM knowledge k JOIN knowledge_fts f ON k.rowid = f.rowid
       WHERE knowledge_fts MATCH @q LIMIT 5`
    ).all({ q: 'muhammad' });
    console.log(`[rebuild-fts] spot check "muhammad" → ${sample.length} hits: ${sample.map(s => s.key).join(', ') || '(none)'}`);

    console.log(`[rebuild-fts] done ✓`);
  } finally {
    db.close();
  }
}

main();
