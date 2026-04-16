// scripts/migrate-populate-memory.ts

import Anthropic from '@anthropic-ai/sdk';
import Database from 'better-sqlite3';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createUserDb } from '../src-v3/db/user-db.js';
import { groupBySessionGap, type SessionGroup } from '../src-v3/utils/session-grouper.js';
import { EXTRACTION_SYSTEM_PROMPT, type ExtractionOutput } from '../src-v3/utils/extraction-prompt.js';
import { executeMemoryOps } from '../src-v3/utils/memory-op-executor.js';
import type { MessageRecord } from '../src-v3/db/message.js';

// ── CLI args parsing ──────────────────────────────────

interface Args {
  userId: string | null;
  limit: number;
  fromSession: string | null;
  gapHours: number;
  dryRun: boolean;
  maxCalls: number;
  since: string | null;
  logFile: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    userId: null,
    limit: 10,
    fromSession: null,
    gapHours: 2,
    dryRun: false,
    maxCalls: Number(process.env.AI_EXTRACTION_MAX_CALLS ?? 50),
    since: null,
    logFile: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--user-id') { args.userId = next; i++; }
    else if (a === '--limit') { args.limit = Number(next); i++; }
    else if (a === '--from-session') { args.fromSession = next; i++; }
    else if (a === '--gap-hours') { args.gapHours = Number(next); i++; }
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--max-calls') { args.maxCalls = Number(next); i++; }
    else if (a === '--since') { args.since = next; i++; }
    else if (a === '--log-file') { args.logFile = next; i++; }
    else if (a === '--help') { printHelp(); process.exit(0); }
  }

  return args;
}

function printHelp(): void {
  console.log(`Usage: pnpm migrate:populate-memory [options]

Options:
  --user-id ID          target userId (default: first dir in data/users/)
  --limit N             process at most N sessions (default: 10)
  --from-session X      resume from specific session_pseudo_id
  --gap-hours N         session boundary (default: 2)
  --dry-run             extract + print, no insert, no tracking
  --max-calls N         hard cap AI calls (default: 50, env: AI_EXTRACTION_MAX_CALLS)
  --since DATE          only sessions starting after ISO date
  --log-file path.jsonl append session summaries to file
`);
}

// ── Haiku client ──────────────────────────────────────

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-haiku-4-5-20251001';
const INPUT_COST_PER_1M = 1.00;   // USD (Haiku 4.5 pricing)
const OUTPUT_COST_PER_1M = 5.00;

const client = new Anthropic();

async function callHaiku(systemPrompt: string, userContent: string): Promise<{
  text: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}> {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = resp.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('');
  const input_tokens = resp.usage.input_tokens;
  const output_tokens = resp.usage.output_tokens;
  const cost_usd = (input_tokens / 1_000_000) * INPUT_COST_PER_1M
                 + (output_tokens / 1_000_000) * OUTPUT_COST_PER_1M;

  return { text, input_tokens, output_tokens, cost_usd };
}

// ── Session → conversation XML ────────────────────────

