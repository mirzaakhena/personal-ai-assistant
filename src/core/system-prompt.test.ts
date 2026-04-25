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

  it('preserves the three invariant sections', () => {
    const out = assembleSystemPrompt('');
    expect(out).toContain('<reply_rule>');
    expect(out).toContain('<input_format>');
    expect(out).toContain('<on_wake_up>');
  });

  it('does NOT carry behavior sections (migrated to CLAUDE.md)', () => {
    expect(CORE_SYSTEM_PROMPT).not.toContain('<initiative>');
    expect(CORE_SYSTEM_PROMPT).not.toContain('<memory_discipline>');
    expect(CORE_SYSTEM_PROMPT).not.toContain('<skills>');
  });

  it('does NOT enumerate domain stores (migrated to CLAUDE.md)', () => {
    // These tokens used to live in <memory_discipline>; they belong in
    // CLAUDE.md now, not in the engine prompt.
    expect(CORE_SYSTEM_PROMPT).not.toContain('SEARCH BEFORE SAVE');
    expect(CORE_SYSTEM_PROMPT).not.toContain('BATCH WITH ARRAYS');
    expect(CORE_SYSTEM_PROMPT).not.toContain('heartbeat');
  });

  it('still surfaces the critical reply rule', () => {
    expect(CORE_SYSTEM_PROMPT).toContain('`send_message`');
    expect(CORE_SYSTEM_PROMPT).toContain('never plain text');
  });

  it('still references CLAUDE.md and skills as the behavior layers', () => {
    expect(CORE_SYSTEM_PROMPT).toContain('CLAUDE.md');
    expect(CORE_SYSTEM_PROMPT).toMatch(/skills?\//i);
  });

  it('<on_wake_up> promotes <recent_messages> as primary context', () => {
    expect(CORE_SYSTEM_PROMPT).toContain('<recent_messages>');
    expect(CORE_SYSTEM_PROMPT).toContain('primary fresh-context');
  });

  it('<on_wake_up> handles stale cron messages', () => {
    expect(CORE_SYSTEM_PROMPT).toMatch(/stale/i);
  });

  it('does not reference removed v3 specifics', () => {
    const forbidden = ['prayer', 'Busan', 'KST', 'sholat', 'habit', 'Time-keeper'];
    for (const term of forbidden) {
      expect(CORE_SYSTEM_PROMPT).not.toContain(term);
    }
  });

  it('is bounded in size (engine prompt holds invariants only)', () => {
    // Hard ceiling: pre-refactor was ~2400 chars. Target is well under
    // half that. This guards against accidental drift back to verbose.
    expect(CORE_SYSTEM_PROMPT.length).toBeLessThan(1800);
  });
});
