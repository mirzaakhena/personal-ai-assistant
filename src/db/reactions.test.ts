// src/db/reactions.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReactionStore, type ReactionRecord } from './reactions.js';

describe('ReactionStore — count + listPage', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'rxn-cnt-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  function mk(over: Partial<Omit<ReactionRecord, 'id'>>): Omit<ReactionRecord, 'id'> {
    return {
      message_id: 'msg-1',
      actor: 'user',
      old_emojis: [],
      new_emojis: ['👍'],
      timestamp: Date.now(),
      ...over,
    };
  }

  it('count + listPage with offset', () => {
    const s = createReactionStore(db);
    s.insert(mk({ message_id: 'msg-1', timestamp: 1000 }));
    s.insert(mk({ message_id: 'msg-2', timestamp: 2000 }));
    s.insert(mk({ message_id: 'msg-3', timestamp: 3000 }));

    expect(s.count()).toBe(3);

    const r = s.listPage({ limit: 2, offset: 1 });
    expect(r.rows.length).toBe(2);
    expect(r.total).toBe(3);
  });

  it('listPage filters by actor', () => {
    const s = createReactionStore(db);
    s.insert(mk({ actor: 'user', message_id: 'msg-u' }));
    s.insert(mk({ actor: 'assistant', message_id: 'msg-a' }));

    const r = s.listPage({ actor: 'user', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.rows[0].actor).toBe('user');
  });

  it('listPage returns rows ordered by timestamp DESC', () => {
    const s = createReactionStore(db);
    s.insert(mk({ message_id: 'msg-a', timestamp: 1000 }));
    s.insert(mk({ message_id: 'msg-b', timestamp: 3000 }));
    s.insert(mk({ message_id: 'msg-c', timestamp: 2000 }));

    const r = s.listPage({ limit: 10, offset: 0 });
    expect(r.rows[0].message_id).toBe('msg-b');
    expect(r.rows[1].message_id).toBe('msg-c');
    expect(r.rows[2].message_id).toBe('msg-a');
  });

  it('count returns 0 on empty table', () => {
    const s = createReactionStore(db);
    expect(s.count()).toBe(0);
  });
});
