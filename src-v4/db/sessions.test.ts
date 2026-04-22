// src-v4/db/sessions.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createSessionStore, type SessionSummaryRecord, type SessionStore } from './sessions.js';

describe('SessionStore summaries', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    db = new Database(':memory:');
    store = createSessionStore(db);
  });

  it('saves and fetches latest session summary by user', () => {
    const rec: SessionSummaryRecord = {
      id: 'sum-1',
      session_id: 'sess-abc',
      user_id: 'u1',
      summary: 'Narrative...',
      turns: 20,
      ended_at: '2026-04-21T20:00:00+07:00',
      ended_reason: 'turn_threshold',
      created_at: '2026-04-21T20:00:05+07:00',
    };
    store.saveSummary(rec);

    const got = store.getLatestSummaryForUser('u1');
    expect(got?.id).toBe('sum-1');
    expect(got?.summary).toBe('Narrative...');
  });

  it('returns undefined when no summary for user', () => {
    expect(store.getLatestSummaryForUser('nobody')).toBeUndefined();
  });

  it('getLatestSummaryForUser returns most recent by ended_at', () => {
    store.saveSummary({
      id: 'sum-old',
      session_id: 's1',
      user_id: 'u1',
      summary: 'old',
      turns: 10,
      ended_at: '2026-04-21T10:00:00+07:00',
      ended_reason: 'turn_threshold',
      created_at: '2026-04-21T10:00:01+07:00',
    });
    store.saveSummary({
      id: 'sum-new',
      session_id: 's2',
      user_id: 'u1',
      summary: 'new',
      turns: 15,
      ended_at: '2026-04-21T20:00:00+07:00',
      ended_reason: 'graceful_shutdown',
      created_at: '2026-04-21T20:00:01+07:00',
    });

    const got = store.getLatestSummaryForUser('u1');
    expect(got?.id).toBe('sum-new');
  });

  it('existing SessionStore methods still work (backward compat)', () => {
    store.save('sess-resume-id');
    expect(store.get()).toBe('sess-resume-id');
    store.delete();
    expect(store.get()).toBeUndefined();
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
