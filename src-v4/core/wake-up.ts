// src-v4/core/wake-up.ts

import type { UserDb } from '../db/user-db.js';
import { getCoreIdentity, getContextHintCounts } from '../db/user-db.js';
import type { WakeUpBriefingData } from './types.js';
import type { MessageRecord } from '../db/message.js';

/**
 * Gather all the data needed to render a wake-up briefing for a user.
 *
 * - identity + hints come from the per-user DB
 * - lastSummary comes from session_summaries
 * - fallbackRecentMessages is loaded only if no summary is available
 */
export function buildWakeUpBriefing(opts: {
  userId: string;
  now: Date;
  timezone: string;
  userDb: UserDb;
  fallbackRecentMessagesCount?: number;
}): WakeUpBriefingData {
  const {
    userId,
    now,
    timezone,
    userDb,
    fallbackRecentMessagesCount = 10,
  } = opts;

  const identity = getCoreIdentity(userDb);
  const hints = getContextHintCounts(userDb, now);
  const lastSummary = userDb.sessions.getLatestSummaryForUser(userId);

  let fallbackRecentMessages: MessageRecord[] | undefined;
  if (!lastSummary) {
    fallbackRecentMessages = userDb.messages.getRecentMessages({
      limit: fallbackRecentMessagesCount,
      since: 0,
    });
  }

  return { now, timezone, identity, hints, lastSummary, fallbackRecentMessages };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render a WakeUpBriefingData object to the XML string that gets injected
 * into the core system prompt.
 */
export function renderWakeUpBriefing(data: WakeUpBriefingData): string {
  const lines: string[] = ['<wake_up_briefing>', ''];

  // current_moment
  const nowIso = data.now.toISOString();
  lines.push(
    `<current_moment now="${nowIso}" timezone="${data.timezone}"/>`,
    ''
  );

  // core_identity
  lines.push('<core_identity>');
  if (data.identity.name !== undefined)
    lines.push(`  - name: "${data.identity.name}"`);
  if (data.identity.current_location !== undefined)
    lines.push(`  - current_location: "${data.identity.current_location}"`);
  if (data.identity.language !== undefined)
    lines.push(`  - language: "${data.identity.language}"`);
  lines.push('</core_identity>', '');

  // context_hints
  lines.push('<context_hints>');
  lines.push(`  Ongoing situations: ${data.hints.ongoing}`);

  const taskSuffix =
    data.hints.tasks_due_today > 0
      ? ` (${data.hints.tasks_due_today} due today)`
      : '';
  lines.push(`  Active tasks: ${data.hints.tasks}${taskSuffix}`);

  const habitParts: string[] = [];
  if (data.hints.habits_today_total > 0) {
    habitParts.push(
      `${data.hints.habits_today_done}/${data.hints.habits_today_total} done today`
    );
  }
  if (data.hints.habits_longest_streak > 0) {
    habitParts.push(`longest streak: ${data.hints.habits_longest_streak}`);
  }
  const habitSuffix =
    habitParts.length > 0 ? ` (${habitParts.join(', ')})` : '';
  lines.push(`  Active habits: ${data.hints.habits}${habitSuffix}`);

  lines.push(`  Relationships tracked: ${data.hints.relationships}`);
  lines.push(
    '  Use search_memory / list_tasks / list_habits / list_relationships when relevant.'
  );
  lines.push('</context_hints>', '');

  // last_session_summary OR fallback recent_messages
  if (data.lastSummary) {
    const s = data.lastSummary;
    lines.push(
      `<last_session_summary from_session="${s.session_id}" ended_at="${s.ended_at}" ended_reason="${s.ended_reason}" turns="${s.turns}">`,
      '',
      s.summary,
      '',
      '</last_session_summary>',
      ''
    );
  } else if (
    data.fallbackRecentMessages &&
    data.fallbackRecentMessages.length > 0
  ) {
    lines.push(
      `<recent_messages count="${data.fallbackRecentMessages.length}" note="fallback: summarization unavailable">`
    );
    for (const m of data.fallbackRecentMessages) {
      const ts = new Date(m.timestamp * 1000).toISOString();
      const body = escapeXml(m.body ?? '');
      lines.push(`<msg from="${m.sender}" ts="${ts}"><body>${body}</body></msg>`);
    }
    lines.push('</recent_messages>', '');
  }

  lines.push('</wake_up_briefing>');
  return lines.join('\n');
}
