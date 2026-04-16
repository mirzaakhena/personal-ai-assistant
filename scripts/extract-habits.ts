// scripts/extract-habits.ts
// One-shot focused habit extraction from already-populated memory
// (conversation_summary + life_context journal entries).
// Complements the main M4 populate which does not emit save_habit ops.

import { query } from '@anthropic-ai/claude-agent-sdk';
import Database from 'better-sqlite3';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createUserDb } from '../src-v3/db/user-db.js';
import { requireModel } from '../src-v3/utils/model-config.js';
import type { CadenceType, CadenceConfig } from '../src-v3/db/habits.js';

// ── CLI args ─────────────────────────────────────────

interface Args {
  userId: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { userId: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--user-id') { args.userId = next; i++; }
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

// ── Extraction prompt ────────────────────────────────

const HABIT_EXTRACTION_SYSTEM_PROMPT = `You are a habit-pattern extractor. You read a batch of session summaries and ongoing-life-context entries from a user's chat history, then identify RECURRING HABITS (periodic activities with a cadence) — NOT one-time events, NOT goals, NOT problems.

OUTPUT: Strict JSON, no code fences, no prose:
{
  "habits": [
    {
      "title": "short Indonesian title",
      "cadence_type": "slot|count|quantity|boolean|duration",
      "cadence_config": {
        "period": "day|week|month",
        "slots": ["slot-a","slot-b"],
        "target": 3,
        "unit": "liter"
      },
      "notes": "1-sentence context why this is a habit"
    }
  ]
}

CADENCE TYPE GUIDE:
- slot: fixed named slots within a period — sholat 5 waktu, sahur, sarapan. cadence_config.slots required.
- count: hit a target N times per period — minum obat 1x malam, lari 3x seminggu. cadence_config.target required (period="day" or "week").
- quantity: measured amount per period — minum 2L air sehari. cadence_config.target + unit required.
- boolean: yes/no per period — catat pengeluaran hari ini. cadence_config only period.
- duration: minutes spent per period — power nap 30 menit. cadence_config.target (minutes) + unit="minutes".

RULES:
1. Only extract PATTERNS WITH CADENCE. Single events ("ke Korea 4 April"), goals ("bangun PAaaS"), problems ("HRD susah komunikasi") are NOT habits.
2. Use Indonesian titles for Indonesian user.
3. Prefer SHORT titles (3-8 words), notes can be slightly longer.
4. If a habit appears in multiple summaries, emit it ONCE (dedup by title).
5. Realistic slots: "subuh","dzuhur","ashar","maghrib","isya" for sholat; "pagi","siang","malam" for meals.
6. 10-25 habits is typical — not less than 5, not more than 30.
7. Skip habits that are clearly ONE-OFF in context (user said "kemarin aku...").
8. DO NOT make up habits not grounded in the source text.
9. Response must be parseable JSON, start with { and end with }.`;

// ── Types ──────────────────────────────────────────

interface ExtractedHabit {
  title: string;
  cadence_type: CadenceType;
  cadence_config: CadenceConfig;
  notes?: string;
}

interface ExtractionOutput {
  habits: ExtractedHabit[];
}

// ── Sonnet call ─────────────────────────────────────

const MODEL = requireModel();

async function callClaude(systemPrompt: string, userContent: string): Promise<{
  text: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}> {
  const q = query({
    prompt: userContent,
    options: {
      model: MODEL,
      systemPrompt,
      maxTurns: 1,
      allowedTools: [],
      settingSources: [],
      permissionMode: 'bypassPermissions',
    },
  });

  let text = '';
  let input_tokens = 0;
  let output_tokens = 0;
  let cost_usd = 0;

  for await (const msg of q) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        text = msg.result;
        input_tokens = msg.usage.input_tokens ?? 0;
        output_tokens = msg.usage.output_tokens ?? 0;
        cost_usd = msg.total_cost_usd ?? 0;
      } else {
        throw new Error(`query failed: ${JSON.stringify(msg).slice(0, 200)}`);
      }
      break;
    }
  }
  if (!text) throw new Error('empty response from Claude');
  return { text, input_tokens, output_tokens, cost_usd };
}

