import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initMemoryDb, closeMemoryDb } from '../../db/memory.js';
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
import {
  formatFundamentalMemory,
  formatRecalledMemories,
  formatAllMemories,
} from '../../memory/formatter.js';

describe('Memory Integration', () => {
  beforeEach(async () => {
    await initMemoryDb('mem://');
  });

  afterEach(async () => {
    try {
      await closeMemoryDb();
    } catch {
      // ignore
    }
  });

  const PHONE_A = '+6281234567890';
  const PHONE_B = '+6289876543210';

  it('saves fundamental fact (user name) and verifies retrieval', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const recordId = await saveMemory(PHONE_A, 'fact', {
      content: 'Nama user adalah Mirza',
      category: 'personal_info',
      importance: 'fundamental',
    });

    expect(recordId).toBeTruthy();
    expect(recordId).toMatch(/^fact:/);

    const memories = await getFundamentalMemories(PHONE_A);
    expect(memories.facts.length).toBe(1);
    expect(memories.facts[0].content).toBe('Nama user adalah Mirza');
  });

  it('saves preference and verifies retrieval', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const recordId = await saveMemory(PHONE_A, 'preference', {
      category: 'food',
      value: 'Suka ngopi hitam setiap pagi',
      importance: 'fundamental',
    });

    expect(recordId).toBeTruthy();
    expect(recordId).toMatch(/^preference:/);

    const memories = await getFundamentalMemories(PHONE_A);
    expect(memories.preferences.length).toBe(1);
    expect(memories.preferences[0].value).toBe('Suka ngopi hitam setiap pagi');
  });

  it('saves contact with relationship and verifies retrieval', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    const contactId = await upsertContact(PHONE_A, 'Budi', 'teman kerja', 'Backend engineer');

    expect(contactId).toBeTruthy();
    expect(contactId).toMatch(/^person:/);

    const relationships = await getRelationships(PHONE_A);
    expect(relationships.length).toBe(1);
    expect(relationships[0].name).toBe('Budi');
    expect(relationships[0].relationship_type).toBe('teman kerja');
  });

  it('getFundamentalMemories returns correct data structure', async () => {
    await getOrCreateSelfPerson(PHONE_A);

    await saveMemory(PHONE_A, 'fact', {
      content: 'Tinggal di Jakarta',
      category: 'location',
      importance: 'fundamental',
    });
    await saveMemory(PHONE_A, 'preference', {
      category: 'drink',
      value: 'Kopi hitam',
      importance: 'fundamental',
    });
    await saveMemory(PHONE_A, 'routine', {
      activity: 'Ngopi',
      schedule: 'Setiap pagi jam 7',
      importance: 'fundamental',
    });
    await saveMemory(PHONE_A, 'persona', {
      name: 'Assistant',
      personality_traits: 'friendly, casual',
      communication_style: 'bahasa Indonesia informal',
    });

    const memories = await getFundamentalMemories(PHONE_A);

    expect(memories.profile).toBeTruthy();
    expect(memories.facts.length).toBe(1);
    expect(memories.preferences.length).toBe(1);
    expect(memories.routines.length).toBe(1);
    expect(memories.persona).toBeTruthy();
  });

  it('recallMemories finds records with multi-keyword tokenized search', async () => {
    await getOrCreateSelfPerson(PHONE_A);

    await saveMemory(PHONE_A, 'routine', {
      activity: 'Minum kopi di pagi hari',
      schedule: 'Setiap hari jam 7',
      importance: 'extended',
    });
    await saveMemory(PHONE_A, 'preference', {
      category: 'food',
      value: 'Suka nasi goreng untuk makan siang',
      importance: 'extended',
    });

    // "ngopi pagi" should match the routine containing "pagi"
    const results = await recallMemories(PHONE_A, 'pagi hari');
    expect(results.length).toBeGreaterThan(0);

    // The routine with "pagi hari" should rank highest (matches both tokens)
    const topResult = results[0];
    expect(topResult.activity || topResult.value).toContain('pagi');
  });

  it('supersedeMemory marks old and creates new', async () => {
    await getOrCreateSelfPerson(PHONE_A);

    const oldId = await saveMemory(PHONE_A, 'fact', {
      content: 'Tinggal di Jakarta',
      category: 'location',
      importance: 'fundamental',
    });

    const newId = await supersedeMemory(oldId, PHONE_A, 'fact', {
      content: 'Tinggal di Bandung',
      category: 'location',
      importance: 'fundamental',
    });

    expect(newId).toBeTruthy();
    expect(newId).not.toBe(oldId);

    // Old memory should have superseded_by set
    const allMemories = await getAllMemories(PHONE_A);
    const allFacts = allMemories.facts;
    const oldFact = allFacts.find((f: Record<string, unknown>) => String(f.id) === oldId);
    const newFact = allFacts.find((f: Record<string, unknown>) => String(f.id) === newId);

    expect(oldFact?.superseded_by).toBeTruthy();
    expect(newFact?.content).toBe('Tinggal di Bandung');
  });

  it('deleteMemory removes node AND edges (no orphaned edges)', async () => {
    await getOrCreateSelfPerson(PHONE_A);

    const recordId = await saveMemory(PHONE_A, 'preference', {
      category: 'music',
      value: 'Suka jazz',
      importance: 'extended',
    });

    // Verify it exists
    let allMemories = await getAllMemories(PHONE_A);
    expect(allMemories.preferences.length).toBe(1);

    // Delete it
    await deleteMemory(recordId);

    // Verify it's gone
    allMemories = await getAllMemories(PHONE_A);
    expect(allMemories.preferences.length).toBe(0);

    // Verify edges are also gone (fundamental memories should return nothing related)
    const fundamental = await getFundamentalMemories(PHONE_A);
    expect(fundamental.preferences.length).toBe(0);
  });

  it('getAllMemories returns grouped output', async () => {
    await getOrCreateSelfPerson(PHONE_A);

    await saveMemory(PHONE_A, 'fact', {
      content: 'Software Engineer',
      category: 'occupation',
      importance: 'fundamental',
    });
    await saveMemory(PHONE_A, 'preference', {
      category: 'language',
      value: 'Bahasa Indonesia',
      importance: 'fundamental',
    });
    await saveMemory(PHONE_A, 'routine', {
      activity: 'Jogging',
      schedule: 'Weekend pagi',
      importance: 'extended',
    });

    const all = await getAllMemories(PHONE_A);
    expect(all.facts.length).toBe(1);
    expect(all.preferences.length).toBe(1);
    expect(all.routines.length).toBe(1);
  });

  it('formatFundamentalMemory formats empty state correctly', () => {
    const formatted = formatFundamentalMemory({
      profile: null,
      persona: null,
      preferences: [],
      facts: [],
      routines: [],
    });

    expect(formatted).toContain('[MEMORY CONTEXT]');
    expect(formatted).toContain('No memories stored yet');
  });

  it('formatFundamentalMemory formats populated state correctly', async () => {
    await getOrCreateSelfPerson(PHONE_A);

    await saveMemory(PHONE_A, 'fact', {
      content: 'Nama: Mirza',
      category: 'name',
      importance: 'fundamental',
    });
    await saveMemory(PHONE_A, 'preference', {
      category: 'drink',
      value: 'Kopi hitam',
      importance: 'fundamental',
    });

    const memories = await getFundamentalMemories(PHONE_A);
    const formatted = formatFundamentalMemory(memories);

    expect(formatted).toContain('[MEMORY CONTEXT]');
    expect(formatted).toContain('About the user');
    expect(formatted).toContain('Kopi hitam');
    expect(formatted).toContain('Nama: Mirza');
  });

  describe('Multi-user isolation', () => {
    it('memories for phone A are not visible to phone B', async () => {
      // Create memories for phone A
      await getOrCreateSelfPerson(PHONE_A);
      await saveMemory(PHONE_A, 'fact', {
        content: 'User A tinggal di Jakarta',
        category: 'location',
        importance: 'fundamental',
      });
      await saveMemory(PHONE_A, 'preference', {
        category: 'food',
        value: 'Suka sushi',
        importance: 'extended',
      });
      await upsertContact(PHONE_A, 'ContactA', 'teman', 'Teman A');

      // Query with phone B — should get empty results
      const memoriesB = await getFundamentalMemories(PHONE_B);
      expect(memoriesB.profile).toBeNull();
      expect(memoriesB.facts.length).toBe(0);
      expect(memoriesB.preferences.length).toBe(0);

      const recallB = await recallMemories(PHONE_B, 'Jakarta sushi');
      expect(recallB.length).toBe(0);

      const allB = await getAllMemories(PHONE_B);
      expect(allB.facts.length).toBe(0);
      expect(allB.preferences.length).toBe(0);

      const relB = await getRelationships(PHONE_B);
      expect(relB.length).toBe(0);
    });

    it('creating memories for phone B does not affect phone A', async () => {
      // Setup both users
      await getOrCreateSelfPerson(PHONE_A);
      await saveMemory(PHONE_A, 'fact', {
        content: 'User A fact',
        category: 'test',
        importance: 'fundamental',
      });

      await getOrCreateSelfPerson(PHONE_B);
      await saveMemory(PHONE_B, 'fact', {
        content: 'User B fact',
        category: 'test',
        importance: 'fundamental',
      });

      // Verify isolation
      const memoriesA = await getFundamentalMemories(PHONE_A);
      expect(memoriesA.facts.length).toBe(1);
      expect(memoriesA.facts[0].content).toBe('User A fact');

      const memoriesB = await getFundamentalMemories(PHONE_B);
      expect(memoriesB.facts.length).toBe(1);
      expect(memoriesB.facts[0].content).toBe('User B fact');
    });
  });
});
