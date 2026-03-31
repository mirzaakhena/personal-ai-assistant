import { getMemoryDb, rid } from '../../db/memory.js';

// Maps memory table to its edge table
export const EDGE_TABLE_MAP: Record<string, string> = {
  preference: 'has_preference',
  fact: 'has_fact',
  routine: 'has_routine',
  persona: 'prefers_persona',
};

// All edge tables for cleanup
export const ALL_EDGE_TABLES = [
  'has_preference',
  'has_fact',
  'has_routine',
  'prefers_persona',
];

// Searchable fields per table
export const SEARCHABLE_FIELDS: Record<string, string[]> = {
  preference: ['value', 'category', 'context'],
  fact: ['content', 'category'],
  routine: ['activity', 'schedule', 'details'],
  persona: ['name', 'personality_traits', 'communication_style'],
};

export type MemoryTable = 'preference' | 'fact' | 'routine' | 'persona';

/**
 * Convert a record result to a string record ID.
 */
export function toRecordIdStr(result: unknown): string {
  if (result && typeof result === 'object' && 'id' in result) {
    return String((result as { id: unknown }).id);
  }
  throw new Error('Could not extract record ID from result');
}

/**
 * Bump access_count and last_accessed for a list of record IDs.
 */
export async function bumpAccess(recordIds: string[]): Promise<void> {
  if (recordIds.length === 0) return;
  const db = getMemoryDb();
  for (const id of recordIds) {
    await db.query(
      `UPDATE $id SET access_count = access_count + 1, last_accessed = time::now()`,
      { id: rid(id) },
    );
  }
}
