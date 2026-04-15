// scripts/migrate-to-per-user-db.ts
// One-shot migration: copies messages from data/message.db into data/users/<userId>/app.db.
// Renames old global DBs to .bak (user can rm after verification).

import Database from 'better-sqlite3';
import { existsSync, renameSync, mkdirSync } from 'fs';
import { createUserDb } from '../src-v3/db/user-db.js';

const OLD_MESSAGE_DB = 'data/message.db';
const OLD_MEMORY_DB = 'data/memory.db';
const OLD_SESSIONS_DB = 'data/sessions.db';
const OLD_CRONJOBS_DB = 'data/cronjobs.db';
const USERS_DIR = 'data/users';

console.log('=== Per-user DB migration ===\n');

if (!existsSync(OLD_MESSAGE_DB)) {
  console.error(`✗ ${OLD_MESSAGE_DB} not found — nothing to migrate`);
  process.exit(1);
}

// 1. Open old message.db readonly
const oldDb = new Database(OLD_MESSAGE_DB, { readonly: true });

// 2. Find distinct user_ids
const userIds = oldDb.prepare<[], { user_id: string }>(
  'SELECT DISTINCT user_id FROM messages'
).all().map(r => r.user_id);

console.log(`Found ${userIds.length} distinct user_id(s): ${userIds.join(', ')}\n`);

// 3. For each user, copy their messages
mkdirSync(USERS_DIR, { recursive: true });

const selectByUser = oldDb.prepare<[string], any>(
  'SELECT * FROM messages WHERE user_id = ? ORDER BY timestamp ASC'
);

for (const userId of userIds) {
  console.log(`→ ${userId}`);
  const userDb = createUserDb(userId);

  const rows = selectByUser.all(userId);
  console.log(`  reading ${rows.length} messages from old DB`);

  let migrated = 0;
  for (const row of rows) {
    const { user_id, ...rest } = row;
    try {
      userDb.messages.insert(rest as any);
      migrated++;
    } catch (err: any) {
      if (!String(err.message).includes('UNIQUE')) throw err;
    }
  }
  console.log(`  ✓ inserted ${migrated} messages into ${USERS_DIR}/${userId}/app.db`);

  userDb.close();
}

oldDb.close();

// 4. Rename old global DBs to .bak
console.log('\n=== Renaming old global DBs to .bak ===');
for (const oldPath of [OLD_MESSAGE_DB, OLD_MEMORY_DB, OLD_SESSIONS_DB, OLD_CRONJOBS_DB]) {
  if (existsSync(oldPath)) {
    const bakPath = `${oldPath}.bak`;
    renameSync(oldPath, bakPath);
    console.log(`✓ ${oldPath} → ${bakPath}`);
    for (const ext of ['-wal', '-shm']) {
      if (existsSync(oldPath + ext)) {
        renameSync(oldPath + ext, bakPath + ext);
      }
    }
  }
}

console.log('\n=== Migration complete ===');
console.log('Verify: sqlite3 data/users/<userId>/app.db "SELECT COUNT(*) FROM messages;"');
console.log('After verification: rm data/*.db.bak data/*.db.bak-wal data/*.db.bak-shm');
