// src-v4/db/message.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
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
