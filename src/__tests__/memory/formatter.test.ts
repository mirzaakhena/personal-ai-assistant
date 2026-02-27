import { describe, expect, it } from 'vitest';
import {
  formatFundamentalMemory,
  formatRecalledMemories,
  formatAllMemories,
} from '../../memory/formatter.js';
import type { FundamentalMemories } from '../../memory/operations.js';

describe('formatFundamentalMemory', () => {
  it('returns new user message when profile is null', () => {
    const memories: FundamentalMemories = {
      profile: null,
      persona: null,
      preferences: [],
      facts: [],
      routines: [],
    };

    const result = formatFundamentalMemory(memories);
    expect(result).toContain('[MEMORY CONTEXT]');
    expect(result).toContain('No memories stored yet');
    expect(result).toContain('NEW USER');
  });

  it('formats a fully populated memory set', () => {
    const memories: FundamentalMemories = {
      profile: {
        id: 'person:abc',
        name: 'Mirza',
        phone: '+628123',
        location: 'Jakarta',
        occupation: 'Software Engineer',
        birthday: '1990-01-15',
      },
      persona: {
        id: 'persona:xyz',
        name: 'Casual',
        communication_style: 'friendly, casual',
        language_preference: 'Indonesian',
        personality_traits: 'warm, humorous',
      },
      preferences: [
        { id: 'preference:1', value: 'Kopi hitam', context: 'setiap pagi' },
        { id: 'preference:2', value: 'Dark mode' },
      ],
      facts: [
        { id: 'fact:1', content: 'Alergi kacang' },
        { id: 'fact:2', content: 'Punya kucing bernama Milo' },
      ],
      routines: [
        { id: 'routine:1', activity: 'Ngopi', schedule: 'Jam 7 pagi', details: 'di warung depan' },
        { id: 'routine:2', activity: 'Jogging', schedule: 'Sabtu pagi' },
      ],
    };

    const result = formatFundamentalMemory(memories);

    expect(result).toContain('[MEMORY CONTEXT]');
    // Profile
    expect(result).toContain('Name: Mirza');
    expect(result).toContain('Location: Jakarta');
    expect(result).toContain('Occupation: Software Engineer');
    expect(result).toContain('Birthday: 1990-01-15');
    expect(result).toContain('Phone: +628123');
    // Persona
    expect(result).toContain('Persona: Casual');
    expect(result).toContain('Communication style: friendly, casual');
    expect(result).toContain('Language preference: Indonesian');
    expect(result).toContain('Personality traits: warm, humorous');
    // Preferences
    expect(result).toContain('Kopi hitam (setiap pagi)');
    expect(result).toContain('Dark mode');
    // Routines
    expect(result).toContain('Ngopi — Jam 7 pagi: di warung depan');
    expect(result).toContain('Jogging — Sabtu pagi');
    // Facts
    expect(result).toContain('Alergi kacang');
    expect(result).toContain('Punya kucing bernama Milo');
  });

  it('handles profile with only name', () => {
    const memories: FundamentalMemories = {
      profile: { id: 'person:abc', name: 'Mirza', phone: '+628123' },
      persona: null,
      preferences: [],
      facts: [],
      routines: [],
    };

    const result = formatFundamentalMemory(memories);
    expect(result).toContain('Name: Mirza');
    expect(result).not.toContain('Location:');
    expect(result).not.toContain('AI Persona');
    expect(result).not.toContain('Key preferences');
    expect(result).not.toContain('Key routines');
    expect(result).not.toContain('Key facts');
  });

  it('omits sections with no data', () => {
    const memories: FundamentalMemories = {
      profile: { id: 'person:abc', name: 'Test', phone: '+1' },
      persona: null,
      preferences: [],
      facts: [{ id: 'fact:1', content: 'One fact' }],
      routines: [],
    };

    const result = formatFundamentalMemory(memories);
    expect(result).toContain('Key facts');
    expect(result).not.toContain('Key preferences');
    expect(result).not.toContain('Key routines');
    expect(result).not.toContain('AI Persona');
  });
});

describe('formatRecalledMemories', () => {
  it('returns no-match message for empty array', () => {
    const result = formatRecalledMemories([]);
    expect(result).toBe('No matching memories found.');
  });

  it('formats recalled memories with record IDs', () => {
    const memories = [
      { id: 'fact:abc', content: 'Tinggal di Jakarta', importance: 'fundamental' },
      { id: 'preference:def', value: 'Kopi hitam', context: 'pagi', importance: 'extended' },
      { id: 'routine:ghi', activity: 'Jogging', schedule: 'Sabtu pagi', importance: 'extended' },
      { id: 'persona:jkl', name: 'Casual', communication_style: 'friendly' },
    ];

    const result = formatRecalledMemories(memories);

    expect(result).toContain('[RECALLED MEMORIES]');
    expect(result).toContain('[fact:abc] Tinggal di Jakarta');
    expect(result).toContain('[preference:def] Kopi hitam (pagi)');
    expect(result).toContain('[routine:ghi] Jogging — Sabtu pagi');
    expect(result).toContain('[persona:jkl] Casual — friendly');
  });
});

describe('formatAllMemories', () => {
  it('returns empty message when no memories exist', () => {
    const result = formatAllMemories({
      profile: null,
      preferences: [],
      facts: [],
      routines: [],
      personas: [],
      contacts: [],
    });
    expect(result).toContain('[ALL MEMORIES]');
    expect(result).toContain('No memories stored yet');
  });

  it('formats all memory types with record IDs', () => {
    const result = formatAllMemories({
      profile: {
        id: 'person:abc',
        name: 'Mirza',
        location: 'Jakarta',
        phone: '+628123',
      },
      preferences: [
        { id: 'preference:1', value: 'Kopi hitam', context: 'pagi', importance: 'fundamental' },
      ],
      facts: [
        { id: 'fact:1', content: 'Alergi kacang', importance: 'fundamental' },
        { id: 'fact:2', content: 'Tinggal di Jakarta (lama)', importance: 'fundamental', superseded_by: 'fact:3' },
      ],
      routines: [
        { id: 'routine:1', activity: 'Ngopi', schedule: 'Jam 7', importance: 'fundamental' },
      ],
      personas: [
        { id: 'persona:1', name: 'Casual', communication_style: 'friendly' },
      ],
      contacts: [
        { id: 'person:budi', name: 'Budi', notes: 'Teman kerja' },
        { id: 'person:ani', name: 'Ani', notes: 'NONE' },
      ],
    });

    expect(result).toContain('[ALL MEMORIES]');
    // Profile
    expect(result).toContain('Profile (person:abc)');
    expect(result).toContain('Name: Mirza');
    expect(result).toContain('Location: Jakarta');
    // Preferences
    expect(result).toContain('[preference:1] Kopi hitam (pagi) [fundamental]');
    // Facts
    expect(result).toContain('[fact:1] Alergi kacang [fundamental]');
    expect(result).toContain('[fact:2] Tinggal di Jakarta (lama) [fundamental] [SUPERSEDED]');
    // Routines
    expect(result).toContain('[routine:1] Ngopi — Jam 7 [fundamental]');
    // Personas
    expect(result).toContain('[persona:1] Casual — friendly');
    // Contacts
    expect(result).toContain('[person:budi] Budi — Teman kerja');
    expect(result).toContain('[person:ani] Ani');
    // Ani should NOT show "NONE" notes
    expect(result).not.toContain('Ani — NONE');
  });
});
