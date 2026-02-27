import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initMemoryDb, closeMemoryDb } from '../../db/memory.js';
import { createMemoryTools, type MemoryContext } from '../../tools/memory.js';
import { saveConversationSummary } from '../../memory/summarizer.js';

const PHONE = '+6281234567890';

let tools: ReturnType<typeof createMemoryTools>;
let memCtx: MemoryContext;

// Helper: find a tool by name and call it
function findTool(name: string) {
  // Tools from claude-agent-sdk have a .name property based on the first arg to tool()
  // We access the handler through the tool's callable interface
  return tools.find((t) => {
    // The tool object from SDK has metadata; check via JSON or internal name
    const serialized = JSON.stringify(t);
    return serialized.includes(`"name":"${name}"`);
  });
}

// Helper to call a tool's handler — tools from SDK expose an execute-like interface
// We'll invoke them by extracting the handler. Since `tool()` returns an object with
// inputSchema and a callback, we access it through the tool definition.
// The simplest approach: use the tool function directly via the SDK's internal structure.

// Actually, let's test the tools by importing the operations directly with a real in-memory DB,
// since the tool functions are thin wrappers around operations. This gives us integration coverage
// at the tool level without needing to mock.

beforeEach(async () => {
  await initMemoryDb('mem://');
  memCtx = { phoneNumber: PHONE };
  tools = createMemoryTools(memCtx);
});

afterEach(async () => {
  try {
    await closeMemoryDb();
  } catch {
    // already closed
  }
});

// The SDK tool() returns objects with specific structure. Let's extract the handler.
// Based on the pattern, each tool has: { name, description, inputSchema, handler }
// We need to figure out the actual shape. Let's inspect.

