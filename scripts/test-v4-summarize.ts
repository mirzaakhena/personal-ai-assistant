// scripts/test-v4-summarize.ts
//
// Integration smoke test for core/summarize.ts.
// Seeds a synthetic conversation in an in-memory DB, runs the summarizer,
// prints the output and the persisted session_summaries row.
//
// Requires ANTHROPIC_API_KEY in env. Override model via SUMMARIZE_MODEL.
//
// Run: pnpm tsx scripts/test-v4-summarize.ts

import 'dotenv/config';
import Database from 'better-sqlite3';
import { createMessageStore } from '../src-v4/db/message.js';
import { createSessionStore } from '../src-v4/db/sessions.js';
import { summarizeSession } from '../src-v4/core/summarize.js';

async function main() {
  const db = new Database(':memory:');
  const messages = createMessageStore(db);
  const sessions = createSessionStore(db);

  const sessionId = 'test-session';
  const userId = 'u-test';
  const sample: { role: 'user' | 'assistant'; body: string }[] = [
    { role: 'user', body: 'Hai, aku lagi mikirin mau refactor v3 ke v4' },
    { role: 'assistant', body: 'Oke, mulai dari mana dulu?' },
    { role: 'user', body: 'Filosofinya: agnostic core + skill driven' },
    { role: 'assistant', body: 'Strong. Mau aku bantu rancang struktur foldernya?' },
    { role: 'user', body: 'Iya, tolong' },
    { role: 'assistant', body: 'Aku usulkan bottom-up: utils, db, engine, core, skills, tools, cron, gateway, trigger, index.' },
  ];
  let t = 1_700_000_000;
  for (const m of sample) {
    messages.insert({
      id: `msg-${t}`,
      gateway: 'console',
      session_id: sessionId,
      sender: m.role,
      timestamp: t++,
      type: 'text',
      body: m.body,
      has_media: 0,
      media_mimetype: null,
      media_filename: null,
      media_size: null,
      media_path: null,
      quoted_msg_id: null,
      is_forwarded: 0,
      raw_json: null,
    });
  }

  console.log('=== Calling summarizer (this may take 5-15s) ===');
  const result = await summarizeSession({
    sessionId,
    userId,
    reason: 'manual',
    messages,
    sessions,
    model: process.env.SUMMARIZE_MODEL ?? 'claude-haiku-4-5',
    cwd: process.cwd(),
  });

  console.log('\n=== Summary ===\n');
  console.log(result?.summary ?? '(null — summarizer returned null)');
  console.log('\n=== Stored in session_summaries ===\n');
  console.log(sessions.getLatestSummaryForUser(userId));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
