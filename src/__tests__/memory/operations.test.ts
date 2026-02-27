import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  recallConversations,
  getAllMemories,
  getRelationships,
  calculateRecencyScore,
  getImportanceSuggestions,
} from '../../memory/operations.js';
import { saveConversationSummary } from '../../memory/summarizer.js';

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

describe('calculateRecencyScore', () => {
  it('returns 1.0 for fundamental importance regardless of age', () => {
    const oldDate = new Date('2020-01-01');
    expect(calculateRecencyScore(oldDate, 'fundamental')).toBe(1.0);
  });

  it('returns 1.0 for a memory just created', () => {
    const now = new Date();
    const score = calculateRecencyScore(now, 'extended');
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('returns ~0.5 for a memory created 30 days ago (half-life)', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const score = calculateRecencyScore(thirtyDaysAgo, 'extended');
    expect(score).toBeCloseTo(0.5, 1);
  });

  it('returns ~0.25 for a memory created 60 days ago (two half-lives)', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const score = calculateRecencyScore(sixtyDaysAgo, 'extended');
    expect(score).toBeCloseTo(0.25, 1);
  });

  it('returns 0.5 for missing created_at', () => {
    expect(calculateRecencyScore(undefined, 'extended')).toBe(0.5);
  });

  it('handles string dates', () => {
    const now = new Date().toISOString();
    const score = calculateRecencyScore(now, 'extended');
    expect(score).toBeCloseTo(1.0, 1);
  });
});

describe('recallMemories recency-weighted scoring', () => {
  it('ranks recent memories higher than old ones with same keyword match', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const db = getMemoryDb();

    // Save two facts with the same keyword match potential
    const oldId = await saveMemory(PHONE_A, 'fact', {
      content: 'Suka makan soto',
      importance: 'extended',
    });
    const newId = await saveMemory(PHONE_A, 'fact', {
      content: 'Suka makan bakso',
      importance: 'extended',
    });

    // Manually backdate the old memory's created_at to 90 days ago
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await db.query(
      `UPDATE $id SET created_at = <datetime>$date`,
      { id: new (await import('surrealdb')).StringRecordId(oldId), date: ninetyDaysAgo },
    );

    // Both match "suka makan" equally (2/2 tokens), but newId should rank higher due to recency
    const results = await recallMemories(PHONE_A, 'suka makan');
    expect(results.length).toBe(2);
    // The more recent memory should come first
    expect(String((results[0] as Record<string, unknown>).id)).toBe(newId);
  });

  it('fundamental memories are not penalized by age in scoring', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const db = getMemoryDb();

    // Save a fundamental fact and an extended fact
    const fundamentalId = await saveMemory(PHONE_A, 'fact', {
      content: 'Alergi kacang penting',
      importance: 'fundamental',
    });
    const extendedId = await saveMemory(PHONE_A, 'fact', {
      content: 'Suka kacang goreng',
      importance: 'extended',
    });

    // Backdate BOTH memories to 90 days ago
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { StringRecordId } = await import('surrealdb');
    await db.query(
      `UPDATE $id SET created_at = <datetime>$date`,
      { id: new StringRecordId(fundamentalId), date: ninetyDaysAgo },
    );
    await db.query(
      `UPDATE $id SET created_at = <datetime>$date`,
      { id: new StringRecordId(extendedId), date: ninetyDaysAgo },
    );

    // Search for "kacang" — both match 1/1 token
    const results = await recallMemories(PHONE_A, 'kacang');
    expect(results.length).toBe(2);
    // Fundamental should rank higher because its recency score is always 1.0
    expect(String((results[0] as Record<string, unknown>).id)).toBe(fundamentalId);
  });
});

