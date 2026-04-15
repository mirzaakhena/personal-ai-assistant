// scripts/test-user-db-cache.ts — Phase M3.5 smoke test: UserDbCache

import { rmSync, existsSync } from 'fs';
import { createUserDbCache } from '../src-v3/db/user-db-cache.js';

const TEST_DIR = 'data/_test_user_db_cache';
if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`✓ ${label}`);
  else { failures++; console.log(`✗ ${label}`); }
}

console.log('=== Phase M3.5 UserDbCache smoke test ===\n');

const cache = createUserDbCache(TEST_DIR);

// 1. Initial listKnownUsers is empty
assert(cache.listKnownUsers().length === 0, 'listKnownUsers() empty initially');

// 2. get('u1') lazy-opens
const u1a = cache.get('u1');
assert(existsSync(`${TEST_DIR}/u1/app.db`), 'first get() creates folder + DB');
assert(u1a.userId === 'u1', 'userDb.userId correct');

// 3. Second get('u1') returns same instance
const u1b = cache.get('u1');
assert(u1a === u1b, 'second get() returns same cached instance (reference equality)');

// 4. Different userId opens different DB
const u2 = cache.get('u2');
assert(u2 !== u1a, 'get("u2") returns different instance');
assert(existsSync(`${TEST_DIR}/u2/app.db`), 'second user folder created');

// 5. listKnownUsers returns both
const known = cache.listKnownUsers().sort();
assert(known.length === 2 && known[0] === 'u1' && known[1] === 'u2', 'listKnownUsers returns [u1, u2]');

// 6. closeAll clears cache
cache.closeAll();
assert(true, 'closeAll() completed without error');

// 7. Cleanup
rmSync(TEST_DIR, { recursive: true, force: true });
assert(!existsSync(TEST_DIR), 'cleanup removed test dir');

console.log(`\n=== ${failures === 0 ? 'All checks passed' : `${failures} FAILED`} ===`);
if (failures > 0) process.exit(1);
