import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cosineSimilarity, generateEmbedding } from '../../memory/embeddings.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it('returns -1 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it('computes correct similarity for non-trivial vectors', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // Manual: dot = 4+10+18 = 32, |a| = sqrt(14), |b| = sqrt(77)
    // similarity = 32 / (sqrt(14) * sqrt(77)) = 32 / sqrt(1078) ≈ 0.9746
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.9746, 3);
  });

  it('returns 0 for zero vectors', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('handles single-dimension vectors', () => {
    expect(cosineSimilarity([5], [3])).toBeCloseTo(1.0);
    expect(cosineSimilarity([5], [-3])).toBeCloseTo(-1.0);
  });
});

describe('generateEmbedding', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns null when no provider is configured', async () => {
    delete process.env.MEMORY_EMBEDDING_PROVIDER;
    const result = await generateEmbedding('hello world');
    expect(result).toBeNull();
  });

  it('returns null when provider is empty string', async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = '';
    const result = await generateEmbedding('hello world');
    expect(result).toBeNull();
  });

  it('calls OpenAI API when provider is openai', async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-key';

    const mockEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: mockEmbedding }],
        }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await generateEmbedding('hello world');
    expect(result).toEqual(mockEmbedding);
    expect(mockFetch).toHaveBeenCalledOnce();

    // Verify correct API call
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(options.method).toBe('POST');
    expect(options.headers['Authorization']).toBe('Bearer test-key');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('text-embedding-3-small');
    expect(body.input).toBe('hello world');
  });

  it('returns null when OpenAI API returns error', async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-key';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await generateEmbedding('hello world');
    expect(result).toBeNull();
  });

  it('returns null when OPENAI_API_KEY is missing', async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'openai';
    delete process.env.OPENAI_API_KEY;

    const result = await generateEmbedding('hello world');
    expect(result).toBeNull();
  });

  it('returns null for unknown provider', async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'unknown-provider';
    const result = await generateEmbedding('hello world');
    expect(result).toBeNull();
  });
});