describe('recallMemories hybrid search', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('uses keyword-only weights (0.7/0.3) when embeddings are disabled', async () => {
    delete process.env.MEMORY_EMBEDDING_ENABLED;

    await getOrCreateSelfPerson(PHONE_A);
    await saveMemory(PHONE_A, 'fact', {
      content: 'Tinggal di Jakarta',
      importance: 'extended',
    });

    const results = await recallMemories(PHONE_A, 'jakarta');
    expect(results.length).toBe(1);
    // Should work same as before — keyword + recency only
    expect((results[0] as Record<string, unknown>).content).toBe('Tinggal di Jakarta');
  });

  it('uses hybrid weights (0.5/0.3/0.2) when embeddings are enabled and query embedding succeeds', async () => {
    process.env.MEMORY_EMBEDDING_ENABLED = 'true';
    process.env.MEMORY_EMBEDDING_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-key';

    // Mock fetch for both saveMemory embedding and query embedding
    const mockEmbedding = Array(10).fill(0).map((_, i) => i * 0.1);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: mockEmbedding }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await getOrCreateSelfPerson(PHONE_A);
    await saveMemory(PHONE_A, 'fact', {
      content: 'Tinggal di Jakarta Selatan',
      importance: 'extended',
    });

    const results = await recallMemories(PHONE_A, 'jakarta');
    expect(results.length).toBe(1);
    // With hybrid mode, vector similarity of identical embeddings should boost score
    expect((results[0] as Record<string, unknown>).content).toBe('Tinggal di Jakarta Selatan');
  });

  it('falls back to keyword-only when embeddings enabled but query embedding fails', async () => {
    process.env.MEMORY_EMBEDDING_ENABLED = 'true';
    // No provider configured — generateEmbedding returns null
    delete process.env.MEMORY_EMBEDDING_PROVIDER;

    await getOrCreateSelfPerson(PHONE_A);
    await saveMemory(PHONE_A, 'fact', {
      content: 'Tinggal di Jakarta',
      importance: 'extended',
    });

    const results = await recallMemories(PHONE_A, 'jakarta');
    expect(results.length).toBe(1);
    // Should gracefully fall back to keyword-only mode
    expect((results[0] as Record<string, unknown>).content).toBe('Tinggal di Jakarta');
  });

  it('includes vector-only matches (no keyword match) in hybrid mode', async () => {
    process.env.MEMORY_EMBEDDING_ENABLED = 'true';
    process.env.MEMORY_EMBEDDING_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-key';

    // Create a strong embedding for "coffee" concept
    const coffeeEmbedding = [0.9, 0.1, 0.0, 0.0, 0.0];
    const queryEmbedding = [0.85, 0.15, 0.0, 0.0, 0.0]; // Very similar to coffee

    let fetchCallCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      // First call: saveMemory embedding
      // Second call: query embedding
      const emb = fetchCallCount === 1 ? coffeeEmbedding : queryEmbedding;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: emb }] }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    await getOrCreateSelfPerson(PHONE_A);
    await saveMemory(PHONE_A, 'preference', {
      category: 'minuman',
      value: 'Suka kopi hitam',
      importance: 'extended',
    });

    // Search with a term that doesn't match keywords but has similar embedding
    const results = await recallMemories(PHONE_A, 'coffee morning');
    // "coffee" and "morning" don't match "suka kopi hitam" keywords,
    // but high vector similarity should include it
    expect(results.length).toBe(1);
    expect((results[0] as Record<string, unknown>).value).toBe('Suka kopi hitam');
  });

  it('ranks keyword+vector matches higher than keyword-only matches in hybrid mode', async () => {
    process.env.MEMORY_EMBEDDING_ENABLED = 'true';
    process.env.MEMORY_EMBEDDING_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-key';

    // Memory A: has embedding (vector+keyword)
    const embeddingA = [0.9, 0.1, 0.0];
    // Memory B: no embedding stored (keyword only)
    // Query embedding: similar to A
    const queryEmb = [0.85, 0.15, 0.0];

    let fetchCallCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      // Call 1: saveMemory for A
      // Call 2: saveMemory for B
      // Call 3: query embedding
      let emb;
      if (fetchCallCount === 1) emb = embeddingA;
      else if (fetchCallCount === 2) emb = [0.0, 0.0, 0.9]; // dissimilar embedding for B
      else emb = queryEmb;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: emb }] }),
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    await getOrCreateSelfPerson(PHONE_A);
    // Both have the same keyword "kopi"
    await saveMemory(PHONE_A, 'fact', {
      content: 'Suka kopi setiap pagi',
      importance: 'extended',
    });
    await saveMemory(PHONE_A, 'fact', {
      content: 'Kopi susu juga enak',
      importance: 'extended',
    });

    const results = await recallMemories(PHONE_A, 'kopi');
    expect(results.length).toBe(2);
    // First result should be the one with higher vector similarity (memory A)
    expect(String((results[0] as Record<string, unknown>).content)).toBe('Suka kopi setiap pagi');
  });
});