function toConversationXml(group: SessionGroup): string {
  const first = new Date(group.first_msg_at).toISOString();
  const last = new Date(group.last_msg_at).toISOString();
  const lines: string[] = [
    `<conversation session_pseudo_id="${group.session_pseudo_id}" start="${first}" end="${last}" message_count="${group.messages.length}">`,
  ];
  for (const m of group.messages) {
    const ts = new Date(m.timestamp).toISOString();
    const body = (m.body ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    lines.push(`  <message from="${m.sender}" ts="${ts}">${body}</message>`);
  }
  lines.push(`</conversation>`);
  return lines.join('\n');
}

// ── Parse extraction output ───────────────────────────

function parseOutput(raw: string): ExtractionOutput {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  return JSON.parse(text) as ExtractionOutput;
}

// ── Main ──────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  let userId = args.userId;
  if (!userId) {
    const users = existsSync('data/users') ? readdirSync('data/users', { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.endsWith('.bak-contaminated')) : [];
    if (users.length === 0) {
      console.error('No user folders in data/users/. Pass --user-id explicitly.');
      process.exit(1);
    }
    userId = users[0].name;
  }

  console.log(`=== M4 Populate Memory ===`);
  console.log(`userId: ${userId}`);
  console.log(`flags: limit=${args.limit} gapHours=${args.gapHours} dryRun=${args.dryRun} maxCalls=${args.maxCalls}`);
  console.log(`model: ${MODEL}`);
  console.log(``);

  const userDb = createUserDb(userId);
  // Read all messages directly — MessageStore.search caps at 100 (MAX_LIMIT)
  const readDb = new Database(join('data/users', userId, 'app.db'), { readonly: true });
  const allMsgs = readDb.prepare<[], MessageRecord>(`SELECT * FROM messages ORDER BY timestamp ASC`).all();
  readDb.close();
  console.log(`total messages: ${allMsgs.length}`);

  const sinceMs = args.since ? new Date(args.since).getTime() : undefined;
  const sessions = groupBySessionGap(allMsgs, { gapHours: args.gapHours, since: sinceMs });
  console.log(`total sessions (gap=${args.gapHours}h): ${sessions.length}`);

  const processed = userDb.populateRuns.processedIds();
  console.log(`already processed: ${processed.size}`);

  let toProcess = sessions.filter(s => args.dryRun || !processed.has(s.session_pseudo_id));

  if (args.fromSession) {
    const fromIdx = toProcess.findIndex(s => s.session_pseudo_id === args.fromSession);
    if (fromIdx < 0) {
      console.error(`--from-session ${args.fromSession} not found`);
      process.exit(1);
    }
    toProcess = toProcess.slice(fromIdx);
  }

  toProcess = toProcess.slice(0, Math.min(args.limit, args.maxCalls));
  console.log(`will process: ${toProcess.length} sessions\n`);

  let totalInput = 0, totalOutput = 0, totalCost = 0, totalOps = 0, calls = 0;

  for (const group of toProcess) {
    if (calls >= args.maxCalls) {
      console.log(`\n⚠  hit --max-calls=${args.maxCalls}, stopping`);
      break;
    }
    calls++;

    const xml = toConversationXml(group);
    console.log(`→ ${group.session_pseudo_id}  (${group.messages.length} msgs, ${new Date(group.first_msg_at).toISOString().slice(0, 10)} → ${new Date(group.last_msg_at).toISOString().slice(0, 10)})`);

    let resp: { text: string; input_tokens: number; output_tokens: number; cost_usd: number };
    try {
      resp = await callHaiku(EXTRACTION_SYSTEM_PROMPT, xml);
    } catch (err: any) {
      const errStr = String(err).slice(0, 200);
      console.error(`  ✗ API error: ${errStr}`);
      if (!args.dryRun) {
        userDb.populateRuns.insert({
          session_pseudo_id: group.session_pseudo_id,
          first_msg_id: group.messages[0].id,
          last_msg_id: group.messages[group.messages.length - 1].id,
          first_msg_at: group.first_msg_at,
          last_msg_at: group.last_msg_at,
          message_count: group.messages.length,
          processed_at: Date.now(),
          ops_count: 0,
          input_tokens: null, output_tokens: null, cost_usd: null,
          status: 'failed',
          error: errStr,
          summary: null,
        });
      }
      if (errStr.includes('429') || errStr.includes('rate_limit')) {
        console.log(`\n⚠  rate limit — graceful exit, checkpoint saved`);
        process.exit(2);
      }
      continue;
    }

    totalInput += resp.input_tokens;
    totalOutput += resp.output_tokens;
    totalCost += resp.cost_usd;
    console.log(`  tokens: in=${resp.input_tokens} out=${resp.output_tokens} cost=$${resp.cost_usd.toFixed(4)}`);

    let parsed: ExtractionOutput;
    try {
      parsed = parseOutput(resp.text);
    } catch (err) {
      console.error(`  ✗ parse error: ${String(err).slice(0, 150)}`);
      if (!args.dryRun) {
        userDb.populateRuns.insert({
          session_pseudo_id: group.session_pseudo_id,
          first_msg_id: group.messages[0].id,
          last_msg_id: group.messages[group.messages.length - 1].id,
          first_msg_at: group.first_msg_at,
          last_msg_at: group.last_msg_at,
          message_count: group.messages.length,
          processed_at: Date.now(),
          ops_count: 0,
          input_tokens: resp.input_tokens,
          output_tokens: resp.output_tokens,
          cost_usd: resp.cost_usd,
          status: 'failed',
          error: `parse: ${String(err).slice(0, 100)}`,
          summary: null,
        });
      }
      continue;
    }

    const sourceMsgId = group.messages[0].id;

    if (args.dryRun) {
      console.log(`  [DRY RUN] summary: ${parsed.summary.slice(0, 80)}`);
      console.log(`  [DRY RUN] ops (${parsed.ops.length}):`, JSON.stringify(parsed.ops, null, 2).slice(0, 500));
    } else {
      const allOps = [
        { op: 'save_conversation_summary', content: parsed.summary },
        ...parsed.ops,
      ];
      const execResult = executeMemoryOps(userDb, allOps, sourceMsgId, group.session_pseudo_id);
      totalOps += execResult.executed;
      console.log(`  ops: executed=${execResult.executed} skipped=${execResult.skipped}`);
      if (execResult.errors.length > 0) {
        console.log(`  errors: ${execResult.errors.slice(0, 3).join('; ')}`);
      }

      userDb.populateRuns.insert({
        session_pseudo_id: group.session_pseudo_id,
        first_msg_id: group.messages[0].id,
        last_msg_id: group.messages[group.messages.length - 1].id,
        first_msg_at: group.first_msg_at,
        last_msg_at: group.last_msg_at,
        message_count: group.messages.length,
        processed_at: Date.now(),
        ops_count: execResult.executed,
        input_tokens: resp.input_tokens,
        output_tokens: resp.output_tokens,
        cost_usd: resp.cost_usd,
        status: execResult.skipped > 0 ? 'partial' : 'success',
        error: execResult.errors.length > 0 ? execResult.errors.join('; ').slice(0, 500) : null,
        summary: parsed.summary,
      });
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`sessions processed: ${calls}`);
  console.log(`total tokens: in=${totalInput} out=${totalOutput}`);
  console.log(`total cost: $${totalCost.toFixed(4)}`);
  console.log(`total ops executed: ${totalOps}`);
  userDb.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
