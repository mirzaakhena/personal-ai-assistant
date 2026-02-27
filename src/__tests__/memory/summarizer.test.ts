import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initMemoryDb, closeMemoryDb, getMemoryDb } from '../../db/memory.js';
import {
  trackMessage,
  getTrackedMessages,
  clearTrackedMessages,
  generateConversationSummary,
  saveConversationSummary,
  summarizeAndSave,
  type ConversationMessage,
  type ConversationSummaryResult,
} from '../../memory/summarizer.js';
import { getOrCreateSelfPerson } from '../../memory/operations.js';
import { StringRecordId } from 'surrealdb';

const PHONE_A = '+6281234567890';
const PHONE_B = '+6289876543210';

// --- Message tracking tests (pure in-memory, no DB) ---

describe('message tracking', () => {
  afterEach(() => {
    clearTrackedMessages(PHONE_A);
    clearTrackedMessages(PHONE_B);
  });

  it('tracks messages per phone number', () => {
    trackMessage(PHONE_A, 'user', 'Hello');
    trackMessage(PHONE_A, 'assistant', 'Hi there!');
    trackMessage(PHONE_B, 'user', 'Hey');

    const msgsA = getTrackedMessages(PHONE_A);
    expect(msgsA).toHaveLength(2);
    expect(msgsA[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(msgsA[1]).toEqual({ role: 'assistant', content: 'Hi there!' });

    const msgsB = getTrackedMessages(PHONE_B);
    expect(msgsB).toHaveLength(1);
    expect(msgsB[0]).toEqual({ role: 'user', content: 'Hey' });
  });

  it('returns empty array for unknown phone number', () => {
    expect(getTrackedMessages('+000')).toEqual([]);
  });

  it('clears messages for a phone number without affecting others', () => {
    trackMessage(PHONE_A, 'user', 'msg1');
    trackMessage(PHONE_B, 'user', 'msg2');

    clearTrackedMessages(PHONE_A);

    expect(getTrackedMessages(PHONE_A)).toEqual([]);
    expect(getTrackedMessages(PHONE_B)).toHaveLength(1);
  });
});

// --- generateConversationSummary tests ---

describe('generateConversationSummary', () => {
  it('returns null for empty messages', async () => {
    const result = await generateConversationSummary([]);
    expect(result).toBeNull();
  });

  it('returns null when ANTHROPIC_API_KEY is not set', async () => {
    const orig = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await generateConversationSummary([
      { role: 'user', content: 'Hello' },
    ]);
    expect(result).toBeNull();

    if (orig) process.env.ANTHROPIC_API_KEY = orig;
  });

  it('calls Anthropic API and parses valid response', async () => {
    const mockResponse: ConversationSummaryResult = {
      summary: 'User discussed coffee preferences.',
      topics: ['coffee', 'preferences'],
      key_decisions: ['Switch to oat milk'],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify(mockResponse) }],
        }),
        { status: 200 },
      ),
    );

    const orig = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const result = await generateConversationSummary([
      { role: 'user', content: 'I like coffee' },
      { role: 'assistant', content: 'What kind?' },
      { role: 'user', content: 'Oat milk latte' },
    ]);

    expect(result).toEqual(mockResponse);
    expect(fetchSpy).toHaveBeenCalledOnce();

    // Verify the API was called correctly
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((options as RequestInit).method).toBe('POST');
    const headers = (options as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');

    fetchSpy.mockRestore();
    if (orig) process.env.ANTHROPIC_API_KEY = orig;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null on API error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const orig = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const result = await generateConversationSummary([
      { role: 'user', content: 'Hello' },
    ]);

    expect(result).toBeNull();

    fetchSpy.mockRestore();
    if (orig) process.env.ANTHROPIC_API_KEY = orig;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null on invalid JSON response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'not valid json' }],
        }),
        { status: 200 },
      ),
    );

    const orig = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const result = await generateConversationSummary([
      { role: 'user', content: 'Hello' },
    ]);

    expect(result).toBeNull();

    fetchSpy.mockRestore();
    if (orig) process.env.ANTHROPIC_API_KEY = orig;
    else delete process.env.ANTHROPIC_API_KEY;
  });
});

// --- saveConversationSummary tests (requires SurrealDB) ---

