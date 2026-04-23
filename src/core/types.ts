// src/core/types.ts

import type { ProfileKey } from '../db/profile.js';
import type { PreferenceRow } from '../db/preferences.js';
import type { KnowledgeCategory } from '../db/knowledge.js';
import type { MessageRecord } from '../db/message.js';

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
  recentMessages: MessageRecord[];
}
