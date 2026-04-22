// scripts/migrate-v5-memory.ts
//
// One-shot, single-user v5 memory migration for console-user.
// Backs up app.db, reads source rows, drops old tables, creates new tables,
// applies mapping per docs/superpowers/specs/2026-04-22-v5-memory-redesign-design.md
//
// Usage:
//   pnpm tsx scripts/migrate-v5-memory.ts --dry-run
//   pnpm tsx scripts/migrate-v5-memory.ts

import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Config ──────────────────────────────────────────
const USER_ID = process.env.V5_MIGRATE_USER_ID ?? 'console-user';
const BASE_DIR = process.env.V5_MIGRATE_BASE_DIR ?? 'data/users';
const DB_PATH = join(BASE_DIR, USER_ID, 'app.db');

const DRY_RUN = process.argv.includes('--dry-run');

// ── Expected counts (for post-migration verification) ──
const EXPECTED = {
  profile_min: 5,          // at least 5 slots populated from source
  preferences_exact: 10,   // always 10 per design
  knowledge_min: 40,       // base rows (identity/person/routine/context + insight seeds) before trait_observations
  tasks_max: 10,           // existing 3 preserved; tolerance for a few
};

// ── Source types (legacy schema) ────────────────────

export interface LegacyProfileRow {
  id?: string;
  category: string;
  layer: string;
  key: string;
  value: string;
}

export interface LegacyRelationshipRow {
  id: string;
  name: string;
  role: string | null;
  dynamic: string | null;
  circle: string | null;
}

export interface LegacyHabitRow {
  id: string;
  title: string;
  cadence_type: string;
  cadence_config: string;
  notes: string | null;
}

export interface LegacyJournalRow {
  id: string;
  type: string;
  content: string;
  status: string | null;
  event_date: string | null;
  source_msg_id: string | null;
  created_at: number;
}

// ── Target types ────────────────────────────────────

export interface ProfileSeed { key: string; value: string; }
export interface PreferenceSeed { kind: 'rule' | 'style'; key: string; value: string; }
export interface KnowledgeSeed { category: string; key: string; value: string; source_msg_id?: string | null; }

// ── Pure transforms ─────────────────────────────────

const PROFILE_VALID_KEYS = new Set([
  'name', 'called_as', 'language', 'timezone',
  'home_location', 'current_location', 'active_hours',
]);

export function deriveProfileFromLegacy(rows: LegacyProfileRow[]): Record<string, string> {
  const idx = new Map<string, string>();
  for (const r of rows) idx.set(`${r.category}|${r.key}`, r.value);

  const out: Record<string, string> = {};

  const name = idx.get('identity|name');
  if (name) out.name = name;

  out.called_as = 'Mirz'; // from recent chat evidence; user confirmed

  const lang = idx.get('preference|bahasa_komunikasi');
  if (lang?.toLowerCase().includes('indonesia')) out.language = 'id';

  const tzPref = idx.get('rule|timezone_preference') ?? '';
  if (/\bkst\b/i.test(tzPref) || /Asia\/Seoul/.test(tzPref)) out.timezone = 'Asia/Seoul';
  else if (/\bwib\b/i.test(tzPref)) out.timezone = 'Asia/Jakarta';

  const home = idx.get('identity|location');
  if (home) out.home_location = home;

  const cur = idx.get('identity|lokasi_saat_ini');
  if (cur) out.current_location = cur;

  const jam = idx.get('identity|jam_aktif');
  if (jam) out.active_hours = jam;

  return out;
}

