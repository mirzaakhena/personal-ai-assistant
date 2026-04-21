// src-v4/core/wake-up.test.ts

import { describe, it, expect } from 'vitest';
import { renderWakeUpBriefing } from './wake-up.js';
import type { WakeUpBriefingData } from './types.js';

describe('renderWakeUpBriefing', () => {
  const baseData: WakeUpBriefingData = {
    now: new Date('2026-04-21T14:30:00Z'),
    timezone: 'WIB',
    identity: { name: 'Mirza', current_location: 'Jakarta', language: 'id' },
    hints: {
      ongoing: 3,
      tasks: 2,
      tasks_due_today: 1,
      habits: 5,
      habits_today_done: 3,
      habits_today_total: 5,
      habits_longest_streak: 14,
      relationships: 8,
    },
    lastSummary: {
      id: 'sum-1',
      session_id: 'abc123',
      user_id: 'u1',
      summary:
        'Mirza sedang refactor v3 ke v4.\nKey points:\n- Decision X <msg_ref id="abc"/>',
      turns: 30,
      ended_at: '2026-04-21T20:00:00+07:00',
      ended_reason: 'turn_threshold',
      created_at: '2026-04-21T20:00:05+07:00',
    },
  };

  it('produces a valid XML block wrapped in <wake_up_briefing>', () => {
    const out = renderWakeUpBriefing(baseData);
    expect(out.startsWith('<wake_up_briefing>')).toBe(true);
    expect(out.endsWith('</wake_up_briefing>')).toBe(true);
  });

  it('includes current_moment with now and timezone attrs', () => {
    const out = renderWakeUpBriefing(baseData);
    expect(out).toContain('<current_moment');
    expect(out).toContain('now="2026-04-21T14:30:00.000Z"');
    expect(out).toContain('timezone="WIB"');
  });

  it('includes core_identity with name, location, language', () => {
    const out = renderWakeUpBriefing(baseData);
    expect(out).toContain('name: "Mirza"');
    expect(out).toContain('current_location: "Jakarta"');
    expect(out).toContain('language: "id"');
  });

  it('omits missing identity fields', () => {
    const out = renderWakeUpBriefing({
      ...baseData,
      identity: { name: 'Ana' },
    });
    expect(out).toContain('name: "Ana"');
    expect(out).not.toContain('current_location');
    expect(out).not.toContain('language');
  });

  it('includes context_hints with counts and today-scoped suffixes', () => {
    const out = renderWakeUpBriefing(baseData);
    expect(out).toContain('Ongoing situations: 3');
    expect(out).toContain('Active tasks: 2 (1 due today)');
    expect(out).toContain('Active habits: 5 (3/5 done today, longest streak: 14)');
    expect(out).toContain('Relationships tracked: 8');
  });

  it('omits due-today and habit-progress suffixes when zero', () => {
    const out = renderWakeUpBriefing({
      ...baseData,
      hints: {
        ongoing: 0,
        tasks: 0,
        tasks_due_today: 0,
        habits: 0,
        habits_today_done: 0,
        habits_today_total: 0,
        habits_longest_streak: 0,
        relationships: 0,
      },
    });
    expect(out).toContain('Active tasks: 0');
    expect(out).not.toContain('due today');
    expect(out).toContain('Active habits: 0');
    expect(out).not.toContain('done today');
    expect(out).not.toContain('longest streak');
  });

  it('includes last_session_summary block with summary text', () => {
    const out = renderWakeUpBriefing(baseData);
    expect(out).toContain('<last_session_summary');
    expect(out).toContain('from_session="abc123"');
    expect(out).toContain('turns="30"');
    expect(out).toContain('Mirza sedang refactor');
  });

  it('omits last_session_summary when no summary provided', () => {
    const out = renderWakeUpBriefing({
      ...baseData,
      lastSummary: undefined,
    });
    expect(out).not.toContain('<last_session_summary');
  });

  it('falls back to recent messages when summary missing but fallback provided', () => {
    const out = renderWakeUpBriefing({
      ...baseData,
      lastSummary: undefined,
      fallbackRecentMessages: [
        {
          id: 'm1',
          gateway: 'console',
          session_id: 'x',
          sender: 'user',
          timestamp: 1700000000,
          type: 'text',
          body: 'Halo',
          has_media: 0,
          media_mimetype: null,
          media_filename: null,
          media_size: null,
          media_path: null,
          quoted_msg_id: null,
          is_forwarded: 0,
          raw_json: null,
        },
      ],
    });
    expect(out).toContain('<recent_messages');
    expect(out).toContain('Halo');
  });

  it('escapes XML special characters in fallback message bodies', () => {
    const out = renderWakeUpBriefing({
      ...baseData,
      lastSummary: undefined,
      fallbackRecentMessages: [
        {
          id: 'm1',
          gateway: 'console',
          session_id: 'x',
          sender: 'user',
          timestamp: 1700000000,
          type: 'text',
          body: 'a & b <c>',
          has_media: 0,
          media_mimetype: null,
          media_filename: null,
          media_size: null,
          media_path: null,
          quoted_msg_id: null,
          is_forwarded: 0,
          raw_json: null,
        },
      ],
    });
    expect(out).toContain('a &amp; b &lt;c&gt;');
    expect(out).not.toContain('a & b <c>');
  });
});