function getToolHandler(name: string): (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }> {
  for (const t of tools) {
    // The tool object from SDK — let's check its properties
    const tAny = t as Record<string, unknown>;
    if (tAny.name === name) {
      return tAny.handler as (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
    }
  }
  throw new Error(`Tool "${name}" not found. Available: ${tools.map((t) => (t as Record<string, unknown>).name).join(', ')}`);
}

function parseResult(result: { content: Array<{ type: string; text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('save_memory tool', () => {
  it('saves a fact memory and returns record_id', async () => {
    const handler = getToolHandler('save_memory');
    const result = await handler({
      memory_type: 'fact',
      data: { content: 'Allergic to peanuts', category: 'health', importance: 'fundamental' },
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.record_id).toBeDefined();
    expect(String(parsed.record_id)).toMatch(/^fact:/);
  });

  it('saves a preference memory', async () => {
    const handler = getToolHandler('save_memory');
    const result = await handler({
      memory_type: 'preference',
      data: { category: 'food', value: 'Suka kopi hitam', importance: 'extended' },
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(String(parsed.record_id)).toMatch(/^preference:/);
  });

  it('saves a contact via upsertContact', async () => {
    const handler = getToolHandler('save_memory');
    const result = await handler({
      memory_type: 'contact',
      data: { name: 'Budi', relationship: 'colleague', notes: 'Works at same company' },
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(String(parsed.record_id)).toMatch(/^person:/);
  });

  it('returns error when contact missing required fields', async () => {
    const handler = getToolHandler('save_memory');
    const result = await handler({
      memory_type: 'contact',
      data: { name: 'Budi' },
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('relationship');
  });
});

describe('update_memory tool', () => {
  it('updates an existing memory', async () => {
    const saveHandler = getToolHandler('save_memory');
    const saveResult = await saveHandler({
      memory_type: 'fact',
      data: { content: 'Lives in Jakarta', category: 'location', importance: 'fundamental' },
    });
    const recordId = parseResult(saveResult).record_id as string;

    const updateHandler = getToolHandler('update_memory');
    const result = await updateHandler({
      record_id: recordId,
      new_data: { content: 'Lives in Bandung' },
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.record_id).toBe(recordId);
  });

  it('supersedes a memory and returns new record_id', async () => {
    const saveHandler = getToolHandler('save_memory');
    const saveResult = await saveHandler({
      memory_type: 'fact',
      data: { content: 'Lives in Jakarta', category: 'location', importance: 'fundamental' },
    });
    const oldId = parseResult(saveResult).record_id as string;

    const updateHandler = getToolHandler('update_memory');
    const result = await updateHandler({
      record_id: oldId,
      new_data: { content: 'Lives in Bandung', category: 'location', importance: 'fundamental' },
      supersede: true,
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.new_record_id).toBeDefined();
    expect(parsed.superseded).toBe(oldId);
    expect(parsed.new_record_id).not.toBe(oldId);
  });

  it('returns error for invalid table prefix on supersede', async () => {
    const updateHandler = getToolHandler('update_memory');
    const result = await updateHandler({
      record_id: 'invalid:abc',
      new_data: { content: 'test' },
      supersede: true,
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Invalid record_id table prefix');
  });
});

describe('recall_memory tool', () => {
  it('recalls matching memories by keyword', async () => {
    const saveHandler = getToolHandler('save_memory');
    await saveHandler({
      memory_type: 'fact',
      data: { content: 'Allergic to peanuts', category: 'health', importance: 'fundamental' },
    });
    await saveHandler({
      memory_type: 'preference',
      data: { category: 'food', value: 'Suka kopi hitam', importance: 'extended' },
    });

    const recallHandler = getToolHandler('recall_memory');
    const result = await recallHandler({ query: 'kopi' });
    expect(result.content[0]!.text).toContain('kopi hitam');
  });

  it('returns no matching memories message for unrelated query', async () => {
    const recallHandler = getToolHandler('recall_memory');
    const result = await recallHandler({ query: 'nonexistent' });
    expect(result.content[0]!.text).toContain('No matching memories found');
  });

  it('filters by type_filter', async () => {
    const saveHandler = getToolHandler('save_memory');
    await saveHandler({
      memory_type: 'fact',
      data: { content: 'Loves coffee', category: 'food', importance: 'extended' },
    });
    await saveHandler({
      memory_type: 'preference',
      data: { category: 'drink', value: 'Coffee every morning', importance: 'extended' },
    });

    const recallHandler = getToolHandler('recall_memory');
    const result = await recallHandler({ query: 'coffee', type_filter: 'preference' });
    const text = result.content[0]!.text;
    expect(text).toContain('Coffee every morning');
    expect(text).not.toContain('Loves coffee');
  });
});

describe('list_memories tool', () => {
  it('returns all memories formatted with record IDs', async () => {
    const saveHandler = getToolHandler('save_memory');
    await saveHandler({
      memory_type: 'fact',
      data: { content: 'Allergic to peanuts', category: 'health', importance: 'fundamental' },
    });

    const listHandler = getToolHandler('list_memories');
    const result = await listHandler({});
    const text = result.content[0]!.text;
    expect(text).toContain('[ALL MEMORIES]');
    expect(text).toContain('Allergic to peanuts');
  });

  it('returns empty state when no memories exist', async () => {
    const listHandler = getToolHandler('list_memories');
    const result = await listHandler({});
    const text = result.content[0]!.text;
    expect(text).toContain('No memories stored yet');
  });
});

describe('forget_memory tool', () => {
  it('deletes a memory by record_id', async () => {
    const saveHandler = getToolHandler('save_memory');
    const saveResult = await saveHandler({
      memory_type: 'fact',
      data: { content: 'Temporary info', category: 'misc', importance: 'extended' },
    });
    const recordId = parseResult(saveResult).record_id as string;

    const forgetHandler = getToolHandler('forget_memory');
    const result = await forgetHandler({ record_id: recordId });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);

    // Verify it's gone
    const listHandler = getToolHandler('list_memories');
    const listResult = await listHandler({});
    expect(listResult.content[0]!.text).not.toContain('Temporary info');
  });
});

describe('recall_conversations tool', () => {
  it('returns matching conversations by topic keyword', async () => {
    await saveConversationSummary(PHONE, {
      summary: 'Discussed holiday plans to Japan',
      topics: ['holiday', 'japan', 'travel'],
      key_decisions: ['Book flights next week'],
    });

    const handler = getToolHandler('recall_conversations');
    const result = await handler({ query: 'japan' });
    const text = result.content[0]!.text;
    expect(text).toContain('holiday plans to Japan');
    expect(text).toContain('Topics:');
  });

  it('returns no-match message when nothing found', async () => {
    const handler = getToolHandler('recall_conversations');
    const result = await handler({ query: 'nonexistent' });
    expect(result.content[0]!.text).toContain('No past conversations found');
  });

  it('includes decisions in output when present', async () => {
    await saveConversationSummary(PHONE, {
      summary: 'Planning meeting',
      topics: ['planning'],
      key_decisions: ['Deadline is March 15'],
    });

    const handler = getToolHandler('recall_conversations');
    const result = await handler({ query: 'planning' });
    const text = result.content[0]!.text;
    expect(text).toContain('Decisions:');
    expect(text).toContain('Deadline is March 15');
  });
});

describe('query_relationships tool', () => {
  it('returns matching contacts by attribute', async () => {
    // First create a contact
    const saveHandler = getToolHandler('save_memory');
    await saveHandler({
      memory_type: 'contact',
      data: { name: 'Budi', relationship: 'colleague', notes: 'Java dev' },
    });

    const handler = getToolHandler('query_relationships');
    const result = await handler({
      query_type: 'mutual_connections',
    });
    const text = result.content[0]!.text;
    expect(text).toContain('Budi');
    expect(text).toContain('colleague');
  });

  it('returns no-match message when no contacts exist', async () => {
    const handler = getToolHandler('query_relationships');
    const result = await handler({
      query_type: 'mutual_connections',
    });
    expect(result.content[0]!.text).toContain('No matching results found');
  });

  it('finds related memories for a person', async () => {
    const saveHandler = getToolHandler('save_memory');
    await saveHandler({
      memory_type: 'contact',
      data: { name: 'Budi', relationship: 'colleague' },
    });
    await saveHandler({
      memory_type: 'fact',
      data: { content: 'Budi is a great engineer', category: 'people', importance: 'extended' },
    });

    const handler = getToolHandler('query_relationships');
    const result = await handler({
      query_type: 'related_memories',
      filters: { person_name: 'Budi' },
    });
    const text = result.content[0]!.text;
    expect(text).toContain('Budi');
    expect(text).toContain('great engineer');
  });
});
