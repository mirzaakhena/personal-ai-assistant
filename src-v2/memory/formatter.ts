import type { FundamentalMemories } from './operations/index.js';

const MEMORY_HEADER = '[MEMORY CONTEXT]';

/**
 * Format fundamental memories for injection at conversation start.
 */
export function formatFundamentalMemory(memories: FundamentalMemories): string {
  const { profile, persona, preferences, facts, routines } = memories;

  // No self person means new user
  if (!profile) {
    return `${MEMORY_HEADER}\n\nNo memories stored yet. This is a NEW USER — you MUST use the "onboarding-new-friend" skill.`;
  }

  const sections: string[] = [MEMORY_HEADER];

  // About the user
  const profileLines: string[] = [];
  if (profile.name) profileLines.push(`- Name: ${profile.name}`);
  if (profile.location) profileLines.push(`- Location: ${profile.location}`);
  if (profile.occupation)
    profileLines.push(`- Occupation: ${profile.occupation}`);
  if (profile.birthday) profileLines.push(`- Birthday: ${profile.birthday}`);
  if (profile.phone) profileLines.push(`- Phone: ${profile.phone}`);
  if (profileLines.length > 0) {
    sections.push(`\nAbout the user:\n${profileLines.join('\n')}`);
  }

  // AI Persona
  if (persona) {
    const personaLines: string[] = [];
    if (persona.name) personaLines.push(`- Persona: ${persona.name}`);
    if (persona.communication_style)
      personaLines.push(
        `- Communication style: ${persona.communication_style}`,
      );
    if (persona.language_preference)
      personaLines.push(
        `- Language preference: ${persona.language_preference}`,
      );
    if (persona.personality_traits)
      personaLines.push(
        `- Personality traits: ${persona.personality_traits}`,
      );
    if (personaLines.length > 0) {
      sections.push(`\nAI Persona:\n${personaLines.join('\n')}`);
    }
  }

  // Key preferences
  if (preferences.length > 0) {
    const prefLines = preferences.map(
      (p) => `- ${p.value}${p.context ? ` (${p.context})` : ''}`,
    );
    sections.push(`\nKey preferences:\n${prefLines.join('\n')}`);
  }

  // Key routines
  if (routines.length > 0) {
    const routineLines = routines.map(
      (r) =>
        `- ${r.activity}${r.schedule ? ` — ${r.schedule}` : ''}${r.details ? `: ${r.details}` : ''}`,
    );
    sections.push(`\nKey routines:\n${routineLines.join('\n')}`);
  }

  // Key facts
  if (facts.length > 0) {
    const factLines = facts.map((f) => `- ${f.content}`);
    sections.push(`\nKey facts:\n${factLines.join('\n')}`);
  }

  return sections.join('\n');
}

/**
 * Format recalled memories for mid-conversation context injection.
 */
export function formatRecalledMemories(
  memories: Record<string, unknown>[],
): string {
  if (memories.length === 0) {
    return 'No matching memories found.';
  }

  const lines = memories.map((m) => {
    const id = String(m.id);
    const table = id.split(':')[0];
    const description = describeMemory(table!, m);
    return `- [${id}] ${description}`;
  });

  return `[RECALLED MEMORIES]\n\n${lines.join('\n')}`;
}

/**
 * Format all memories with record IDs for user transparency.
 */
export function formatAllMemories(memories: {
  profile: Record<string, unknown> | null;
  preferences: Record<string, unknown>[];
  facts: Record<string, unknown>[];
  routines: Record<string, unknown>[];
  personas: Record<string, unknown>[];
  contacts: Record<string, unknown>[];
}): string {
  const sections: string[] = ['[ALL MEMORIES]'];

  // Profile
  if (memories.profile) {
    const p = memories.profile;
    const profileLines: string[] = [];
    if (p.name) profileLines.push(`  Name: ${p.name}`);
    if (p.location) profileLines.push(`  Location: ${p.location}`);
    if (p.occupation) profileLines.push(`  Occupation: ${p.occupation}`);
    if (p.birthday) profileLines.push(`  Birthday: ${p.birthday}`);
    if (p.phone) profileLines.push(`  Phone: ${p.phone}`);
    if (profileLines.length > 0) {
      sections.push(`\nProfile (${String(p.id)}):\n${profileLines.join('\n')}`);
    }
  }

  // Preferences
  if (memories.preferences.length > 0) {
    const lines = memories.preferences.map(
      (p) =>
        `- [${String(p.id)}] ${p.value}${p.context ? ` (${p.context})` : ''} [${p.importance}]`,
    );
    sections.push(`\nPreferences:\n${lines.join('\n')}`);
  }

  // Facts
  if (memories.facts.length > 0) {
    const lines = memories.facts.map((f) => {
      const superseded = f.superseded_by ? ' [SUPERSEDED]' : '';
      return `- [${String(f.id)}] ${f.content} [${f.importance}]${superseded}`;
    });
    sections.push(`\nFacts:\n${lines.join('\n')}`);
  }

  // Routines
  if (memories.routines.length > 0) {
    const lines = memories.routines.map(
      (r) =>
        `- [${String(r.id)}] ${r.activity}${r.schedule ? ` — ${r.schedule}` : ''} [${r.importance}]`,
    );
    sections.push(`\nRoutines:\n${lines.join('\n')}`);
  }

  // Personas
  if (memories.personas.length > 0) {
    const lines = memories.personas.map(
      (p) =>
        `- [${String(p.id)}] ${p.name}${p.communication_style ? ` — ${p.communication_style}` : ''}`,
    );
    sections.push(`\nPersonas:\n${lines.join('\n')}`);
  }

  // Contacts
  if (memories.contacts.length > 0) {
    const lines = memories.contacts.map(
      (c) =>
        `- [${String(c.id)}] ${c.name}${c.notes && c.notes !== 'NONE' ? ` — ${c.notes}` : ''}`,
    );
    sections.push(`\nContacts:\n${lines.join('\n')}`);
  }

  // Empty state
  if (sections.length === 1) {
    return '[ALL MEMORIES]\n\nNo memories stored yet.';
  }

  return sections.join('\n');
}

/**
 * Describe a memory record in a human-readable way based on its table type.
 */
function describeMemory(
  table: string,
  m: Record<string, unknown>,
): string {
  switch (table) {
    case 'preference':
      return `${m.value}${m.context ? ` (${m.context})` : ''}`;
    case 'fact':
      return String(m.content ?? '');
    case 'routine':
      return `${m.activity}${m.schedule ? ` — ${m.schedule}` : ''}`;
    case 'persona':
      return `${m.name}${m.communication_style ? ` — ${m.communication_style}` : ''}`;
    default:
      return JSON.stringify(m);
  }
}