/** Preference seeds are hardcoded per spec §9.1; legacy rows used for source attribution only. */
export function buildPreferenceSeeds(_rows: LegacyProfileRow[]): PreferenceSeed[] {
  return [
    { kind: 'rule', key: 'food_halal',
      value: 'Hanya halal — prioritaskan restoran halal atau area dengan komunitas Muslim.' },
    { kind: 'rule', key: 'prayer_time_source_busan',
      value: 'Selama di Korea, ikuti jadwal masjid fisik setempat (Al-Aqsha/Imam Bukhari), bukan sumber online.' },
    { kind: 'rule', key: 'observe_daily_prayers',
      value: 'Mirza observes 5 daily prayers; jangan schedule yang berkonflik dengan waktu sholat.' },
    { kind: 'style', key: 'language_tic_islamic',
      value: 'Sisipkan insyaAllah/alhamdulillah/subhanallah saat konteksnya pas (adab Muslim).' },
    { kind: 'style', key: 'casual_register',
      value: 'Friendly teman ngobrol, bukan asisten formal.' },
    { kind: 'style', key: 'unpredictable_checkins',
      value: 'Hubungi beberapa kali sehari di waktu yang tidak terjadwal.' },
    { kind: 'style', key: 'proactive_followup',
      value: 'Aktif kepo & set cronjob follow-up tanpa diminta saat user mention sesuatu yang ditunggu.' },
    { kind: 'style', key: 'memory_save_initiative',
      value: 'Proaktif save momen penting ke journal tanpa diminta.' },
    { kind: 'style', key: 'summarize_not_dump',
      value: 'Berikan rangkuman, bukan teks penuh.' },
    { kind: 'style', key: 'argumentative_discussion',
      value: 'Aktif bantah/challenge ide user; bukan yes-man. User suka diskusi bantah-membantah yang sehat.' },
  ];
}

export function buildKnowledgeSeedsFromLegacyProfile(rows: LegacyProfileRow[]): KnowledgeSeed[] {
  const idx = new Map<string, string>();
  for (const r of rows) idx.set(`${r.category}|${r.key}`, r.value);
  const get = (ck: string) => idx.get(ck);

  const seeds: KnowledgeSeed[] = [];
  const addIf = (cat: string, key: string, src: string | undefined, transform?: (v: string) => string) => {
    if (src) seeds.push({ category: cat, key, value: transform ? transform(src) : src });
  };

  // identity (14)
  addIf('identity', 'github_username', get('identity|github_username'));
  addIf('identity', 'phone', get('identity|phone'));
  addIf('identity', 'hp_model_xiaomi', get('identity|hp_model'));
  addIf('identity', 'kendaraan_nissan', get('identity|kendaraan'));
  addIf('identity', 'penampilan_fisik', get('identity|penampilan_fisik'));
  addIf('identity', 'keyboard_nuphy', get('preference|keyboard_model'));
  addIf('identity', 'hobi_coding', get('preference|hobi'));
  addIf('identity', 'religion_muslim', get('rule|agama'));
  addIf('identity', 'employment_status', get('identity|employment_status'));
  addIf('identity', 'profession_background', get('identity|profession_background'));
  addIf('identity', 'pekerjaan_korea_smartm2m', get('identity|pekerjaan_korea'));
  addIf('identity', 'residence_korea_arc', get('identity|residence_korea'));
  addIf('identity', 'arc_timeline_2025', get('identity|arc_first_issuance_timeline'));
  addIf('identity', 'work_hours_korea_detail', get('identity|work_hours_korea'));

  // routine (8, some merged from habits — see buildKnowledgeSeedsFromLegacyHabits)
  addIf('routine', 'youtube_tech_evening_coding', get('preference|kebiasaan_belajar'));
  const meat = get('rule|makan_daging_sisihkan');
  const sate = get('rule|sate_bumbu_kacang');
  if (meat || sate) {
    seeds.push({
      category: 'routine', key: 'meat_leftovers_strategy',
      value: [meat, sate].filter(Boolean).join(' | '),
    });
  }

  // context (12)
  addIf('context', 'halal_food_busan', get('preference|halal_food_busan'));
  addIf('context', 'masjid_favorit_busan', get('preference|masjid_favorit_busan'));
  addIf('context', 'belanja_emart_busan', get('preference|tempat_belanja_busan'));
  addIf('context', 'perlengkapan_travel_kit', get('preference|perlengkapan_travel'));
  const jadwal = get('rule|jadwal_sholat_wib');
  const windows = get('rule|prayer_reminder_windows');
  if (jadwal || windows) {
    seeds.push({
      category: 'context', key: 'prayer_schedule_wib',
      value: [jadwal, windows].filter(Boolean).join(' | '),
    });
  }
  const prayerBusan = get('rule|prayer_time_busan');
  if (prayerBusan) {
    seeds.push({
      category: 'context', key: 'prayer_schedule_kst',
      value: `Partial (hanya Ashar 17:05 KST dikonfirmasi). Source-of-truth: lihat preference prayer_time_source_busan. Raw: ${prayerBusan}`,
    });
  }
  addIf('context', 'menu_sahur_ramadan', get('preference|menu_sahur_tipikal'));
  addIf('context', 'transportasi_bandung', get('preference|transportasi_lokal'));
  addIf('context', 'office_checkin_procedure_korea', get('rule|checkin_checkout_kantor_korea'));
  addIf('context', 'esim_javamifi_config', get('rule|esim_javamifi'));
  addIf('context', 'riwayat_trip_korea', get('preference|riwayat_trip_korea'));
  addIf('context', 'takeaway_dining_strategy', get('preference|makan_luar_strategy'));

  // insight (4 seeds; trait_observations appended from journal later)
  addIf('insight', 'productivity_matrix', get('cognitive_style|productivity_matrix'));
  addIf('insight', 'pola_eksplorasi_teknis_bottom_up', get('cognitive_style|pola_eksplorasi_teknis'));
  addIf('insight', 'reframing_expenses_as_investment', get('cognitive_style|reframing_as_investment'));
  addIf('insight', 'pandangan_ai_dan_programming', get('value_belief|pandangan_ai_dan_programming'));

  return seeds;
}

