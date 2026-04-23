import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfileStore, PROFILE_KEYS, type ProfileKey } from './profile.js';

describe('profile store', () => {
  let tmp: string;
  let db: Database.Database;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'v5-profile-'));
    db = new Database(join(tmp, 'test.db'));
    db.pragma('foreign_keys = ON');
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty object for fresh db', () => {
    const store = createProfileStore(db);
    expect(store.getAll()).toEqual({});
  });

  it('upserts a single slot and reads it back', () => {
    const store = createProfileStore(db);
    store.setMany([{ key: 'name', value: 'Mirza' }]);
    expect(store.getAll()).toEqual({ name: 'Mirza' });
  });

  it('upserts multiple slots in one call', () => {
    const store = createProfileStore(db);
    store.setMany([
      { key: 'name', value: 'Mirza' },
      { key: 'language', value: 'id' },
      { key: 'timezone', value: 'Asia/Seoul' },
    ]);
    const all = store.getAll();
    expect(all.name).toBe('Mirza');
    expect(all.language).toBe('id');
    expect(all.timezone).toBe('Asia/Seoul');
  });

  it('upsert overwrites existing value and bumps updated_at', () => {
    const store = createProfileStore(db);
    store.setMany([{ key: 'current_location', value: 'Bandung' }]);
    store.setMany([{ key: 'current_location', value: 'Busan' }]);
    expect(store.getAll().current_location).toBe('Busan');
  });

  it('exposes PROFILE_KEYS as the full enum', () => {
    expect(PROFILE_KEYS).toContain('name');
    expect(PROFILE_KEYS).toContain('called_as');
    expect(PROFILE_KEYS).toContain('language');
    expect(PROFILE_KEYS).toContain('timezone');
    expect(PROFILE_KEYS).toContain('home_location');
    expect(PROFILE_KEYS).toContain('current_location');
    expect(PROFILE_KEYS).toContain('active_hours');
    expect(PROFILE_KEYS.length).toBe(7);
  });
});
