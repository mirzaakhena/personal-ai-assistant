// src/db/message.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createMessageStore, type MessageRecord } from './message.js';

function sampleRecord(id: string, ts: number, body: string): MessageRecord {
  return {
    id,
    gateway: 'console',
    session_id: 'sess-1',
    sender: 'user',
    timestamp: ts,
    type: 'text',
    body,
    has_media: 0,
    media_mimetype: null,
    media_filename: null,
    media_size: null,
    media_path: null,
    quoted_msg_id: null,
    is_forwarded: 0,
    raw_json: null,
  };
}

describe('MessageStore extensions', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createMessageStore>;

  beforeEach(() => {
    db = new Database(':memory:');
    store = createMessageStore(db);
  });

  it('getRecentMessages returns last N messages within time window, newest last', () => {
    for (const t of [100, 200, 300, 400, 500]) {
      store.insert(sampleRecord(`m${t}`, t, `msg at ${t}`));
    }

    const got = store.getRecentMessages({ limit: 3, since: 200 });

    // Expected: 300, 400, 500 (ascending so newest last for reading order)
    expect(got.map((m) => m.id)).toEqual(['m300', 'm400', 'm500']);
  });

  it('getRecentMessages respects limit when many messages in window', () => {
    for (const t of [100, 200, 300, 400, 500]) {
      store.insert(sampleRecord(`m${t}`, t, `msg`));
    }
    const got = store.getRecentMessages({ limit: 2, since: 0 });
    expect(got.map((m) => m.id)).toEqual(['m400', 'm500']);
  });

  it('getMessagesByIds returns matching records regardless of order', () => {
    store.insert(sampleRecord('a', 100, 'first'));
    store.insert(sampleRecord('b', 200, 'second'));
    store.insert(sampleRecord('c', 300, 'third'));

    const got = store.getMessagesByIds(['c', 'a']);
    const ids = got.map((m) => m.id).sort();
    expect(ids).toEqual(['a', 'c']);
  });

  it('getMessagesByIds returns empty array when no ids provided', () => {
    store.insert(sampleRecord('a', 100, 'x'));
    expect(store.getMessagesByIds([])).toEqual([]);
  });
});

describe('MessageStore — dashboard helpers', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'msg-dash-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  function mkRecord(over: Partial<MessageRecord>): MessageRecord {
    return {
      id: 'mX', gateway: 'console', session_id: 'S1', sender: 'user',
      timestamp: 1000, type: 'text', body: 'hi',
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null,
      quoted_msg_id: null, is_forwarded: 0, raw_json: null,
      ...over,
    };
  }

  it('listPage with sender filter + total count', () => {
    const s = createMessageStore(db);
    for (let i = 0; i < 7; i++) s.insert(mkRecord({ id: `m${i}`, timestamp: 1000 + i }));
    const r = s.listPage({ sender: 'user', limit: 5, offset: 0 });
    expect(r.total).toBe(7);
    expect(r.rows.length).toBe(5);
  });

  it('searchPage returns FTS snippets on body with <mark>', () => {
    const s = createMessageStore(db);
    s.insert(mkRecord({ id: 'm1', body: 'I love coffee in the morning' }));
    const r = s.searchPage('coffee', { limit: 10, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.hits[0].snippet).toContain('coffee');
    expect(r.hits[0].snippet).toContain('<mark>');
  });

  it('searchPage filters by sender', () => {
    const s = createMessageStore(db);
    s.insert(mkRecord({ id: 'a', sender: 'user',      body: 'coffee' }));
    s.insert(mkRecord({ id: 'b', sender: 'assistant', body: 'coffee', timestamp: 1001 }));
    const r = s.searchPage('coffee', { sender: 'user', limit: 10, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.hits[0].sender).toBe('user');
  });

  it('getThread returns all messages for a session ordered by timestamp DESC', () => {
    const s = createMessageStore(db);
    for (let i = 0; i < 3; i++) s.insert(mkRecord({ id: `m${i}`, timestamp: 1000 + i, body: `n${i}` }));
    const thread = s.getThread('S1', { limit: 100, offset: 0 });
    expect(thread.total).toBe(3);
    expect(thread.rows.map((r) => r.body)).toEqual(['n2', 'n1', 'n0']);
  });

  it('countByDay buckets timestamps by Jakarta YMD', () => {
    const s = createMessageStore(db);
    const day1 = Date.UTC(2026, 3, 20, 10);
    const day2 = Date.UTC(2026, 3, 21, 10);
    s.insert(mkRecord({ id: 'a', timestamp: day1 }));
    s.insert(mkRecord({ id: 'b', timestamp: day2 }));
    const buckets = s.countByDay({ sinceMs: day1 - 1000 });
    expect(buckets.length).toBeGreaterThanOrEqual(2);
    expect(buckets.reduce((a, b) => a + b.n, 0)).toBe(2);
  });
});