function parseOutput(raw: string): ExtractionOutput {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  return JSON.parse(text) as ExtractionOutput;
}

// ── Main ─────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  let userId = args.userId;
  if (!userId) {
    const users = existsSync('data/users')
      ? readdirSync('data/users', { withFileTypes: true })
          .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.endsWith('.bak-contaminated'))
      : [];
    if (users.length === 0) {
      console.error('No user folders found. Pass --user-id.');
      process.exit(1);
    }
    userId = users[0].name;
  }

  console.log('=== Habit Extraction ===');
  console.log(`userId: ${userId}`);
  console.log(`model: ${MODEL}`);
  console.log(`dryRun: ${args.dryRun}`);
  console.log('');

  const userDb = createUserDb(userId);

  // Collect source: conversation_summary + life_context — direct DB query
  // (searchJournal has MAX_LIMIT=100 cap which truncates our 154+119 entries)
  const readDb = new Database(join('data/users', userId, 'app.db'), { readonly: true });
  const convSummaries = readDb.prepare<[], { content: string }>(
    `SELECT content FROM journal WHERE type='conversation_summary' ORDER BY created_at ASC`
  ).all();
  const lifeContexts = readDb.prepare<[], { content: string; status: string | null }>(
    `SELECT content, status FROM journal WHERE type='life_context' ORDER BY created_at ASC`
  ).all();
  readDb.close();

  console.log(`conversation_summary entries: ${convSummaries.length}`);
  console.log(`life_context entries:         ${lifeContexts.length}`);

  const lines: string[] = [];
  lines.push('<session_summaries>');
  for (const s of convSummaries) {
    lines.push(`  - ${s.content}`);
  }
  lines.push('</session_summaries>');
  lines.push('');
  lines.push('<life_contexts>');
  for (const l of lifeContexts) {
    lines.push(`  - [${l.status ?? '-'}] ${l.content}`);
  }
  lines.push('</life_contexts>');
  lines.push('');
  lines.push('Extract all recurring habits you can identify from the above data.');
  const userContent = lines.join('\n');

  console.log(`input size: ${userContent.length} chars (~${Math.round(userContent.length / 3.5)} tokens)`);
  console.log('');
  console.log('Calling Claude...');

  const resp = await callClaude(HABIT_EXTRACTION_SYSTEM_PROMPT, userContent);
  console.log(`tokens: in=${resp.input_tokens} out=${resp.output_tokens} cost=$${resp.cost_usd.toFixed(4)}`);

  let parsed: ExtractionOutput;
  try {
    parsed = parseOutput(resp.text);
  } catch (err) {
    console.error('Parse error:', err);
    console.error('Raw response:', resp.text.slice(0, 500));
    process.exit(1);
  }

  const habits = parsed.habits ?? [];
  console.log(`\nExtracted ${habits.length} habits.\n`);

  if (args.dryRun) {
    console.log('[DRY RUN] habits:');
    for (const h of habits) {
      console.log(`  • ${h.title}`);
      console.log(`    type=${h.cadence_type} config=${JSON.stringify(h.cadence_config)}`);
      if (h.notes) console.log(`    notes: ${h.notes.slice(0, 80)}`);
    }
  } else {
    // Dedup against existing (title match)
    const existing = new Set(
      userDb.habits.listActiveWithStatus().map(h => h.habit.title.toLowerCase())
    );
    let inserted = 0;
    let skipped = 0;
    for (const h of habits) {
      if (existing.has(h.title.toLowerCase())) {
        skipped++;
        continue;
      }
      try {
        userDb.habits.insert({
          title: h.title,
          cadence_type: h.cadence_type,
          cadence_config: h.cadence_config,
          status: 'active',
          notes: h.notes ?? null,
        });
        inserted++;
        console.log(`  ✓ ${h.title}`);
      } catch (err) {
        console.error(`  ✗ ${h.title}: ${String(err).slice(0, 100)}`);
      }
    }
    console.log(`\nInserted: ${inserted}, Skipped (dup): ${skipped}`);
  }

  userDb.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