export function buildKnowledgeSeedsFromLegacyRelationships(rows: LegacyRelationshipRow[]): KnowledgeSeed[] {
  const nameToSlug: Record<string, string> = {
    'Omar': 'anak_omar',
    'Zunan': 'anak_zunan',
    'Saina': 'keponakan_saina',
    'Kak Iti': 'kakak_iti',
    'TDB': 'kucing_tdb',
    'Muhammad': 'kenalan_muhammad_korea',
    '손예진 (Son Yejin)': 'hrd_yejin_smartm2m',
    'Ludwiyk Ruben': 'pakrt_ruben_bandung',
  };

  const seeds: KnowledgeSeed[] = rows.map((r) => ({
    category: 'person',
    key: nameToSlug[r.name] ?? slugifyContent(r.name, 40),
    value: [r.role, r.dynamic].filter(Boolean).join(' — '),
  }));

  // Add inferred istri_tika (per spec §9.2)
  seeds.push({
    category: 'person', key: 'istri_tika',
    value: 'Tika — istri Mirza. Tinggal di rumah (Bandung) saat Mirza bekerja di Korea.',
  });

  return seeds;
}

export function buildKnowledgeSeedsFromLegacyHabits(rows: LegacyHabitRow[]): KnowledgeSeed[] {
  const byTitle: Record<string, { key: string; category: string }> = {
    'Mengembangkan project coding': { key: 'daily_coding', category: 'routine' },
    'Ngoding di kafe': { key: 'work_at_cafe', category: 'routine' },
    'Masak sendiri dengan rice cooker': { key: 'cooking_rice_cooker_korea', category: 'routine' },
    'Tidur siang di mobil': { key: 'power_nap_car', category: 'routine' },
    'Olahraga': { key: 'exercise_3x_week_target', category: 'routine' },
    'Minum obat darah tinggi': { key: 'medication_hypertension_nightly', category: 'routine' },
  };

  const seeds: KnowledgeSeed[] = [];
  for (const h of rows) {
    const map = byTitle[h.title];
    if (!map) continue; // drop: Sholat 5 waktu, Sholat Jumat, Update berita AI, Catat pengeluaran
    seeds.push({
      category: map.category, key: map.key,
      value: h.notes ?? h.title,
    });
  }
  return seeds;
}

/** Produce a stable snake_case key from a content prefix. */
export function slugifyContent(content: string, limit: number): string {
  const normalized = content
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase();
  const snake = normalized
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return snake.slice(0, limit).replace(/_+$/, '');
}

// ── Source readers ──────────────────────────────────

interface SourceSnapshot {
  profile: LegacyProfileRow[];
  relationships: LegacyRelationshipRow[];
  habits: LegacyHabitRow[];
  journalTraitObservations: LegacyJournalRow[];
  journalOther: LegacyJournalRow[];
  tasks: Array<{
    id: string; title: string; notes: string | null;
    status: string | null; due_date: string | null;
    created_at: number; updated_at: number;
  }>;
}

