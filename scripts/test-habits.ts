// scripts/test-habits.ts — Phase M5 smoke test: HabitStore all 5 cadence types

import Database from 'better-sqlite3';
import { createHabitStore } from '../src-v3/db/habits.js';

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');

const store = createHabitStore(db);

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`✓ ${label}`);
  else { failures++; console.log(`✗ ${label}`); }
}

console.log('=== Phase M5 habits smoke test ===\n');

// 1. SLOT habit (sholat)
const slotH = store.insert({
  title: 'Sholat 5 waktu',
  cadence_type: 'slot',
  cadence_config: { period: 'day', slots: ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'] },
  status: 'active',
  notes: null,
});
assert(slotH.id.length > 0, 'slot habit inserted');

store.logCompletion({ habit_id: slotH.id, slot: 'subuh' });
store.logCompletion({ habit_id: slotH.id, slot: 'dzuhur' });
const slotStatus = store.getStatus(slotH.id)!;
assert(slotStatus.done_this_period === 2, 'slot done_this_period = 2');
assert(slotStatus.target === 5, 'slot target = 5');
assert(slotStatus.progress_pct === 40, 'slot progress = 40%');

// 2. COUNT habit (olahraga)
const countH = store.insert({
  title: 'Olahraga 3x/minggu',
  cadence_type: 'count',
  cadence_config: { period: 'week', target: 3 },
  status: 'active',
  notes: null,
});
store.logCompletion({ habit_id: countH.id });
const countStatus = store.getStatus(countH.id)!;
assert(countStatus.done_this_period === 1, 'count done = 1');
assert(countStatus.target === 3, 'count target = 3');

// 3. QUANTITY habit (water)
const qH = store.insert({
  title: 'Minum 2L air',
  cadence_type: 'quantity',
  cadence_config: { period: 'day', target: 2000, unit: 'ml' },
  status: 'active',
  notes: null,
});
store.logCompletion({ habit_id: qH.id, value: 500 });
store.logCompletion({ habit_id: qH.id, value: 750 });
const qStatus = store.getStatus(qH.id)!;
assert(qStatus.done_this_period === 1250, 'quantity sum = 1250');
assert(qStatus.target === 2000, 'quantity target = 2000');
assert(qStatus.progress_pct === 63 || qStatus.progress_pct === 62, 'quantity progress ~63%');

// 4. BOOLEAN habit
const bH = store.insert({
  title: 'Baca al-Quran',
  cadence_type: 'boolean',
  cadence_config: { period: 'day' },
  status: 'active',
  notes: null,
});
const bStatusBefore = store.getStatus(bH.id)!;
assert(bStatusBefore.done_this_period === 0, 'boolean before = 0');

store.logCompletion({ habit_id: bH.id });
const bStatusAfter = store.getStatus(bH.id)!;
assert(bStatusAfter.done_this_period === 1, 'boolean after = 1');
assert(bStatusAfter.progress_pct === 100, 'boolean done = 100%');

// 5. DURATION habit
const dH = store.insert({
  title: 'Coding 1 jam/hari',
  cadence_type: 'duration',
  cadence_config: { period: 'day', target: 60, unit: 'min' },
  status: 'active',
  notes: null,
});
store.logCompletion({ habit_id: dH.id, value: 25 });
store.logCompletion({ habit_id: dH.id, value: 35 });
const dStatus = store.getStatus(dH.id)!;
assert(dStatus.done_this_period === 60, 'duration sum = 60');
assert(dStatus.target === 60, 'duration target = 60');
assert(dStatus.progress_pct === 100, 'duration 100%');

// 6. listActiveWithStatus returns all 5
const allActive = store.listActiveWithStatus();
assert(allActive.length === 5, 'listActiveWithStatus returns 5');

// 7. update status -> paused
store.update(slotH.id, { status: 'paused' });
const afterPause = store.listActiveWithStatus();
assert(afterPause.length === 4, 'paused habit excluded from active list');

// 8. period_key format check
const cRow = db.prepare<[string], { period_key: string }>('SELECT period_key FROM habit_completions WHERE habit_id = ? LIMIT 1').get(countH.id);
assert(cRow !== undefined && /^\d{4}-W\d{2}$/.test(cRow.period_key), 'count habit period_key matches YYYY-WNN');

const qRow = db.prepare<[string], { period_key: string }>('SELECT period_key FROM habit_completions WHERE habit_id = ? LIMIT 1').get(qH.id);
assert(qRow !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(qRow.period_key), 'day habit period_key matches YYYY-MM-DD');

db.close();
console.log(`\n=== ${failures === 0 ? 'All checks passed' : `${failures} FAILED`} ===`);
if (failures > 0) process.exit(1);
