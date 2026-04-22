// src-v4/core/wake-up.ts

import type { UserDb } from '../db/user-db.js';
import { getProfile, getContextHintCounts } from '../db/user-db.js';
import type { WakeUpBriefingData } from './types.js';
import type { MessageRecord } from '../db/message.js';

export function buildWakeUpBriefing(opts: {
  userId: string;
  now: Date;
  timezone: string;
  userDb: UserDb;
  fallbackRecentMessagesCount?: number;
}): WakeUpBriefingData {
  const {
    userId, now, timezone, userDb,
    fallbackRecentMessagesCount = 10,
  } = opts;

  const profile = getProfile(userDb);
  const preferences = userDb.preferences.list();
  const hints = getContextHintCounts(userDb, now);
  const lastSummary = userDb.sessions.getLatestSummaryForUser(userId);
  const last_user_msg_gap = computeLastUserMsgGap(userDb, now);

  let fallbackRecentMessages: MessageRecord[] | undefined;
  if (!lastSummary) {
    fallbackRecentMessages = userDb.messages.getRecentMessages({
      limit: fallbackRecentMessagesCount, since: 0,
    });
  }

  return { now, timezone, last_user_msg_gap, profile, preferences, hints, lastSummary: lastSummary ?? null, fallbackRecentMessages };
}

/** Delta between `now` and the most recent user message, formatted e.g. "3m", "19h 52m", "3d 14h". Null if none. */
export function computeLastUserMsgGap(userDb: UserDb, now: Date): string | null {
  const latest = userDb.messages.getLatestUserMessage();
  if (!latest) return null;
  const deltaMs = now.getTime() - latest.timestamp;
  if (deltaMs < 0) return '0m';
  return formatDuration(deltaMs);
}

function formatDuration(ms: number): string {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (ms < minute) return `${Math.floor(ms / 1000)}s`;
  if (ms < hour) return `${Math.floor(ms / minute)}m`;
  if (ms < day) {
    const h = Math.floor(ms / hour);
    const m = Math.floor((ms % hour) / minute);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(ms / day);
  const h = Math.floor((ms % day) / hour);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderWakeUpBriefing(data: WakeUpBriefingData): string {
  const lines: string[] = ['<wake_up_briefing>', ''];

  // <current_moment>
  const gapAttr = data.last_user_msg_gap
    ? ` last_user_msg_gap="${data.last_user_msg_gap}"`
    : '';
  lines.push(
    `<current_moment now="${data.now.toISOString()}" timezone="${data.timezone}"${gapAttr}/>`,
    ''
  );

  // <profile>
  lines.push('<profile>');
  for (const key of ['name', 'called_as', 'language', 'timezone', 'home_location', 'current_location', 'active_hours'] as const) {
    const v = data.profile[key];
    if (v !== undefined) lines.push(`  ${key}: "${escapeXml(v)}"`);
  }
  lines.push('</profile>', '');

  // <preferences>
  lines.push('<preferences>');
  const rules = data.preferences.filter(p => p.kind === 'rule');
  const styles = data.preferences.filter(p => p.kind === 'style');
  if (rules.length > 0) {
    lines.push('  Rules (must observe):');
    for (const p of rules) lines.push(`  - ${p.key}: ${escapeXml(p.value)}`);
    if (styles.length > 0) lines.push('');
  }
  if (styles.length > 0) {
    lines.push('  Style (how to communicate & interact):');
    for (const p of styles) lines.push(`  - ${p.key}: ${escapeXml(p.value)}`);
  }
  lines.push('</preferences>', '');

  // <context_hints>
  lines.push('<context_hints>');
  const dueToday = data.hints.tasks_due_today > 0 ? ` (${data.hints.tasks_due_today} due today)` : '';
  lines.push(`  Active tasks: ${data.hints.tasks}${dueToday}`);
  lines.push(`  Recent journal entries (last 7d): ${data.hints.journal_recent_7d}`);
  const kb = data.hints.knowledge_by_category;
  lines.push(
    `  Knowledge: ${data.hints.knowledge_total} entries — identity: ${kb.identity}, ` +
    `person: ${kb.person}, routine: ${kb.routine}, context: ${kb.context}, insight: ${kb.insight}`
  );
  lines.push('  Use search_knowledge / list_tasks / list_recent_journal when relevant.');
  lines.push('</context_hints>', '');

  // <last_session_summary> OR fallback <recent_messages>
  if (data.lastSummary) {
    const s = data.lastSummary;
    lines.push(
      `<last_session_summary from_session="${s.session_id}" ended_at="${s.ended_at}" ended_reason="${s.ended_reason}" turns="${s.turns}">`,
      s.summary,
      '</last_session_summary>',
      ''
    );
  } else if (data.fallbackRecentMessages && data.fallbackRecentMessages.length > 0) {
    lines.push(
      `<recent_messages count="${data.fallbackRecentMessages.length}" note="fallback: summarization unavailable">`
    );
    for (const m of data.fallbackRecentMessages) {
      const ts = new Date(m.timestamp).toISOString();
      const body = escapeXml(m.body ?? '');
      lines.push(`<msg from="${m.sender}" ts="${ts}"><body>${body}</body></msg>`);
    }
    lines.push('</recent_messages>', '');
  }

  lines.push('</wake_up_briefing>');
  return lines.join('\n');
}
