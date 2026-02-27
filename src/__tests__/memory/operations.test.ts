import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initMemoryDb, closeMemoryDb, getMemoryDb } from '../../db/memory.js';
import {
  getOrCreateSelfPerson,
  upsertContact,
  saveMemory,
  updateMemory,
  deleteMemory,
  supersedeMemory,
  getFundamentalMemories,
  recallMemories,
  getAllMemories,
  getRelationships,
} from '../../memory/operations.js';

const PHONE_A = '+6281234567890';
const PHONE_B = '+6289876543210';

beforeEach(async () => {
  await initMemoryDb('mem://');
});

afterEach(async () => {
  try {
    await closeMemoryDb();
  } catch {
    // already closed
  }
});

describe('getOrCreateSelfPerson', () => {
  it('creates a self person node when none exists', async () => {
    const id = await getOrCreateSelfPerson(PHONE_A);
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');

    // Verify it's in the database
    const db = getMemoryDb();
    const result = await db.query<[Array<{ type: string; phone: string }>]>(
      `SELECT type, phone FROM person WHERE phone = $phone AND type = 'self'`,
      { phone: PHONE_A },
    );
    expect(result[0]).toHaveLength(1);
    expect(result[0]![0]!.type).toBe('self');
    expect(result[0]![0]!.phone).toBe(PHONE_A);
  });

  it('returns existing self person on subsequent calls', async () => {
    const id1 = await getOrCreateSelfPerson(PHONE_A);
    const id2 = await getOrCreateSelfPerson(PHONE_A);
    expect(id1).toBe(id2);
  });

  it('creates separate self persons for different phone numbers', async () => {
    const idA = await getOrCreateSelfPerson(PHONE_A);
    const idB = await getOrCreateSelfPerson(PHONE_B);
    expect(idA).not.toBe(idB);
  });
});

describe('upsertContact', () => {
  it('creates a contact and knows edge', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const contactId = await upsertContact(PHONE_A, 'Budi', 'friend', 'Teman kerja');
    expect(contactId).toBeDefined();

    // Verify contact exists
    const db = getMemoryDb();
    const result = await db.query<[Array<{ name: string; type: string }>]>(
      `SELECT name, type FROM ${contactId}`,
    );
    expect(result[0]![0]!.name).toBe('Budi');
    expect(result[0]![0]!.type).toBe('contact');

    // Verify knows edge exists
    const edges = await db.query<[Array<{ relationship_type: string }>]>(
      `SELECT ->knows->person.name AS names FROM person WHERE phone = $phone AND type = 'self'`,
      { phone: PHONE_A },
    );
    const names = (edges[0]?.[0] as { names?: string[] })?.names;
    expect(names).toContain('Budi');
  });

  it('updates existing contact by name', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await upsertContact(PHONE_A, 'Budi', 'friend');
    const id2 = await upsertContact(PHONE_A, 'Budi', 'coworker', 'Updated notes');

    // Should still be only one Budi
    const db = getMemoryDb();
    const result = await db.query<[Array<{ name: string }>]>(
      `SELECT * FROM person WHERE name = 'Budi' AND type = 'contact'`,
    );
    expect(result[0]).toHaveLength(1);

    // Verify the knows edge has updated relationship_type via getRelationships
    const rels = await getRelationships(PHONE_A);
    expect(rels).toHaveLength(1);
    expect((rels[0] as Record<string, unknown>).relationship_type).toBe('coworker');
  });
});

describe('saveMemory', () => {
  it('saves a preference and creates edge from self', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const id = await saveMemory(PHONE_A, 'preference', {
      category: 'food',
      value: 'Suka kopi hitam',
      importance: 'fundamental',
    });
    expect(id).toBeDefined();
    expect(id).toContain('preference');

    // Verify edge exists
    const db = getMemoryDb();
    const result = await db.query<[unknown[]]>(
      `SELECT ->has_preference->preference.value AS values FROM person WHERE phone = $phone AND type = 'self'`,
      { phone: PHONE_A },
    );
    const values = (result[0]?.[0] as { values?: string[] })?.values;
    expect(values).toContain('Suka kopi hitam');
  });

  it('saves a fact and creates edge from self', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const id = await saveMemory(PHONE_A, 'fact', {
      content: 'Alergi kacang',
      category: 'health',
      importance: 'fundamental',
    });
    expect(id).toContain('fact');
  });

  it('saves a routine and creates edge from self', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const id = await saveMemory(PHONE_A, 'routine', {
      activity: 'Ngopi',
      schedule: 'Setiap pagi jam 7',
      importance: 'fundamental',
    });
    expect(id).toContain('routine');
  });

  it('saves a persona and creates edge from self', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const id = await saveMemory(PHONE_A, 'persona', {
      name: 'Casual',
      communication_style: 'friendly, casual',
      language_preference: 'Indonesian',
    });
    expect(id).toContain('persona');
  });
});