describe('saveMemory with embeddings', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('stores embedding when MEMORY_EMBEDDING_ENABLED=true and generateEmbedding returns a vector', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3];

    // Enable embeddings via env var
    process.env.MEMORY_EMBEDDING_ENABLED = 'true';
    process.env.MEMORY_EMBEDDING_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-key';

    // Mock fetch to return embedding from OpenAI
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: mockEmbedding }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await getOrCreateSelfPerson(PHONE_A);
    const recordId = await saveMemory(PHONE_A, 'fact', {
      content: 'Tinggal di Jakarta',
      importance: 'fundamental',
    });

    const db = getMemoryDb();
    const result = await db.query<[Array<{ embedding: number[] }>]>(
      `SELECT embedding FROM ${recordId}`,
    );
    expect(result[0]![0]!.embedding).toEqual(mockEmbedding);
  });

  it('stores NONE embedding when MEMORY_EMBEDDING_ENABLED is not set', async () => {
    delete process.env.MEMORY_EMBEDDING_ENABLED;

    await getOrCreateSelfPerson(PHONE_A);
    const recordId = await saveMemory(PHONE_A, 'fact', {
      content: 'Tinggal di Jakarta',
      importance: 'fundamental',
    });

    const db = getMemoryDb();
    const result = await db.query<[Array<{ embedding: unknown }>]>(
      `SELECT embedding FROM ${recordId}`,
    );
    // When disabled, embedding should be NONE (undefined in JS)
    expect(result[0]![0]!.embedding).toBeUndefined();
  });

  it('stores NONE embedding when generateEmbedding returns null', async () => {
    process.env.MEMORY_EMBEDDING_ENABLED = 'true';
    // No provider configured, so generateEmbedding returns null
    delete process.env.MEMORY_EMBEDDING_PROVIDER;

    await getOrCreateSelfPerson(PHONE_A);
    const recordId = await saveMemory(PHONE_A, 'fact', {
      content: 'Tinggal di Jakarta',
      importance: 'fundamental',
    });

    const db = getMemoryDb();
    const result = await db.query<[Array<{ embedding: unknown }>]>(
      `SELECT embedding FROM ${recordId}`,
    );
    expect(result[0]![0]!.embedding).toBeUndefined();
  });
});

describe('getImportanceSuggestions', () => {
  it('suggests promotion for extended memories with access_count >= 5', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const id = await saveMemory(PHONE_A, 'preference', {
      category: 'drink',
      value: 'Kopi hitam',
      importance: 'extended',
    });

    // Manually set access_count to 5
    const db = getMemoryDb();
    const { StringRecordId } = await import('surrealdb');
    await db.query(`UPDATE $id SET access_count = 5`, {
      id: new StringRecordId(id),
    });

    const suggestions = await getImportanceSuggestions(PHONE_A);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.record_id).toBe(id);
    expect(suggestions[0]!.current_importance).toBe('extended');
    expect(suggestions[0]!.suggested_importance).toBe('fundamental');
    expect(suggestions[0]!.reason).toContain('Accessed 5 times');
  });

  it('suggests demotion for fundamental memories not accessed in 30+ days', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const id = await saveMemory(PHONE_A, 'fact', {
      content: 'Old fact',
      importance: 'fundamental',
    });

    // Set last_accessed to 45 days ago
    const db = getMemoryDb();
    const { StringRecordId } = await import('surrealdb');
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    await db.query(
      `UPDATE $id SET last_accessed = <datetime>$date`,
      { id: new StringRecordId(id), date: fortyFiveDaysAgo },
    );

    const suggestions = await getImportanceSuggestions(PHONE_A);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.record_id).toBe(id);
    expect(suggestions[0]!.current_importance).toBe('fundamental');
    expect(suggestions[0]!.suggested_importance).toBe('extended');
    expect(suggestions[0]!.reason).toContain('Not accessed for');
  });

  it('does not suggest demotion for recently accessed fundamental memories', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const id = await saveMemory(PHONE_A, 'fact', {
      content: 'Active fact',
      importance: 'fundamental',
    });

    // Access it so last_accessed is recent
    await recallMemories(PHONE_A, 'active');

    const suggestions = await getImportanceSuggestions(PHONE_A);
    // No demotion suggestion since last_accessed is now (just accessed)
    const demotions = suggestions.filter(s => s.suggested_importance === 'extended');
    expect(demotions).toHaveLength(0);
  });

  it('does not suggest promotion for extended memories with low access count', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await saveMemory(PHONE_A, 'preference', {
      category: 'food',
      value: 'Nasi goreng',
      importance: 'extended',
    });

    // access_count is 0 by default
    const suggestions = await getImportanceSuggestions(PHONE_A);
    expect(suggestions).toHaveLength(0);
  });

  it('returns empty for user with no memories', async () => {
    const suggestions = await getImportanceSuggestions('+unknown');
    expect(suggestions).toHaveLength(0);
  });

  it('skips superseded facts', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const oldId = await saveMemory(PHONE_A, 'fact', {
      content: 'Old address',
      importance: 'extended',
    });

    // Manually set high access count on old record
    const db = getMemoryDb();
    const { StringRecordId } = await import('surrealdb');
    await db.query(`UPDATE $id SET access_count = 10`, {
      id: new StringRecordId(oldId),
    });

    // Supersede it
    await supersedeMemory(oldId, PHONE_A, 'fact', {
      content: 'New address',
      importance: 'extended',
    });

    const suggestions = await getImportanceSuggestions(PHONE_A);
    // The superseded record should not appear
    const oldSuggestions = suggestions.filter(s => s.record_id === oldId);
    expect(oldSuggestions).toHaveLength(0);
  });
});