describe('saveConversationSummary', () => {
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

  it('saves summary and creates had_conversation edge', async () => {
    await getOrCreateSelfPerson(PHONE_A);

    const data: ConversationSummaryResult = {
      summary: 'Discussed weekend plans and coffee preferences.',
      topics: ['weekend', 'coffee'],
      key_decisions: ['Meet at 10am Saturday'],
    };

    const recordId = await saveConversationSummary(PHONE_A, data);

    expect(recordId).toBeTruthy();
    expect(recordId).toMatch(/^conversation_summary:/);

    // Verify the record was stored
    const db = getMemoryDb();
    const result = await db.query<[Array<Record<string, unknown>>]>(
      `SELECT * FROM $id`,
      { id: new StringRecordId(recordId) },
    );

    const record = result[0]?.[0];
    expect(record).toBeDefined();
    expect(record!.summary).toBe(data.summary);
    expect(record!.topics).toEqual(data.topics);
    expect(record!.key_decisions).toEqual(data.key_decisions);
    expect(record!.access_count).toBe(0);
  });

  it('creates had_conversation edge traversable from person', async () => {
    const selfId = await getOrCreateSelfPerson(PHONE_A);

    const data: ConversationSummaryResult = {
      summary: 'Test conversation.',
      topics: ['test'],
      key_decisions: [],
    };

    await saveConversationSummary(PHONE_A, data);

    // Verify edge traversal
    const db = getMemoryDb();
    const result = await db.query<[Array<Record<string, unknown>>]>(
      `SELECT ->had_conversation->conversation_summary.* AS items FROM $selfId`,
      { selfId: new StringRecordId(selfId) },
    );

    const items =
      (result[0]?.[0] as { items?: Record<string, unknown>[] })?.items ?? [];
    expect(items).toHaveLength(1);
    expect((items[0] as { summary: string }).summary).toBe(
      'Test conversation.',
    );
  });

  it('isolates summaries between users', async () => {
    await getOrCreateSelfPerson(PHONE_A);
    await getOrCreateSelfPerson(PHONE_B);

    await saveConversationSummary(PHONE_A, {
      summary: 'Phone A conversation',
      topics: ['topicA'],
      key_decisions: [],
    });

    // Query from phone B's person — should be empty
    const db = getMemoryDb();
    const selfBResult = await db.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM person WHERE phone = $phone AND type = 'self'`,
      { phone: PHONE_B },
    );
    const selfBId = String(selfBResult[0]![0]!.id);

    const result = await db.query<[Array<Record<string, unknown>>]>(
      `SELECT ->had_conversation->conversation_summary.* AS items FROM $selfId`,
      { selfId: new StringRecordId(selfBId) },
    );

    const items =
      (result[0]?.[0] as { items?: Record<string, unknown>[] })?.items ?? [];
    expect(items).toHaveLength(0);
  });
});

// --- summarizeAndSave integration tests ---

describe('summarizeAndSave', () => {
  beforeEach(async () => {
    await initMemoryDb('mem://');
  });

  afterEach(async () => {
    clearTrackedMessages(PHONE_A);
    try {
      await closeMemoryDb();
    } catch {
      // already closed
    }
  });

  it('returns null when no messages tracked', async () => {
    const result = await summarizeAndSave(PHONE_A);
    expect(result).toBeNull();
  });

  it('generates and saves summary when messages exist', async () => {
    await getOrCreateSelfPerson(PHONE_A);

    trackMessage(PHONE_A, 'user', 'I like hiking');
    trackMessage(PHONE_A, 'user', 'Especially on weekends');

    const mockSummary: ConversationSummaryResult = {
      summary: 'User enjoys hiking on weekends.',
      topics: ['hiking', 'weekends'],
      key_decisions: [],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify(mockSummary) }],
        }),
        { status: 200 },
      ),
    );

    const orig = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const recordId = await summarizeAndSave(PHONE_A);

    expect(recordId).toBeTruthy();
    expect(recordId).toMatch(/^conversation_summary:/);

    fetchSpy.mockRestore();
    if (orig) process.env.ANTHROPIC_API_KEY = orig;
    else delete process.env.ANTHROPIC_API_KEY;
  });
});
