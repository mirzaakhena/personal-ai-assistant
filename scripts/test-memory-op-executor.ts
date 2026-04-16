// scripts/test-memory-op-executor.ts — smoke test for op dispatch

import { rmSync, existsSync } from 'fs';
import { createUserDb } from '../src-v3/db/user-db.js';
import { executeMemoryOps } from '../src-v3/utils/memory-op-executor.js';

const TEST_DIR = 'data/_test_memory_op_executor';
if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`✓ ${label}`);
  else { failures++; console.log(`✗ ${label}`); }
}

console.log('=== memory-op-executor smoke test ===\n');

const userDb = createUserDb('u1', TEST_DIR);

// Seed a messages row so source_msg_id FK passes
userDb.messages.insert({
  id: 'src-msg-1', gateway: 'test', session_id: null, sender: 'user',
  timestamp: Date.now(), type: 'text', body: 'seed', has_media: 0,
  media_mimetype: null, media_filename: null, media_size: null,
  media_path: null, quoted_msg_id: null, is_forwarded: 0, raw_json: null,
});

const ops = [
  { op: 'save_profile', category: 'identity', layer: 'L3', key: 'name', value: 'Mirza' },
  { op: 'save_profile', category: 'rule', layer: 'L3', key: 'allergy_food', value: 'udang', importance: 'critical' },
  { op: 'save_relationship', name: 'Tika', role: 'istri' },
  { op: 'save_goal', title: 'Pindah Samsung', category: 'career', status: 'active' },
  { op: 'save_journal', type: 'life_context', content: 'Trip ke Busan', status: 'ongoing' },
  { op: 'save_trait_observation', inferred_trait: 'perfeksionis', confidence: 0.8, content: 'User rechecked 3x' },
  { op: 'save_conversation_summary', content: 'Session talked about trip planning' },
  { op: 'unknown_op', title: 'should-skip' },
];

const result = executeMemoryOps(userDb, ops, 'src-msg-1', 's-001');
assert(result.executed === 7, `7 ops executed (got ${result.executed})`);
assert(result.skipped === 1, `1 op skipped (got ${result.skipped})`);
assert(result.errors.length === 1, `1 error recorded (got ${result.errors.length})`);

const profiles = userDb.memory.listProfile();
assert(profiles.length === 2, `2 profile entries (got ${profiles.length})`);
const allergy = profiles.find(p => p.key === 'allergy_food');
assert(allergy !== undefined && allergy.importance === 'critical', 'allergy importance=critical');

const rels = userDb.memory.listRelationships();
assert(rels.length === 1 && rels[0].name === 'Tika', 'relationship Tika saved');

const goals = userDb.memory.listGoals();
assert(goals.length === 1 && goals[0].title === 'Pindah Samsung', 'goal saved');

const allOngoing = userDb.memory.listOngoing();
assert(allOngoing.length === 1, 'life_context ongoing saved');

const allTraitObs = userDb.memory.searchJournal({ type: 'trait_observation' });
assert(allTraitObs.length === 1 && allTraitObs[0].inferred_trait === 'perfeksionis', 'trait observation saved');

const summaries = userDb.memory.searchJournal({ type: 'conversation_summary' });
assert(summaries.length === 1, 'conversation_summary saved');

assert(allOngoing[0].source_msg_id === 'src-msg-1', 'source_msg_id linked');
assert(allOngoing[0].session_id === 's-001', 'session_id linked');

userDb.close();
rmSync(TEST_DIR, { recursive: true, force: true });

console.log(`\n=== ${failures === 0 ? 'All checks passed' : `${failures} FAILED`} ===`);
if (failures > 0) process.exit(1);
