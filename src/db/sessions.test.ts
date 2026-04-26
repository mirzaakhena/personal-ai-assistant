// src/db/sessions.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createSessionStore, type SessionStore } from './sessions.js';

describe('SessionStore active session pointer', () => {
  let db: Database.Database;
  let store: SessionStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = createSessionStore(db);
  });

  it('save + get round-trips the active session id', () => {
    store.save('sess-resume-id');
    expect(store.get()).toBe('sess-resume-id');
  });

  it('delete clears the active session pointer', () => {
    store.save('sess-abc');
    store.delete();
    expect(store.get()).toBeUndefined();
  });

  it('save upserts — only one row at id=1', () => {
    store.save('first');
    store.save('second');
    expect(store.get()).toBe('second');
  });

  it('getLastActivity reflects the latest save', () => {
    const before = Date.now();
    store.save('sess-x');
    const ts = store.getLastActivity();
    expect(ts).toBeGreaterThanOrEqual(before);
  });
});

describe('session_meta', () => {
  let tmp: string; let db: Database.Database; let store: SessionStore;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'v5-sess-meta-'));
    db = new Database(join(tmp, 'test.db'));
    store = createSessionStore(db);
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('getMeta returns null for unknown key', () => {
    expect(store.getMeta('nope')).toBeNull();
  });

  it('setMeta + getMeta round-trips', () => {
    store.setMeta('v5_memory_migrated', 'true');
    expect(store.getMeta('v5_memory_migrated')).toBe('true');
  });

  it('setMeta upserts on same key', () => {
    store.setMeta('k', 'v1');
    store.setMeta('k', 'v2');
    expect(store.getMeta('k')).toBe('v2');
  });
});

describe('SessionStore — count', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sess-cnt-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('returns 0 if no session, 1 if session set', () => {
    const s = createSessionStore(db);
    expect(s.count()).toBe(0);
    s.save('sess-1');
    expect(s.count()).toBe(1);
  });
});
