// src/core/system-prompt.test.ts

import { describe, it, expect } from 'vitest';
import { CORE_SYSTEM_PROMPT, assembleSystemPrompt } from './system-prompt.js';

describe('assembleSystemPrompt', () => {
  it('replaces the {{WAKE_UP_BRIEFING}} slot with the provided briefing string', () => {
    const briefing = '<wake_up_briefing>...</wake_up_briefing>';
    const out = assembleSystemPrompt(briefing);
    expect(out).toContain(briefing);
    expect(out).not.toContain('{{WAKE_UP_BRIEFING}}');
  });

  it('preserves the core section tags', () => {
    const out = assembleSystemPrompt('');
    expect(out).toContain('<reply_rule>');
    expect(out).toContain('<input_format>');
    expect(out).toContain('<initiative>');
    expect(out).toContain('<memory_discipline>');
    expect(out).toContain('<skills>');
    expect(out).toContain('<on_wake_up>');
  });

  it('CORE_SYSTEM_PROMPT surfaces the critical reply rule and cronjob emphasis', () => {
    expect(CORE_SYSTEM_PROMPT).toContain('`send_message`');
    expect(CORE_SYSTEM_PROMPT).toContain('never plain text');
    expect(CORE_SYSTEM_PROMPT).toContain('heartbeat');
    expect(CORE_SYSTEM_PROMPT).toContain('search_messages');
  });

  it('<on_wake_up> promotes <recent_messages> as primary context and reconciles stale cron messages', () => {
    expect(CORE_SYSTEM_PROMPT).toContain('<recent_messages>');
    expect(CORE_SYSTEM_PROMPT).toContain('primary fresh-context');
    expect(CORE_SYSTEM_PROMPT).toMatch(/stale/i);
  });

  it('CORE_SYSTEM_PROMPT does not reference dropped v3 domain specifics', () => {
    const forbidden = ['prayer', 'Busan', 'KST', 'sholat', 'save_profile category='];
    for (const term of forbidden) {
      expect(CORE_SYSTEM_PROMPT).not.toContain(term);
    }
  });

  it('CORE_SYSTEM_PROMPT does not reference removed concepts (habit, auto-injected)', () => {
    expect(CORE_SYSTEM_PROMPT).not.toContain('habit');
    expect(CORE_SYSTEM_PROMPT).not.toContain('auto-injected');
    expect(CORE_SYSTEM_PROMPT).not.toContain('six capacities');
    expect(CORE_SYSTEM_PROMPT).not.toContain('Time-keeper');
  });
});
