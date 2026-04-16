// src-v3/utils/session-grouper.ts

import type { MessageRecord } from '../db/message.js';

export interface SessionGroup {
  session_pseudo_id: string;     // e.g. "s-001", "s-002"
  messages: MessageRecord[];
  first_msg_at: number;
  last_msg_at: number;
}

export interface GroupOptions {
  gapHours?: number;       // default 2
  since?: number;          // Unix ms; filter messages after this
}

/**
 * Group messages into pseudo-sessions by time gap.
 * Messages within `gapHours` of the previous message belong to the same session.
 * Returns sessions in chronological order with sequential pseudo_ids.
 */
export function groupBySessionGap(
  messages: MessageRecord[],
  opts: GroupOptions = {}
): SessionGroup[] {
  const gapMs = (opts.gapHours ?? 2) * 60 * 60 * 1000;

  const sorted = messages
    .filter(m => opts.since === undefined || m.timestamp >= opts.since)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sorted.length === 0) return [];

  const sessions: SessionGroup[] = [];
  let current: MessageRecord[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gap = curr.timestamp - prev.timestamp;
    if (gap > gapMs) {
      sessions.push(toGroup(current, sessions.length + 1));
      current = [curr];
    } else {
      current.push(curr);
    }
  }
  sessions.push(toGroup(current, sessions.length + 1));
  return sessions;
}

function toGroup(messages: MessageRecord[], index: number): SessionGroup {
  return {
    session_pseudo_id: `s-${String(index).padStart(3, '0')}`,
    messages,
    first_msg_at: messages[0].timestamp,
    last_msg_at: messages[messages.length - 1].timestamp,
  };
}
