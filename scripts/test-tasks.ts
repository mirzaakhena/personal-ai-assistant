// scripts/test-tasks.ts — Phase M5 smoke test: TaskStore CRUD + FTS5

import Database from 'better-sqlite3';
import { createTaskStore } from '../src-v3/db/tasks.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');

const store = createTaskStore(db);

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`✓ ${label}`);
  else { failures++; console.log(`✗ ${label}`); }
}

console.log('=== Phase M5 tasks smoke test ===\n');

// 1. Insert 3 tasks
const t1 = store.insert({
  type: 'errand', title: 'Beli sabun', notes: null, status: 'pending',
  priority: 'medium', trigger_keywords: ['pasar', 'belanja'], due_date: null, related_ids: null,
});
assert(t1.id.length > 0, 'insert errand returns id');
assert(t1.status === 'pending', 'default status pending');

const t2 = store.insert({
  type: 'grocery', title: 'Beli centong nasi', notes: null, status: 'pending',
  priority: 'low', trigger_keywords: ['pasar', 'rumah tangga'], due_date: null, related_ids: null,
});
const t3 = store.insert({
  type: 'errand', title: 'Titip kunci ke teman', notes: 'sebelum pulang kantor', status: 'pending',
  priority: 'high', trigger_keywords: ['kantor', 'pulang'], due_date: '2026-04-15', related_ids: null,
});

// 2. List by status
const pending = store.list({ status: 'pending' });
assert(pending.length === 3, 'list pending returns 3');

// 3. List by priority order
const byPriority = store.list({ status: 'pending', order: 'priority' });
assert(byPriority[0].id === t3.id, 'priority order: high first');

// 4. listPending shortcut
const pendingShort = store.listPending();
assert(pendingShort.length === 3 && pendingShort[0].id === t3.id, 'listPending sorts by priority');

// 5. FTS5 search
const searchPasar = store.search({ query: 'pasar' });
assert(searchPasar.length === 2, 'FTS5 search "pasar" returns 2 (sabun + centong)');

const searchKunci = store.search({ query: 'kunci' });
assert(searchKunci.length === 1 && searchKunci[0].id === t3.id, 'FTS5 search "kunci" returns titip-kunci task');

// 6. complete (via update)
const completed = store.update(t1.id, { status: 'done' });
assert(completed?.status === 'done', 'update status to done');
assert(completed?.completed_at !== null, 'completed_at set');

// 7. list pending after completion
const pendingAfter = store.list({ status: 'pending' });
assert(pendingAfter.length === 2, 'pending count drops to 2 after complete');

// 8. update keyword
const updatedKw = store.update(t2.id, { trigger_keywords: ['supermarket', 'pasar'] });
assert(updatedKw?.trigger_keywords?.includes('supermarket') === true, 'update trigger_keywords works');

// 9. delete
const deleted = store.delete(t3.id);
assert(deleted === true, 'delete returns true');
assert(store.getById(t3.id) === undefined, 'getById returns undefined after delete');

// 10. Idempotent: delete non-existent
const deletedAgain = store.delete('nonexistent-id');
assert(deletedAgain === false, 'delete non-existent returns false');

db.close();
console.log(`\n=== ${failures === 0 ? 'All checks passed' : `${failures} FAILED`} ===`);
if (failures > 0) process.exit(1);
