// scripts/migrate-v5-memory.ts
//
// One-shot, single-user v5 memory migration for console-user.
// Backs up app.db, reads source rows, drops old tables, creates new tables,
// applies mapping per docs/superpowers/specs/2026-04-22-v5-memory-redesign-design.md
//
// Usage:
//   pnpm tsx scripts/migrate-v5-memory.ts --dry-run
//   pnpm tsx scripts/migrate-v5-memory.ts

import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Config ──────────────────────────────────────────
const USER_ID = process.env.V5_MIGRATE_USER_ID ?? 'console-user';
const BASE_DIR = process.env.V5_MIGRATE_BASE_DIR ?? 'data/users';
const DB_PATH = join(BASE_DIR, USER_ID, 'app.db');

const DRY_RUN = process.argv.includes('--dry-run');

// ── Expected counts (for post-migration verification) ──
const EXPECTED = {
  profile_min: 5,          // at least 5 slots populated from source
  preferences_exact: 10,   // always 10 per design
  knowledge_min: 40,       // base rows (identity/person/routine/context + insight seeds) before trait_observations
  tasks_max: 10,           // existing 3 preserved; tolerance for a few
};

// ── Entry point ─────────────────────────────────────
function main() {
  if (!existsSync(DB_PATH)) {
    throw new Error(`DB not found: ${DB_PATH}`);
  }

  console.log(`[migrate-v5] target: ${DB_PATH}`);
  console.log(`[migrate-v5] dry-run: ${DRY_RUN}`);

  const backupPath = takeBackup(DB_PATH);
  console.log(`[migrate-v5] backup: ${backupPath}`);

  if (DRY_RUN) {
    console.log('[migrate-v5] dry-run: would proceed with migration steps now');
    console.log('[migrate-v5] (no mutations performed)');
    return;
  }

  const db = new Database(DB_PATH);
  try {
    db.pragma('foreign_keys = OFF'); // we'll drop + recreate tables
    db.pragma('journal_mode = WAL');

    console.log('[migrate-v5] reading source rows...');
    // Steps B2-B5 add more imports + implementations here
    console.log('[migrate-v5] scaffold only — no transformation yet');

    console.log('[migrate-v5] done');
  } finally {
    db.close();
  }
}

function takeBackup(dbPath: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.backup-v5-${ts}`;
  copyFileSync(dbPath, backupPath);
  return backupPath;
}

main();
