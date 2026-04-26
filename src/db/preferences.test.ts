import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreferenceStore } from './preferences.js';

describe('preferences store', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'v5-pref-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('saves + lists by kind', () => {
    const s = createPreferenceStore(db);
    s.saveMany([
      { kind: 'rule', key: 'food_halal', value: 'Hanya halal' },
      { kind: 'style', key: 'casual_register', value: 'Friendly' },
    ]);
    expect(s.list()).toHaveLength(2);
    expect(s.list({ kind: 'rule' })).toHaveLength(1);
    expect(s.list({ kind: 'style' })).toHaveLength(1);
  });

  it('upserts on same (kind, key)', () => {
    const s = createPreferenceStore(db);
    s.saveMany([{ kind: 'style', key: 'tone', value: 'v1' }]);
    s.saveMany([{ kind: 'style', key: 'tone', value: 'v2' }]);
    const rows = s.list({ kind: 'style' });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('v2');
  });

  it('deletes by composite key', () => {
    const s = createPreferenceStore(db);
    s.saveMany([{ kind: 'rule', key: 'x', value: 'y' }]);
    expect(s.delete({ kind: 'rule', key: 'x' })).toBe(true);
    expect(s.list()).toHaveLength(0);
    expect(s.delete({ kind: 'rule', key: 'x' })).toBe(false);
  });

  it('rejects invalid kind', () => {
    const s = createPreferenceStore(db);
    expect(() => s.saveMany([{ kind: 'bogus' as any, key: 'x', value: 'y' }]))
      .toThrow(/invalid PreferenceKind/);
  });
});

describe('PreferenceStore — count', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pref-cnt-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('returns total rows', () => {
    const s = createPreferenceStore(db);
    s.saveMany([
      { kind: 'rule', key: 'r1', value: 'v1' },
      { kind: 'style', key: 's1', value: 'v2' },
    ]);
    expect(s.count()).toBe(2);
  });
});
