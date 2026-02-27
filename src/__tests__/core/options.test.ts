import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildSystemPrompt, MEMORY_FLUSH_REMINDER } from '../../core/options.js';

// Mock memory operations and formatter
vi.mock('../../memory/operations.js', () => ({
  getFundamentalMemories: vi.fn(),
}));

vi.mock('../../memory/formatter.js', () => ({
  formatFundamentalMemory: vi.fn(),
}));

import { getFundamentalMemories } from '../../memory/operations.js';
import { formatFundamentalMemory } from '../../memory/formatter.js';

const mockGetFundamental = vi.mocked(getFundamentalMemories);
const mockFormat = vi.mocked(formatFundamentalMemory);

describe('buildSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes base system prompt content', async () => {
    mockGetFundamental.mockResolvedValue({
      profile: null,
      persona: null,
      preferences: [],
      facts: [],
      routines: [],
    });
    mockFormat.mockReturnValue('[MEMORY CONTEXT]\n\nNo memories stored yet. This appears to be a new user — consider introducing yourself.');

    const result = await buildSystemPrompt('+628123');

    expect(result).toContain('You are a personal AI assistant.');
    expect(result).toContain('RESPONSE RULE:');
    expect(result).toContain('CRONJOB MANAGEMENT:');
  });

  it('includes MEMORY SYSTEM instructions', async () => {
    mockGetFundamental.mockResolvedValue({
      profile: null,
      persona: null,
      preferences: [],
      facts: [],
      routines: [],
    });
    mockFormat.mockReturnValue('[MEMORY CONTEXT]\n\nNo memories stored yet.');

    const result = await buildSystemPrompt('+628123');

    expect(result).toContain('MEMORY SYSTEM:');
    expect(result).toContain('MEMORY LOADING:');
    expect(result).toContain('WHEN TO SAVE MEMORIES:');
    expect(result).toContain('IMPORTANCE CLASSIFICATION:');
    expect(result).toContain('WHEN TO UPDATE MEMORIES:');
    expect(result).toContain('WHEN TO RECALL MEMORIES:');
    expect(result).toContain('TRANSPARENCY:');
    expect(result).toContain('NEW USER ONBOARDING:');
    expect(result).toContain('CONTEXT PRESERVATION:');
    expect(result).toContain('CONVERSATION HISTORY:');
    expect(result).toContain('recall_conversations');
  });

  it('appends formatted memory block at the end', async () => {
    const memoryBlock = '[MEMORY CONTEXT]\n\nAbout the user:\n- Name: Mirza\n- Location: Jakarta';
    mockGetFundamental.mockResolvedValue({
      profile: { id: 'person:abc', name: 'Mirza', phone: '+628123', location: 'Jakarta' },
      persona: null,
      preferences: [],
      facts: [],
      routines: [],
    });
    mockFormat.mockReturnValue(memoryBlock);

    const result = await buildSystemPrompt('+628123');

    // Memory block should be at the end of the prompt
    expect(result).toContain(memoryBlock);
    expect(result.indexOf(memoryBlock)).toBe(result.length - memoryBlock.length);
  });

  it('calls getFundamentalMemories with the correct phone number', async () => {
    mockGetFundamental.mockResolvedValue({
      profile: null,
      persona: null,
      preferences: [],
      facts: [],
      routines: [],
    });
    mockFormat.mockReturnValue('[MEMORY CONTEXT]\n\nNo memories.');

    await buildSystemPrompt('+628999');

    expect(mockGetFundamental).toHaveBeenCalledWith('+628999');
  });

  it('returns base prompt without memory block on error', async () => {
    mockGetFundamental.mockRejectedValue(new Error('DB connection failed'));

    const result = await buildSystemPrompt('+628123');

    expect(result).toContain('You are a personal AI assistant.');
    expect(result).toContain('MEMORY SYSTEM:');
    expect(result).not.toContain('[MEMORY CONTEXT]');
  });

  it('includes new user memory context for unknown phone numbers', async () => {
    const newUserBlock = '[MEMORY CONTEXT]\n\nNo memories stored yet. This appears to be a new user — consider introducing yourself.';
    mockGetFundamental.mockResolvedValue({
      profile: null,
      persona: null,
      preferences: [],
      facts: [],
      routines: [],
    });
    mockFormat.mockReturnValue(newUserBlock);

    const result = await buildSystemPrompt('+620000');

    expect(result).toContain('No memories stored yet');
    expect(result).toContain('new user');
  });
});

describe('MEMORY_FLUSH_REMINDER', () => {
  it('contains the flush reminder text', () => {
    expect(MEMORY_FLUSH_REMINDER).toContain('[MEMORY FLUSH REMINDER]');
    expect(MEMORY_FLUSH_REMINDER).toContain('save_memory');
    expect(MEMORY_FLUSH_REMINDER).toContain('session turn limit');
  });
});