describe('updateMemory', () => {
  it('updates fields on an existing memory node', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const id = await saveMemory(PHONE_A, 'preference', {
      category: 'food',
      value: 'Suka teh',
      importance: 'extended',
    });

    await updateMemory(id, { value: 'Suka kopi', importance: 'fundamental' });

    const db = getMemoryDb();
    const result = await db.query<[Array<{ value: string; importance: string }>]>(
      `SELECT * FROM $id`,
      { id: new (await import('surrealdb')).StringRecordId(id) },
    );
    expect(result[0]![0]!.value).toBe('Suka kopi');
    expect(result[0]![0]!.importance).toBe('fundamental');
  });
});

describe('deleteMemory', () => {
  it('deletes a memory node and its edges', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const id = await saveMemory(PHONE_A, 'fact', {
      content: 'To be deleted',
      importance: 'extended',
    });

    await deleteMemory(id);

    // Node should be gone
    const db = getMemoryDb();
    const result = await db.query<[unknown[]]>(`SELECT * FROM ${id}`);
    expect(result[0]).toHaveLength(0);

    // Edge should be gone too
    const edges = await db.query<[unknown[]]>(
      `SELECT * FROM has_fact WHERE out = ${id}`,
    );
    expect(edges[0]).toHaveLength(0);
  });
});

describe('supersedeMemory', () => {
  it('creates new memory and marks old one as superseded', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const oldId = await saveMemory(PHONE_A, 'fact', {
      content: 'Tinggal di Jakarta',
      importance: 'fundamental',
    });

    const newId = await supersedeMemory(oldId, PHONE_A, 'fact', {
      content: 'Tinggal di Bandung',
      importance: 'fundamental',
    });

    expect(newId).toBeDefined();
    expect(newId).not.toBe(oldId);

    // Old record should have superseded_by pointing to new
    const db = getMemoryDb();
    const result = await db.query<[Array<{ superseded_by: string }>]>(
      `SELECT superseded_by FROM ${oldId}`,
    );
    expect(result[0]![0]!.superseded_by).toBeDefined();
  });
});

describe('getFundamentalMemories', () => {
  it('returns fundamental memories grouped by type', async () => {
    await getOrCreateSelfPerson(PHONE_A);

    // Save fundamental memories
    await saveMemory(PHONE_A, 'fact', {
      content: 'Nama: Mirza',
      category: 'identity',
      importance: 'fundamental',
    });
    await saveMemory(PHONE_A, 'preference', {
      category: 'drink',
      value: 'Kopi hitam',
      importance: 'fundamental',
    });
    await saveMemory(PHONE_A, 'routine', {
      activity: 'Ngopi pagi',
      schedule: 'Jam 7',
      importance: 'fundamental',
    });
    await saveMemory(PHONE_A, 'persona', {
      name: 'Casual',
      communication_style: 'friendly',
    });

    // Also save an extended memory (should NOT appear)
    await saveMemory(PHONE_A, 'fact', {
      content: 'Hobi memancing',
      category: 'hobby',
      importance: 'extended',
    });

    const result = await getFundamentalMemories(PHONE_A);

    expect(result.profile).toBeDefined();
    expect(result.preferences).toHaveLength(1);
    expect(result.facts).toHaveLength(1); // Only fundamental
    expect(result.routines).toHaveLength(1);
    expect(result.persona).toBeDefined();
  });

  it('returns empty structure for unknown phone number', async () => {
    const result = await getFundamentalMemories('+999');
    expect(result.profile).toBeNull();
    expect(result.preferences).toHaveLength(0);
    expect(result.facts).toHaveLength(0);
    expect(result.routines).toHaveLength(0);
    expect(result.persona).toBeNull();
  });

  it('bumps access_count and last_accessed on returned memories', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const id = await saveMemory(PHONE_A, 'fact', {
      content: 'Test access',
      importance: 'fundamental',
    });

    await getFundamentalMemories(PHONE_A);
    await getFundamentalMemories(PHONE_A);

    const db = getMemoryDb();
    const result = await db.query<[Array<{ access_count: number; last_accessed: string }>]>(
      `SELECT access_count, last_accessed FROM ${id}`,
    );
    expect(result[0]![0]!.access_count).toBe(2);
    expect(result[0]![0]!.last_accessed).toBeDefined();
  });
});

