// scripts/test-user-db.ts — Phase M3.5 smoke test: per-user DB factory

import { rmSync, existsSync } from 'fs';
import Database from 'better-sqlite3';
import { createUserDb } from '../src-v3/db/user-db.js';

const TEST_DIR = 'data/_test_user_db';
if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });

let failures = 0;
function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`✓ ${label}`);
  else { failures++; console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

console.log('=== Phase M3.5 UserDb smoke test ===\n');

// 1. createUserDb creates folder + file
const userDb = createUserDb('u1', TEST_DIR);
assert(existsSync(`${TEST_DIR}/u1/app.db`), 'createUserDb: app.db file created');
assert(userDb.userId === 'u1', 'userDb.userId matches');

// 2. All 8 tables present (check via sqlite_master)
const db = new Database(`${TEST_DIR}/u1/app.db`, { readonly: true });
const tables = db.prepare<[], { name: string }>(
  `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
).all().map(r => r.name);
db.close();

const expected = [
  'cronjob_executions', 'cronjobs',
  'goals', 'journal',
  'messages', 'profile',
  'relationships', 'sessions',
  'traits',
];
for (const t of expected) {
  assert(tables.includes(t), `table present: ${t}`);
}
assert(tables.some(t => t.startsWith('journal_fts')), 'FTS5 journal_fts shadow tables exist');
assert(tables.some(t => t.startsWith('messages_fts')), 'FTS5 messages_fts shadow tables exist');

// 3. Insert through each store
userDb.memory.upsertProfile({
  category: 'identity', layer: 'L3', key: 'name', value: 'TestUser',
  confidence: null, source_session_id: null, source_msg_id: null,
});
assert(userDb.memory.listProfile().length === 1, 'memory store insert + list works');

userDb.messages.insert({
  id: 'msg-1', gateway: 'test', session_id: null, sender: 'user',
  timestamp: Date.now(), type: 'text', body: 'hello', has_media: 0,
  media_mimetype: null, media_filename: null, media_size: null,
  media_path: null, quoted_msg_id: null, is_forwarded: 0, raw_json: null,
});
assert(userDb.messages.count() === 1, 'messages store insert + count works');

userDb.sessions.save('sess-xyz');
assert(userDb.sessions.get() === 'sess-xyz', 'sessions store save + get works');

// 4. FK enforcement: insert journal with non-existent source_msg_id
try {
  userDb.memory.insertJournal({
    type: 'problem', content: 'bad FK test',
    status: null, intensity: null, recurrence_count: 1,
    related_ids: null, event_date: null, event_outcome: null,
    follow_up_needed: 0, inferred_trait: null, confidence: null,
    promoted_to_trait_id: null, session_id: null,
    source_msg_id: 'nonexistent-msg-id',  // ← FK violation
    resolved_at: null,
  });
  assert(false, 'FK enforcement blocks journal.source_msg_id → unknown msg');
} catch (err) {
  assert(String(err).includes('FOREIGN KEY'), 'FK enforcement correctly rejects bad source_msg_id', String(err).slice(0, 80));
}

// 5. Valid FK: insert journal with existing source_msg_id
const j = userDb.memory.insertJournal({
  type: 'problem', content: 'with valid FK',
  status: null, intensity: null, recurrence_count: 1,
  related_ids: null, event_date: null, event_outcome: null,
  follow_up_needed: 0, inferred_trait: null, confidence: null,
  promoted_to_trait_id: null, session_id: null,
  source_msg_id: 'msg-1',  // ← exists
  resolved_at: null,
});
assert(j.source_msg_id === 'msg-1', 'journal with valid source_msg_id inserted');

// 6. Cronjobs
userDb.cronjobs.insertJob({
  id: 'c-1', message: 'test', type: 'once',
  schedule_cron: null, schedule_human: 'once',
  scheduled_at: Date.now() + 3600_000, end_date: null,
  status: 'PENDING', created_at: Date.now(), updated_at: Date.now(),
});
assert(userDb.cronjobs.getJobs().length === 1, 'cronjobs insertJob + getJobs works');

userDb.close();

// 7. Cleanup
rmSync(TEST_DIR, { recursive: true, force: true });
assert(!existsSync(TEST_DIR), 'cleanup removed test dir');

console.log(`\n=== ${failures === 0 ? 'All checks passed' : `${failures} FAILED`} ===`);
if (failures > 0) process.exit(1);
