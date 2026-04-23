// src/core/types.ts

import type { ProfileKey } from '../db/profile.js';
import type { PreferenceRow } from '../db/preferences.js';
import type { KnowledgeCategory } from '../db/knowledge.js';
import type { MessageRecord } from '../db/message.js';
import type { SessionSummaryRecord } from '../db/sessions.js';

export interface WakeUpContextHints {
  tasks: number;
  tasks_due_today: number;
  journal_recent_7d: number;
  knowledge_total: number;
  knowledge_by_category: Record<KnowledgeCategory, number>;
}

export interface WakeUpBriefingData {
  now: Date;
  timezone: string;
  last_user_msg_gap: string | null;
  profile: Partial<Record<ProfileKey, string>>;
  preferences: PreferenceRow[];
  hints: WakeUpContextHints;
  lastSummary: SessionSummaryRecord | null;
  fallbackRecentMessages?: MessageRecord[];
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