describe('recallConversations', () => {
  it('returns empty array for user with no conversations', async () => {
    const results = await recallConversations('+unknown', 'anything');
    expect(results).toHaveLength(0);
  });

  it('returns empty array for empty query tokens', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const results = await recallConversations(PHONE_A, '   ');
    expect(results).toHaveLength(0);
  });

  it('finds conversations by keyword match in summary', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await saveConversationSummary(PHONE_A, {
      summary: 'Discussed vacation plans to Bali next month',
      topics: ['vacation', 'travel'],
      key_decisions: ['Book hotel by Friday'],
    });
    await saveConversationSummary(PHONE_A, {
      summary: 'Talked about work project deadline',
      topics: ['work', 'project'],
      key_decisions: ['Submit report on Monday'],
    });

    const results = await recallConversations(PHONE_A, 'vacation bali');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(String((results[0] as Record<string, unknown>).summary)).toContain('vacation');
  });

  it('finds conversations by topic keyword', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await saveConversationSummary(PHONE_A, {
      summary: 'General chat about hobbies',
      topics: ['photography', 'hiking'],
      key_decisions: [],
    });

    const results = await recallConversations(PHONE_A, 'photography');
    expect(results).toHaveLength(1);
    expect((results[0] as Record<string, unknown>).summary).toBe('General chat about hobbies');
  });

  it('finds conversations by key_decisions keyword', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await saveConversationSummary(PHONE_A, {
      summary: 'Planning session',
      topics: ['planning'],
      key_decisions: ['Buy new laptop before March'],
    });

    const results = await recallConversations(PHONE_A, 'laptop');
    expect(results).toHaveLength(1);
  });

  it('respects the limit parameter', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    for (let i = 0; i < 5; i++) {
      await saveConversationSummary(PHONE_A, {
        summary: `Conversation about topic ${i}`,
        topics: ['common'],
        key_decisions: [],
      });
    }

    const results = await recallConversations(PHONE_A, 'common', 2);
    expect(results).toHaveLength(2);
  });

  it('does not return conversations from other users', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await getOrCreateSelfPerson(PHONE_B);

    await saveConversationSummary(PHONE_A, {
      summary: 'Secret conversation about project alpha',
      topics: ['alpha'],
      key_decisions: [],
    });

    const resultsA = await recallConversations(PHONE_A, 'alpha');
    const resultsB = await recallConversations(PHONE_B, 'alpha');

    expect(resultsA).toHaveLength(1);
    expect(resultsB).toHaveLength(0);
  });

  it('bumps access count on returned conversations', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await saveConversationSummary(PHONE_A, {
      summary: 'Discussed cooking recipes',
      topics: ['cooking'],
      key_decisions: [],
    });

    const results = await recallConversations(PHONE_A, 'cooking');
    expect(results).toHaveLength(1);
    const id = String((results[0] as Record<string, unknown>).id);

    // Check access_count was bumped
    const db = getMemoryDb();
    const { StringRecordId } = await import('surrealdb');
    const check = await db.query<[Array<{ access_count: number }>]>(
      `SELECT access_count FROM $id`,
      { id: new StringRecordId(id) },
    );
    expect(check[0]![0]!.access_count).toBe(1);
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