function readSource(db: Database.Database): SourceSnapshot {
  const profile = db.prepare<[], LegacyProfileRow>(
    `SELECT id, category, layer, key, value FROM profile`
  ).all();

  const relationships = db.prepare<[], LegacyRelationshipRow>(
    `SELECT id, name, role, dynamic, circle FROM relationships`
  ).all();

  const habits = db.prepare<[], LegacyHabitRow>(
    `SELECT id, title, cadence_type, cadence_config, notes FROM habits`
  ).all();

  const journalAll = db.prepare<[], LegacyJournalRow>(`
    SELECT id, type, content, status, event_date, source_msg_id, created_at
    FROM journal
  `).all();

  const journalTraitObservations = journalAll.filter(j => j.type === 'trait_observation');
  const journalOther = journalAll.filter(
    j => j.type !== 'trait_observation' && j.type !== 'conversation_summary'
  );

  const tasks = db.prepare<[]>(
    `SELECT id, title, notes, status, due_date, created_at, updated_at FROM tasks`
  ).all() as SourceSnapshot['tasks'];

  return { profile, relationships, habits, journalTraitObservations, journalOther, tasks };
}

// ── Destructive DDL ─────────────────────────────────

const DROP_OLD_TABLES = `
  DROP TABLE IF EXISTS profile;
  DROP TABLE IF EXISTS relationships;
  DROP TABLE IF EXISTS habits;
  DROP TABLE IF EXISTS habit_completions;
  DROP TABLE IF EXISTS populate_runs;
  DROP TABLE IF EXISTS journal_fts_config;
  DROP TABLE IF EXISTS journal_fts_data;
  DROP TABLE IF EXISTS journal_fts_docsize;
  DROP TABLE IF EXISTS journal_fts_idx;
  DROP TABLE IF EXISTS journal_fts;
  DROP TABLE IF EXISTS tasks_fts_config;
  DROP TABLE IF EXISTS tasks_fts_data;
  DROP TABLE IF EXISTS tasks_fts_docsize;
  DROP TABLE IF EXISTS tasks_fts_idx;
  DROP TABLE IF EXISTS tasks_fts;
  DROP TABLE IF EXISTS tasks;
  DROP TABLE IF EXISTS journal;
`;

// ── Entry point ─────────────────────────────────────
function main() {
  if (!existsSync(DB_PATH)) {
    throw new Error(`DB not found: ${DB_PATH}`);
  }

  console.log(`[migrate-v5] target: ${DB_PATH}`);
  console.log(`[migrate-v5] dry-run: ${DRY_RUN}`);

  const backupPath = takeBackup(DB_PATH);
  console.log(`[migrate-v5] backup: ${backupPath}`);

  const db = new Database(DB_PATH);
  try {
    db.pragma('foreign_keys = OFF');
    db.pragma('journal_mode = WAL');

    console.log('[migrate-v5] reading source rows...');
    const source = readSource(db);
    console.log(`[migrate-v5]   profile=${source.profile.length} ` +
                `relationships=${source.relationships.length} ` +
                `habits=${source.habits.length} ` +
                `journal.trait_observation=${source.journalTraitObservations.length} ` +
                `journal.other=${source.journalOther.length} ` +
                `tasks=${source.tasks.length}`);

    if (DRY_RUN) {
      console.log('[migrate-v5] dry-run: would drop old tables, create new, insert seeds');
      return;
    }

    console.log('[migrate-v5] dropping old tables...');
    db.exec(DROP_OLD_TABLES);
    console.log('[migrate-v5] (scaffold — new tables + inserts in next tasks)');
    console.log('[migrate-v5] done');
  } finally {
    db.close();
  }
}

function takeBackup(dbPath: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.backup-v5-${ts}`;
  copyFileSync(dbPath, backupPath);
  return backupPath;
}

// Only run main when executed directly (not when imported by tests)
const isMain = process.argv[1]?.endsWith('migrate-v5-memory.ts')
  || process.argv[1]?.endsWith('migrate-v5-memory.js');
if (isMain) main();
