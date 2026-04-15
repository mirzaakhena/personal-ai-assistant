// scripts/test-m3-prompt.ts — Phase M3 prompt smoke test (no DB / no AI)

import {
  renderMemoryContext,
  buildSystemPromptWithMemory,
  DEFAULT_SYSTEM_PROMPT,
} from '../src-v3/utils/system-prompt.js';
import {
  buildUserPrompt,
  buildSystemMessagePrompt,
} from '../src-v3/utils/prompt.js';
import type {
  ProfileRecord,
  TraitRecord,
  JournalRecord,
} from '../src-v3/db/memory.js';
import type { AlwaysBundle } from '../src-v3/db/user-db.js';

let failures = 0;
function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`✓ ${label}`);
  } else {
    failures++;
    console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('=== Phase M3 prompt smoke test ===\n');

// ── Fixtures ─────────────────────────────────────────────

function profile(over: Partial<ProfileRecord>): ProfileRecord {
  return {
    id: 'p-id',
    user_id: 'u',
    category: 'identity',
    layer: 'L3',
    key: 'name',
    value: 'Mirza',
    confidence: null,
    source_session_id: null,
    source_msg_id: null,
    importance: null,
    last_updated: 0,
    created_at: 0,
    ...over,
  };
}

function trait(over: Partial<TraitRecord>): TraitRecord {
  return {
    id: 't-id',
    user_id: 'u',
    type: 'trait',
    label: 'perfeksionis',
    confidence: 0.85,
    evidence_count: 5,
    source_obs_ids: null,
    first_seen: 0,
    last_confirmed: 0,
    ...over,
  };
}

function ongoing(over: Partial<JournalRecord>): JournalRecord {
  return {
    id: 'j-id',
    user_id: 'u',
    type: 'problem',
    content: 'Sering lupa minum obat',
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
    created_at: 0,
    resolved_at: null,
    ...over,
  };
}

const populated: AlwaysBundle = {
  profile: [
    profile({ id: 'p1', category: 'identity', layer: 'L3', key: 'name', value: 'Mirza' }),
    profile({ id: 'p2', category: 'preference', layer: 'L2', key: 'tone', value: 'direct, no fluff', confidence: 0.9 }),
  ],
  traits: [
    trait({ id: 't1', label: 'perfeksionis', type: 'trait', confidence: 0.85, evidence_count: 5 }),
  ],
  ongoing: [
    ongoing({ id: 'o1', type: 'problem', content: 'Sering lupa minum obat', recurrence_count: 2 }),
    ongoing({ id: 'o2', type: 'life_context', content: 'Sedang mengurus dokumen imigrasi Korea' }),
  ],
  tasks: [],
  habits: [],
};

const empty: AlwaysBundle = { profile: [], traits: [], ongoing: [], tasks: [], habits: [] };

const onlyProfile: AlwaysBundle = {
  profile: [profile({ id: 'p1', value: 'Mirza' })],
  traits: [],
  ongoing: [],
  tasks: [],
  habits: [],
};

// ── Tests ────────────────────────────────────────────────

console.log('— renderMemoryContext —');

const r1 = renderMemoryContext(populated);
assert(r1.startsWith('<memory_context>'), 'populated: starts with <memory_context>');
assert(r1.endsWith('</memory_context>'), 'populated: ends with </memory_context>');
assert(r1.includes('profile:'), 'populated: contains profile:');
assert(r1.includes('traits:'), 'populated: contains traits:');
assert(r1.includes('ongoing:'), 'populated: contains ongoing:');
assert(r1.includes('id: "p1"'), 'populated: profile id visible');
assert(r1.includes('id: "t1"'), 'populated: trait id visible');
assert(r1.includes('id: "o1"'), 'populated: ongoing id visible');
assert(r1.includes('confidence: 0.9'), 'populated: profile confidence emitted');
assert(r1.includes('evidence_count: 5'), 'populated: trait evidence_count emitted');
assert(r1.includes('recurrence_count: 2'), 'populated: ongoing recurrence_count emitted (>1)');
assert(!r1.includes('recurrence_count: 1'), 'populated: ongoing recurrence_count NOT emitted when ==1');

const r2 = renderMemoryContext(empty);
assert(r2.includes('status="empty"'), 'empty: has status="empty" attribute');
assert(r2.includes('Onboard naturally'), 'empty: includes onboarding guidance');

const r3 = renderMemoryContext(onlyProfile);
assert(r3.includes('profile:'), 'partial: profile section present');
assert(!r3.includes('traits:'), 'partial: traits section omitted');
assert(!r3.includes('ongoing:'), 'partial: ongoing section omitted');

console.log('\n— buildSystemPromptWithMemory —');

const sys1 = buildSystemPromptWithMemory(populated);
assert(sys1.includes('You are a personal AI assistant'), 'composer: skeleton present');
assert(sys1.includes('<memory_context>'), 'composer: memory_context block injected');
assert(sys1.includes('id: "p1"'), 'composer: bundle data present');
assert(!sys1.includes('{{MEMORY_CONTEXT_BLOCK}}'), 'composer: placeholder replaced');

const sys2 = buildSystemPromptWithMemory(empty);
assert(sys2.includes('status="empty"'), 'composer (empty): empty bundle injected');

assert(DEFAULT_SYSTEM_PROMPT.includes('{{MEMORY_CONTEXT_BLOCK}}'), 'template: placeholder present');

console.log('\n— buildUserPrompt —');

const u1 = buildUserPrompt('hello world');
assert(typeof u1 === 'string', 'plain: returns string');
const u1s = u1 as string;
assert(u1s.startsWith('<user_message timestamp='), 'plain: has user_message tag with timestamp');
assert(u1s.includes('<body>hello world</body>'), 'plain: body matches');
assert(u1s.endsWith('</user_message>'), 'plain: closes user_message');

const u2 = buildUserPrompt('thx', {
  content: 'Sebelumnya saya bilang...',
  sender: 'assistant',
  at: new Date('2026-04-15T09:05:12+07:00'),
}) as string;
assert(u2.includes('<replying_to from="assistant"'), 'quoted: has replying_to with from=assistant');
assert(u2.includes('timestamp="2026-04-15T09:05:12+07:00"'), 'quoted: replying_to timestamp correct');
assert(!u2.includes('forwarded='), 'quoted: forwarded attribute omitted when false');
assert(u2.includes('<content>Sebelumnya saya bilang...</content>'), 'quoted: content body present');
assert(u2.includes('<body>thx</body>'), 'quoted: outer body present');

const u3 = buildUserPrompt('', undefined, [
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'xxx' } } as never,
]);
assert(Array.isArray(u3), 'media: returns ContentBlock[]');
const u3arr = u3 as Array<{ type: string; text?: string }>;
assert(u3arr.length === 2, 'media: 2 blocks (media + text)');
assert(u3arr[1].type === 'text', 'media: text block last');
assert(u3arr[1].text!.includes('has_media="true"'), 'media: has_media attribute set');
assert(u3arr[1].text!.includes('<body>(no caption)</body>'), 'media: empty caption fallback');

const u4 = buildUserPrompt('check this', {
  content: 'forwarded content',
  sender: 'user',
  forwarded: true,
}) as string;
assert(u4.includes('forwarded="true"'), 'forwarded: attribute emitted when true');

const u5 = buildUserPrompt('xss <script>alert(1)</script>') as string;
assert(u5.includes('&lt;script&gt;'), 'escape: < and > escaped in body');
assert(!u5.includes('<script>'), 'escape: raw script tag NOT present');

console.log('\n— buildSystemMessagePrompt —');

const s1 = buildSystemMessagePrompt('cron fired: morning check-in');
assert(s1.startsWith('<system_message timestamp='), 'system: starts with system_message tag');
assert(s1.includes('<body>cron fired: morning check-in</body>'), 'system: body matches');
assert(s1.endsWith('</system_message>'), 'system: closes system_message');

console.log(`\n=== ${failures === 0 ? 'All checks passed' : `${failures} FAILED`} ===`);
if (failures > 0) process.exit(1);
