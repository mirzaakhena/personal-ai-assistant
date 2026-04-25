// src/skills/templates.test.ts

import { describe, it, expect } from 'vitest';
import { CLAUDE_MD_TEMPLATE, WRITING_SKILLS_TEMPLATE } from './templates.js';

describe('CLAUDE_MD_TEMPLATE', () => {
  it('declares an Identity section', () => {
    expect(CLAUDE_MD_TEMPLATE).toMatch(/^# Assistant Identity/m);
  });

  it('contains the migrated Initiative guidance', () => {
    expect(CLAUDE_MD_TEMPLATE).toContain('## Initiative');
    expect(CLAUDE_MD_TEMPLATE).toContain('connects dots');
    expect(CLAUDE_MD_TEMPLATE).toContain('heartbeat');
  });

  it('contains the migrated Memory Discipline guidance', () => {
    expect(CLAUDE_MD_TEMPLATE).toContain('## Memory Discipline');
    expect(CLAUDE_MD_TEMPLATE).toContain('SEARCH BEFORE SAVE');
    expect(CLAUDE_MD_TEMPLATE).toContain('BATCH WITH ARRAYS');
    expect(CLAUDE_MD_TEMPLATE).toContain('SAVE SILENTLY');
    expect(CLAUDE_MD_TEMPLATE).toContain('RETRIEVE BEFORE GIVING UP');
  });

  it('points the AI at writing-skills meta when extending', () => {
    expect(CLAUDE_MD_TEMPLATE).toContain('writing-skills');
  });

  it('includes event-trigger guidance for active_event_tasks surface', () => {
    expect(CLAUDE_MD_TEMPLATE).toContain('## Event-Triggered Tasks');
    expect(CLAUDE_MD_TEMPLATE).toContain('active_event_tasks');
    expect(CLAUDE_MD_TEMPLATE).toContain('trigger_pattern');
  });

  it('includes Structured Logging guidance pointing at ledger', () => {
    expect(CLAUDE_MD_TEMPLATE).toContain('## Structured Logging');
    expect(CLAUDE_MD_TEMPLATE).toContain('ledger_append');
    expect(CLAUDE_MD_TEMPLATE).toContain('ledger_query');
    expect(CLAUDE_MD_TEMPLATE).toContain('stream');
  });
});

describe('WRITING_SKILLS_TEMPLATE', () => {
  it('describes when to write a skill (not speculatively)', () => {
    expect(WRITING_SKILLS_TEMPLATE).toMatch(/not.*speculatively/i);
  });

  it('documents write_skill input fields', () => {
    expect(WRITING_SKILLS_TEMPLATE).toContain('name');
    expect(WRITING_SKILLS_TEMPLATE).toContain('description');
    expect(WRITING_SKILLS_TEMPLATE).toContain('body');
    expect(WRITING_SKILLS_TEMPLATE).toContain('kebab-case');
  });

  it('warns against overlapping skills and chatty narration', () => {
    expect(WRITING_SKILLS_TEMPLATE).toMatch(/supersedes/i);
    expect(WRITING_SKILLS_TEMPLATE).toMatch(/silently/i);
  });
});