describe('recallMemories', () => {
  it('finds memories by keyword search', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await saveMemory(PHONE_A, 'fact', {
      content: 'Suka makan nasi goreng',
      importance: 'extended',
    });
    await saveMemory(PHONE_A, 'preference', {
      category: 'food',
      value: 'Kopi hitam setiap pagi',
      importance: 'extended',
    });

    const results = await recallMemories(PHONE_A, 'nasi goreng');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r: Record<string, unknown>) => String(r.content ?? '').includes('nasi goreng'))).toBe(true);
  });

  it('uses multi-keyword tokenized matching', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await saveMemory(PHONE_A, 'routine', {
      activity: 'Ngopi pagi hari',
      schedule: 'Jam 7',
      importance: 'extended',
    });

    // "ngopi pagi" should match "Ngopi pagi hari" — both tokens match
    const results = await recallMemories(PHONE_A, 'ngopi pagi');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('scores by matched_tokens / total_tokens', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    // This has both "ngopi" and "pagi"
    await saveMemory(PHONE_A, 'routine', {
      activity: 'Ngopi pagi hari',
      schedule: 'Jam 7',
      importance: 'extended',
    });
    // This only has "pagi"
    await saveMemory(PHONE_A, 'fact', {
      content: 'Olahraga pagi setiap Senin',
      importance: 'extended',
    });

    const results = await recallMemories(PHONE_A, 'ngopi pagi');
    // The routine with both tokens should rank higher
    expect(results.length).toBe(2);
    const first = results[0] as Record<string, unknown>;
    expect(String(first.activity ?? first.content ?? '')).toContain('Ngopi');
  });

  it('returns empty for unmatched query', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await saveMemory(PHONE_A, 'fact', {
      content: 'Tinggal di Jakarta',
      importance: 'extended',
    });

    const results = await recallMemories(PHONE_A, 'bandung');
    expect(results).toHaveLength(0);
  });

  it('bumps access_count on recalled memories', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const id = await saveMemory(PHONE_A, 'fact', {
      content: 'Tinggal di Jakarta',
      importance: 'extended',
    });

    await recallMemories(PHONE_A, 'jakarta');

    const db = getMemoryDb();
    const result = await db.query<[Array<{ access_count: number }>]>(
      `SELECT access_count FROM ${id}`,
    );
    expect(result[0]![0]!.access_count).toBe(1);
  });
});

describe('getAllMemories', () => {
  it('returns all memories grouped by type', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await saveMemory(PHONE_A, 'fact', { content: 'Fact 1', importance: 'fundamental' });
    await saveMemory(PHONE_A, 'preference', { category: 'food', value: 'Kopi', importance: 'extended' });
    await saveMemory(PHONE_A, 'routine', { activity: 'Jog', importance: 'extended' });

    const result = await getAllMemories(PHONE_A);
    expect(result.facts).toHaveLength(1);
    expect(result.preferences).toHaveLength(1);
    expect(result.routines).toHaveLength(1);
  });

  it('returns empty groups for user with no memories', async () => {
    const result = await getAllMemories('+unknown');
    expect(result.facts).toHaveLength(0);
    expect(result.preferences).toHaveLength(0);
    expect(result.routines).toHaveLength(0);
    expect(result.personas).toHaveLength(0);
  });
});

describe('getRelationships', () => {
  it('returns all contacts with relationship info', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await upsertContact(PHONE_A, 'Budi', 'friend', 'Teman SMA');
    await upsertContact(PHONE_A, 'Ani', 'coworker', 'Rekan kerja');

    const relationships = await getRelationships(PHONE_A);
    expect(relationships).toHaveLength(2);

    const names = relationships.map((r: Record<string, unknown>) => r.name);
    expect(names).toContain('Budi');
    expect(names).toContain('Ani');
  });

  it('returns empty for user with no contacts', async () => {
    const relationships = await getRelationships('+unknown');
    expect(relationships).toHaveLength(0);
  });
});

describe('multi-user isolation', () => {
  it('does not leak memories between phone numbers', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await getOrCreateSelfPerson(PHONE_B);

    await saveMemory(PHONE_A, 'fact', { content: 'Secret A', importance: 'fundamental' });
    await saveMemory(PHONE_B, 'fact', { content: 'Secret B', importance: 'fundamental' });

    const memA = await getFundamentalMemories(PHONE_A);
    const memB = await getFundamentalMemories(PHONE_B);

    expect(memA.facts).toHaveLength(1);
    expect((memA.facts[0] as Record<string, unknown>).content).toBe('Secret A');

    expect(memB.facts).toHaveLength(1);
    expect((memB.facts[0] as Record<string, unknown>).content).toBe('Secret B');
  });

  it('does not leak contacts between phone numbers', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await getOrCreateSelfPerson(PHONE_B);

    await upsertContact(PHONE_A, 'Budi', 'friend');

    const relA = await getRelationships(PHONE_A);
    const relB = await getRelationships(PHONE_B);

    expect(relA).toHaveLength(1);
    expect(relB).toHaveLength(0);
  });

  it('recall only returns memories for the queried phone', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await getOrCreateSelfPerson(PHONE_B);

    await saveMemory(PHONE_A, 'fact', { content: 'Jakarta A', importance: 'extended' });
    await saveMemory(PHONE_B, 'fact', { content: 'Jakarta B', importance: 'extended' });

    const resultsA = await recallMemories(PHONE_A, 'jakarta');
    const resultsB = await recallMemories(PHONE_B, 'jakarta');

    expect(resultsA).toHaveLength(1);
    expect((resultsA[0] as Record<string, unknown>).content).toBe('Jakarta A');

    expect(resultsB).toHaveLength(1);
    expect((resultsB[0] as Record<string, unknown>).content).toBe('Jakarta B');
  });
});
