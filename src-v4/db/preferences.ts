// src-v4/db/preferences.ts

import type Database from 'better-sqlite3';

export const PREFERENCE_KINDS = ['rule', 'style'] as const;
export type PreferenceKind = (typeof PREFERENCE_KINDS)[number];

export interface PreferenceEntry {
  kind: PreferenceKind;
  key: string;
  value: string;
  source_msg_id?: string | null;
}

export interface PreferenceRow {
  kind: PreferenceKind;
  key: string;
  value: string;
  source_msg_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface PreferenceStore {
  saveMany(entries: PreferenceEntry[]): void;
  list(filter?: { kind?: PreferenceKind }): PreferenceRow[];
  delete(id: { kind: PreferenceKind; key: string }): boolean;
}

const DDL = `
  CREATE TABLE IF NOT EXISTS preferences (
    kind           TEXT NOT NULL,
    key            TEXT NOT NULL,
    value          TEXT NOT NULL,
    source_msg_id  TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    PRIMARY KEY (kind, key)
  );
`;

export function createPreferenceStore(db: Database.Database): PreferenceStore {
  db.exec(DDL);

  const upsert = db.prepare(`
    INSERT INTO preferences (kind, key, value, source_msg_id, created_at, updated_at)
    VALUES (@kind, @key, @value, @source_msg_id, @created_at, @updated_at)
    ON CONFLICT(kind, key) DO UPDATE SET
      value = excluded.value,
      source_msg_id = excluded.source_msg_id,
      updated_at = excluded.updated_at
  `);
  const selectAll = db.prepare<[], PreferenceRow>(`SELECT * FROM preferences ORDER BY kind, key`);
  const selectByKind = db.prepare<{ kind: string }, PreferenceRow>(
    `SELECT * FROM preferences WHERE kind = @kind ORDER BY key`
  );
  const del = db.prepare<{ kind: string; key: string }>(
    `DELETE FROM preferences WHERE kind = @kind AND key = @key`
  );

  function saveMany(entries: PreferenceEntry[]): void {
    const now = Date.now();
    const tx = db.transaction((es: PreferenceEntry[]) => {
      for (const e of es) {
        if (!PREFERENCE_KINDS.includes(e.kind)) {
          throw new Error(`invalid PreferenceKind: ${e.kind}`);
        }
        upsert.run({
          kind: e.kind, key: e.key, value: e.value,
          source_msg_id: e.source_msg_id ?? null,
          created_at: now, updated_at: now,
        });
      }
    });
    tx(entries);
  }

  function list(filter?: { kind?: PreferenceKind }): PreferenceRow[] {
    if (filter?.kind) return selectByKind.all({ kind: filter.kind });
    return selectAll.all();
  }

  function deleteOne(id: { kind: PreferenceKind; key: string }): boolean {
    return del.run(id).changes > 0;
  }

  return { saveMany, list, delete: deleteOne };
}
