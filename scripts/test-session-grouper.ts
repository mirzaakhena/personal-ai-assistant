// scripts/test-session-grouper.ts — smoke test for session grouping

import { groupBySessionGap } from '../src-v3/utils/session-grouper.js';
import type { MessageRecord } from '../src-v3/db/message.js';

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`✓ ${label}`);
  else { failures++; console.log(`✗ ${label}`); }
}

function msg(id: string, ts: number): MessageRecord {
  return {
    id, gateway: 'test', session_id: null, sender: 'user', timestamp: ts,
    type: 'text', body: `m${id}`, has_media: 0, media_mimetype: null,
    media_filename: null, media_size: null, media_path: null,
    quoted_msg_id: null, is_forwarded: 0, raw_json: null,
  };
}

console.log('=== session-grouper smoke test ===\n');

const HOUR = 3600_000;
const base = Date.UTC(2026, 3, 1, 9, 0, 0);

const msgs: MessageRecord[] = [
  msg('1', base),
  msg('2', base + 30 * 60_000),
  msg('3', base + HOUR),
  msg('4', base + 4 * HOUR),
  msg('5', base + 4 * HOUR + 10_000),
  msg('6', base + 8 * HOUR),
  msg('7', base + 9 * HOUR),
  msg('8', base + 24 * HOUR),
  msg('9', base + 24 * HOUR + 1_000),
  msg('10', base + 24 * HOUR + 3 * HOUR + 1),
];

const sessions = groupBySessionGap(msgs, { gapHours: 2 });
assert(sessions.length === 5, `5 sessions (got ${sessions.length})`);
assert(sessions[0].messages.length === 3, `s-001 has 3 messages`);
assert(sessions[1].messages.length === 2, `s-002 has 2 messages`);
assert(sessions[2].messages.length === 2, `s-003 has 2 messages`);
assert(sessions[3].messages.length === 2, `s-004 has 2 messages`);
assert(sessions[4].messages.length === 1, `s-005 has 1 message`);

assert(sessions[0].session_pseudo_id === 's-001', 'session id s-001');
assert(sessions[4].session_pseudo_id === 's-005', 'session id s-005');

const shuffled = [...msgs].reverse();
const sessionsShuf = groupBySessionGap(shuffled, { gapHours: 2 });
assert(sessionsShuf.length === 5, '5 sessions from shuffled input');
assert(sessionsShuf[0].messages[0].id === '1', 'first message id=1 after sort');

assert(groupBySessionGap([]).length === 0, 'empty input → 0 sessions');

const split = groupBySessionGap(msgs, { gapHours: 0.5 });
assert(split.length > sessions.length, `gap=0.5h splits more (got ${split.length})`);

console.log(`\n=== ${failures === 0 ? 'All checks passed' : `${failures} FAILED`} ===`);
if (failures > 0) process.exit(1);
