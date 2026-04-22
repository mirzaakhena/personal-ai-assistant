// src-v4/db/profile.ts

import type Database from 'better-sqlite3';

export const PROFILE_KEYS = [
  'name',
  'called_as',
  'language',
  'timezone',
  'home_location',
  'current_location',
  'active_hours',
] as const;

export type ProfileKey = (typeof PROFILE_KEYS)[number];

export interface ProfileEntry {
  key: ProfileKey;
  value: string;
  source_msg_id?: string | null;
}

export interface ProfileRow {
  key: ProfileKey;
  value: string;
  source_msg_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProfileStore {
  getAll(): Partial<Record<ProfileKey, string>>;
  getAllRows(): ProfileRow[];
  setMany(entries: ProfileEntry[]): void;
}

const DDL = `
  CREATE TABLE IF NOT EXISTS profile (
    key            TEXT PRIMARY KEY,
    value          TEXT NOT NULL,
    source_msg_id  TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
`;

export function createProfileStore(db: Database.Database): ProfileStore {
  db.exec(DDL);

  const selectAll = db.prepare<[], ProfileRow>(`SELECT * FROM profile`);
  const upsert = db.prepare<{
    key: string; value: string; source_msg_id: string | null;
    created_at: number; updated_at: number;
  }>(`
    INSERT INTO profile (key, value, source_msg_id, created_at, updated_at)
    VALUES (@key, @value, @source_msg_id, @created_at, @updated_at)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      source_msg_id = excluded.source_msg_id,
      updated_at = excluded.updated_at
  `);

  function getAllRows(): ProfileRow[] {
    return selectAll.all();
  }

  function getAll(): Partial<Record<ProfileKey, string>> {
    const out: Partial<Record<ProfileKey, string>> = {};
    for (const row of getAllRows()) {
      out[row.key] = row.value;
    }
    return out;
  }

  function setMany(entries: ProfileEntry[]): void {
    const now = Date.now();
    const tx = db.transaction((es: ProfileEntry[]) => {
      for (const e of es) {
        if (!PROFILE_KEYS.includes(e.key)) {
          throw new Error(`invalid ProfileKey: ${e.key}`);
        }
        upsert.run({
          key: e.key,
          value: e.value,
          source_msg_id: e.source_msg_id ?? null,
          created_at: now,
          updated_at: now,
        });
      }
    });
    tx(entries);
  }

  return { getAll, getAllRows, setMany };
}
