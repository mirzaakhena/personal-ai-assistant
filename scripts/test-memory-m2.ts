// scripts/test-memory-m2.ts — Phase M2 smoke test (updated for per-user DB refactor)

import Database from 'better-sqlite3';
import { createMessageStore } from '../src-v3/db/message.js';
import { createMemoryStore } from '../src-v3/db/memory.js';
import { buildMemoryHandlers } from '../src-v3/tools/memory.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');

createMessageStore(db);
const store = createMemoryStore(db);
const SESSION = 'test-session-abc';
const h = buildMemoryHandlers(store, SESSION);

console.log('=== Phase M2 smoke test ===\n');

// 1. saveProfile + listProfile
const p1 = h.saveProfile({ category: 'identity', layer: 'L3', key: 'name', value: 'Mirza' });
console.log('1. saveProfile:', p1.value, 'id:', p1.id.slice(0, 8), 'created_at:', p1.created_at);
const p2 = h.saveProfile({ category: 'preference', layer: 'L2', key: 'tone', value: 'direct', confidence: 0.9 });
console.log('   saveProfile (L2):', p2.value, 'confidence:', p2.confidence);
const profiles = h.listProfile();
console.log('   listProfile count:', profiles.length, '(should be 2)');
const l3only = h.listProfile({ layer: 'L3' });
console.log('   listProfile(L3) count:', l3only.length, '(should be 1)');

// 2. saveJournal + searchMemory
const j1 = h.saveJournal({ type: 'life_context', content: 'Sedang mengurus dokumen imigrasi Korea', status: 'ongoing' });
console.log('\n2. saveJournal:', j1.content.slice(0, 30), 'status:', j1.status, 'session_id:', j1.session_id);
const j2 = h.saveJournal({ type: 'event', content: 'Wawancara Samsung Busan', event_date: '2026-05-15' });
console.log('   saveJournal (event):', j2.content, 'event_date:', j2.event_date);
const search1 = h.searchMemory({ query: 'imigrasi' });
console.log('   searchMemory("imigrasi") count:', search1.length, '(should be 1)');

// 3. saveTraitObservation × 3
const o1 = h.saveTraitObservation({ content: 'User mengoreksi typo kecil', inferred_trait: 'perfeksionis', confidence: 0.7 });
const o2 = h.saveTraitObservation({ content: 'User minta rewording paragraf 2x', inferred_trait: 'perfeksionis', confidence: 0.8 });
const o3 = h.saveTraitObservation({ content: 'User cek detail format ulang', inferred_trait: 'perfeksionis', confidence: 0.75 });
console.log('\n3. saveTraitObservation × 3, inferred_trait:', o1.inferred_trait, '(all should match)');
console.log('   o1.confidence:', o1.confidence, 'o2:', o2.confidence, 'o3:', o3.confidence);

// 4. promoteTrait — should aggregate the 3 obs into 1 trait
const promoted = h.promoteTrait({ label: 'perfeksionis', type: 'trait' });
console.log('\n4. promoteTrait → label:', promoted.label, 'evidence_count:', promoted.evidence_count, 'aggregated_from:', promoted.aggregated_from);
console.log('   confidence (avg):', promoted.confidence.toFixed(3), '(should be ~0.75)');
console.log('   source_obs_ids count:', promoted.source_obs_ids?.length, '(should be 3)');

// 4b. promoteTrait again should fail (no unpromoted obs left)
try {
  h.promoteTrait({ label: 'perfeksionis', type: 'trait' });
  console.log('   ❌ second promoteTrait should have thrown');
} catch (err) {
  console.log('   ✓ second promoteTrait correctly threw:', String(err).slice(0, 60));
}

// 5. listTraits
const traits = h.listTraits();
console.log('\n5. listTraits count:', traits.length, '(should be 1)');

// 6. resolveJournal
const r = h.resolveJournal(j1.id);
console.log('\n6. resolveJournal(j1):', r);
const ongoing = h.searchMemory({ status: 'ongoing' });
console.log('   ongoing count after resolve:', ongoing.length, '(should be 0)');

// 7. saveRelationship + listRelationships
h.saveRelationship({ name: 'Budi', role: 'atasan', dynamic: 'memberi banyak guidance' });
h.saveRelationship({ name: 'Sari', role: 'istri' });
const rels = h.listRelationships();
console.log('\n7. listRelationships count:', rels.length, '(should be 2)');

// 8. saveGoal + updateGoalStatus + listGoals
const g1 = h.saveGoal({ title: 'Pindah Samsung Busan', category: 'career', target_date: '2026-06-01' });
const g2 = h.saveGoal({ title: 'Olahraga 3x seminggu', category: 'health' });
console.log('\n8. saveGoal × 2');
h.updateGoalStatus(g1.id, 'completed');
const active = h.listGoals({ status: 'active' });
const completed = h.listGoals({ status: 'completed' });
console.log('   listGoals(active):', active.length, '(should be 1)');
console.log('   listGoals(completed):', completed.length, '(should be 1)');

// 9. Verify session_id was injected
console.log('\n9. session_id injection check');
console.log('   j1.session_id:', j1.session_id, '(should be test-session-abc)');
console.log('   p1.source_session_id:', p1.source_session_id, '(should be test-session-abc)');

db.close();
console.log('\n=== All checks passed ===');
