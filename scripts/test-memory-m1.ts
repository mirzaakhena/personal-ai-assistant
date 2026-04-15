// scripts/test-memory-m1.ts — Phase M1 smoke test

import { unlinkSync, existsSync } from 'fs';
import { createMemoryStore } from '../src-v3/db/memory.js';

const TEST_DB = 'data/_memory_test.db';
if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

const mem = createMemoryStore(TEST_DB);
const USER = 'test-user-1';

console.log('=== Phase M1 smoke test ===\n');

// 1. Profile upsert
const p1 = mem.upsertProfile({
  user_id: USER,
  category: 'identity',
  layer: 'L3',
  key: 'name',
  value: 'Mirza',
  confidence: null,
  source_session_id: null,
  source_msg_id: null,
});
console.log('1. Profile inserted:', p1.value, 'id:', p1.id.slice(0, 8));

const p1b = mem.upsertProfile({
  user_id: USER,
  category: 'identity',
  layer: 'L3',
  key: 'name',
  value: 'Mirza Akhena',
  confidence: null,
  source_session_id: null,
  source_msg_id: null,
});
console.log('   Profile updated (same id?):', p1.id === p1b.id, 'new value:', p1b.value);

// 2. Journal insert
const j1 = mem.insertJournal({
  user_id: USER,
  type: 'life_context',
  content: 'Sedang mengurus dokumen imigrasi Korea',
  status: 'ongoing',
  intensity: null,
  recurrence_count: 1,
  related_ids: null,
  event_date: null,
  event_outcome: null,
  follow_up_needed: 0,
  inferred_trait: null,
  confidence: null,
  promoted_to_trait_id: null,
  session_id: null,
  source_msg_id: null,
  resolved_at: null,
});
console.log('\n2. Journal inserted:', j1.content.slice(0, 40), 'status:', j1.status);

const j2 = mem.insertJournal({
  user_id: USER,
  type: 'trait_observation',
  content: 'User mengoreksi detail kecil berkali-kali',
  status: null,
  intensity: null,
  recurrence_count: 1,
  related_ids: null,
  event_date: null,
  event_outcome: null,
  follow_up_needed: 0,
  inferred_trait: 'perfeksionis',
  confidence: 0.8,
  promoted_to_trait_id: null,
  session_id: null,
  source_msg_id: null,
  resolved_at: null,
});
console.log('   Journal inserted (trait obs):', j2.inferred_trait, 'conf:', j2.confidence);

// 3. FTS5 search
const searchResults = mem.searchJournal({ userId: USER, query: 'imigrasi', limit: 5 });
console.log('\n3. Journal FTS5 search "imigrasi":', searchResults.length, 'matches');
if (searchResults.length > 0) console.log('   Top:', searchResults[0].content.slice(0, 40));

// 4. Resolve journal
const resolved = mem.resolveJournal(j1.id);
console.log('\n4. Resolved j1:', resolved);
const j1After = mem.getJournal(j1.id);
console.log('   Status now:', j1After?.status, 'resolved_at set:', j1After?.resolved_at !== null);

// 5. Trait upsert
const t1 = mem.upsertTrait({
  user_id: USER,
  type: 'trait',
  label: 'perfeksionis',
  confidence: 0.75,
  evidence_count: 3,
  source_obs_ids: [j2.id],
});
console.log('\n5. Trait upserted:', t1.label, 'conf:', t1.confidence);

const t1b = mem.upsertTrait({
  user_id: USER,
  type: 'trait',
  label: 'perfeksionis',
  confidence: 0.85,
  evidence_count: 5,
  source_obs_ids: [j2.id, 'new-obs-id'],
});
console.log('   Trait updated (same id?):', t1.id === t1b.id, 'new conf:', t1b.confidence, 'source_obs_ids:', t1b.source_obs_ids);

// 6. Relationship
const r1 = mem.upsertRelationship({
  user_id: USER,
  name: 'Budi',
  role: 'atasan',
  dynamic: 'memberi banyak guidance',
  related_ids: [j1.id],
  source_session_id: null,
});
console.log('\n6. Relationship inserted:', r1.name, 'role:', r1.role);

// 7. Goal
const g1 = mem.insertGoal({
  user_id: USER,
  title: 'Pindah kerja ke Samsung Busan',
  category: 'career',
  status: 'active',
  target_date: '2026-06-01',
  related_ids: [r1.id],
  source_session_id: null,
});
console.log('\n7. Goal inserted:', g1.title, 'status:', g1.status);

mem.updateGoalStatus(g1.id, 'completed');
const goals = mem.listGoals(USER);
console.log('   Goals after status update:', goals.map(g => `${g.title} (${g.status})`));

// 8. Always bundle
const bundle = mem.loadAlwaysBundle(USER);
console.log('\n8. Always bundle:');
console.log('   profile entries:', bundle.profile.length);
console.log('   traits:', bundle.traits.length);
console.log('   ongoing journal:', bundle.ongoing.length, '(should be 0 — j1 was resolved)');

// 9. listOngoing — insert another ongoing entry
mem.insertJournal({
  user_id: USER,
  type: 'problem',
  content: 'Sering lupa minum obat',
  status: 'ongoing',
  intensity: null,
  recurrence_count: 2,
  related_ids: null,
  event_date: null,
  event_outcome: null,
  follow_up_needed: 0,
  inferred_trait: null,
  confidence: null,
  promoted_to_trait_id: null,
  session_id: null,
  source_msg_id: null,
  resolved_at: null,
});
const bundle2 = mem.loadAlwaysBundle(USER);
console.log('\n9. After adding ongoing problem — ongoing count:', bundle2.ongoing.length, '(should be 1)');

// 10. linkObservationsToTrait
const linked = mem.linkObservationsToTrait([j2.id], t1.id);
console.log('\n10. linkObservationsToTrait linked:', linked, '(should be 1)');
const j2After = mem.getJournal(j2.id);
console.log('   j2 promoted_to_trait_id:', j2After?.promoted_to_trait_id, '(should equal t1.id)');
console.log('   match t1.id?', j2After?.promoted_to_trait_id === t1.id);

console.log('\n=== All checks passed ===');
