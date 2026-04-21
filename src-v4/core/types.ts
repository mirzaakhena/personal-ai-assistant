// src-v4/core/types.ts

import type { CoreIdentity, ContextHintCounts } from '../db/user-db.js';
import type { SessionSummaryRecord } from '../db/sessions.js';
import type { MessageRecord } from '../db/message.js';

/**
 * Data needed to render the wake-up briefing XML block.
 * Assembled by core/wake-up.ts, rendered into a string, and injected into
 * the {{WAKE_UP_BRIEFING}} slot of the core system prompt.
 */
export interface WakeUpBriefingData {
  now: Date;
  timezone: string; // e.g. "WIB"
  identity: CoreIdentity;
  hints: ContextHintCounts;
  lastSummary?: SessionSummaryRecord;
  fallbackRecentMessages?: MessageRecord[]; // used only if summarization unavailable
}

export type SessionEndReason = 'turn_threshold' | 'graceful_shutdown' | 'manual';

export interface SummarizeResult {
  sessionId: string;
  userId: string;
  summary: string; // narrative + key points with <msg_ref/> markers
  turns: number;
  endedAt: Date;
  endedReason: SessionEndReason;
}
