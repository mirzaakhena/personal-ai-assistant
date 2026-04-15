// scripts/test-rules-bundle.ts — Phase M5 smoke test: bundle re-shape with importance + caps

import { rmSync, existsSync } from 'fs';
import { createUserDb } from '../src-v3/db/user-db.js';

const TEST_DIR = 'data/_test_rules_bundle';
if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`✓ ${label}`);
  else { failures++; console.log(`✗ ${label}`); }
}

console.log('=== Phase M5 rules + bundle smoke test ===\n');

const userDb = createUserDb('u1', TEST_DIR);

// 1. Profile: 1 L3 + 1 L2 critical (allergy) + 20 L2 normal (test cap of 15)
userDb.memory.upsertProfile({
  category: 'identity', layer: 'L3', key: 'name', value: 'TestUser',
  confidence: null, source_session_id: null, source_msg_id: null,
});
userDb.memory.upsertProfile({
  category: 'rule', layer: 'L2', key: 'allergy_food', value: 'udang, kerang',
  confidence: null, source_session_id: null, source_msg_id: null, importance: 'critical',
});
for (let i = 0; i < 20; i++) {
  userDb.memory.upsertProfile({
    category: 'preference', layer: 'L2', key: `pref_${i}`, value: `value_${i}`,
    confidence: null, source_session_id: null, source_msg_id: null,
  });
}

// 2. Insert 12 ongoing journal entries (test cap of 10)
for (let i = 0; i < 12; i++) {
  userDb.memory.insertJournal({
    type: 'problem',
    content: `Ongoing problem ${i}`,
    status: 'ongoing',
    intensity: null, recurrence_count: 1, related_ids: null,
    event_date: null, event_outcome: null, follow_up_needed: 0,
    inferred_trait: null, confidence: null, promoted_to_trait_id: null,
    session_id: null, source_msg_id: null, resolved_at: null,
  });
}

// 3. Insert 5 tasks (mix priority + 1 done to exclude)
userDb.tasks.insert({ type: 'errand', title: 'Task low', notes: null, status: 'pending', priority: 'low', trigger_keywords: null, due_date: null, related_ids: null });
userDb.tasks.insert({ type: 'errand', title: 'Task high', notes: null, status: 'pending', priority: 'high', trigger_keywords: null, due_date: null, related_ids: null });
userDb.tasks.insert({ type: 'errand', title: 'Task medium', notes: null, status: 'pending', priority: 'medium', trigger_keywords: null, due_date: null, related_ids: null });
userDb.tasks.insert({ type: 'errand', title: 'Task done', notes: null, status: 'done', priority: 'medium', trigger_keywords: null, due_date: null, related_ids: null });
userDb.tasks.insert({ type: 'errand', title: 'Task null prio', notes: null, status: 'pending', priority: null, trigger_keywords: null, due_date: null, related_ids: null });

// 4. Insert 3 habits (2 active, 1 paused)
userDb.habits.insert({ title: 'H1', cadence_type: 'boolean', cadence_config: { period: 'day' }, status: 'active', notes: null });
userDb.habits.insert({ title: 'H2', cadence_type: 'count', cadence_config: { period: 'week', target: 3 }, status: 'active', notes: null });
userDb.habits.insert({ title: 'H3', cadence_type: 'slot', cadence_config: { period: 'day', slots: ['a', 'b'] }, status: 'paused', notes: null });

// 5. loadAlwaysBundle
const bundle = userDb.loadAlwaysBundle();

// Profile asserts
const l3Count = bundle.profile.filter(p => p.layer === 'L3').length;
const criticalCount = bundle.profile.filter(p => p.importance === 'critical').length;
const normalCount = bundle.profile.filter(p => p.layer === 'L2' && p.importance !== 'critical').length;
assert(l3Count === 1, `bundle includes 1 L3 (got ${l3Count})`);
assert(criticalCount === 1, `bundle includes 1 critical L2 (got ${criticalCount})`);
assert(normalCount === 15, `bundle includes top 15 L2 normal (got ${normalCount})`);
assert(bundle.profile.length === 17, `bundle.profile total = 17 (got ${bundle.profile.length})`);

// Ongoing asserts
assert(bundle.ongoing.length === 10, `bundle.ongoing capped at 10 (got ${bundle.ongoing.length})`);

// Tasks asserts
assert(bundle.tasks.length === 4, `bundle.tasks excludes done (4 pending, got ${bundle.tasks.length})`);
assert(bundle.tasks[0].priority === 'high', 'bundle.tasks: high priority first');

// Habits asserts
assert(bundle.habits.length === 2, `bundle.habits excludes paused (2 active, got ${bundle.habits.length})`);

userDb.close();
rmSync(TEST_DIR, { recursive: true, force: true });

console.log(`\n=== ${failures === 0 ? 'All checks passed' : `${failures} FAILED`} ===`);
if (failures > 0) process.exit(1);
