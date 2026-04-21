// src-v4/core/system-prompt.test.ts

import { describe, it, expect } from 'vitest';
import { CORE_SYSTEM_PROMPT, assembleSystemPrompt } from './system-prompt.js';

describe('assembleSystemPrompt', () => {
  it('replaces the {{WAKE_UP_BRIEFING}} slot with the provided briefing string', () => {
    const briefing = '<wake_up_briefing>...</wake_up_briefing>';
    const out = assembleSystemPrompt(briefing);
    expect(out).toContain(briefing);
    expect(out).not.toContain('{{WAKE_UP_BRIEFING}}');
  });

  it('preserves the rest of the template verbatim', () => {
    const out = assembleSystemPrompt('');
    expect(out).toContain('<your_role>');
    expect(out).toContain('<initiative>');
    expect(out).toContain('<skill_discipline>');
  });

  it('CORE_SYSTEM_PROMPT contains the six role capacities', () => {
    expect(CORE_SYSTEM_PROMPT).toContain('Time-keeper');
    expect(CORE_SYSTEM_PROMPT).toContain('Conversational companion');
    expect(CORE_SYSTEM_PROMPT).toContain('Adviser');
    expect(CORE_SYSTEM_PROMPT).toContain('Planner');
    expect(CORE_SYSTEM_PROMPT).toContain('Chronicler');
    expect(CORE_SYSTEM_PROMPT).toContain('Check-in & recap partner');
  });

  it('CORE_SYSTEM_PROMPT does not reference dropped v3 domain specifics', () => {
    const forbidden = ['prayer', 'Busan', 'KST', 'sholat', 'save_profile category='];
    for (const term of forbidden) {
      expect(CORE_SYSTEM_PROMPT).not.toContain(term);
    }
  });
});
