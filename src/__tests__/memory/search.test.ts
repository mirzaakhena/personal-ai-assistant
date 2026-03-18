import { describe, it, expect, vi, afterEach } from 'vitest';
import { scoredSearch, calculateRecencyScore } from '../../memory/search.js';

describe('scoredSearch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when items is empty', async () => {
    const results = await scoredSearch([], 'test', (item) => String(item.text));
    expect(results).toHaveLength(0);
  });

  it('returns empty array when query has no tokens', async () => {
    const items = [{ text: 'hello world' }];
    const results = await scoredSearch(items, '   ', (item) => String(item.text));
    expect(results).toHaveLength(0);
  });

  it('finds items by keyword match', async () => {
    const items = [
      { text: 'suka kopi hitam' },
      { text: 'suka teh hijau' },
    ];
    const results = await scoredSearch(items, 'kopi', (item) => String(item.text));
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('suka kopi hitam');
  });

  it('ranks items with more matched tokens higher', async () => {
    const items = [
      { text: 'makan nasi goreng' },
      { text: 'nasi goreng pedas dan enak' },
    ];
    const results = await scoredSearch(items, 'nasi goreng pedas', (item) => String(item.text));
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe('nasi goreng pedas dan enak');
  });

  it('excludes items with no keyword match when embeddings disabled', async () => {
    const items = [
      { text: 'tinggal di jakarta' },
      { text: 'hobi memancing' },
    ];
    const results = await scoredSearch(items, 'bandung', (item) => String(item.text));
    expect(results).toHaveLength(0);
  });

  it('respects the limit parameter', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ text: `item kopi ${i}` }));
    const results = await scoredSearch(items, 'kopi', (item) => String(item.text), { limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('uses recency score from getCreatedAt when provided', async () => {
    const now = Date.now();
    const items = [
      { text: 'kopi lama', created: new Date(now - 90 * 24 * 60 * 60 * 1000) },
      { text: 'kopi baru', created: new Date(now) },
    ];
    const results = await scoredSearch(
      items,
      'kopi',
      (item) => String(item.text),
      { getCreatedAt: (item) => item.created as Date },
    );
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe('kopi baru');
  });

  it('uses importance from getImportance when provided', async () => {
    const now = Date.now();
    const items = [
      { text: 'kopi extended', created: new Date(now - 90 * 24 * 60 * 60 * 1000), importance: 'extended' },
      { text: 'kopi fundamental', created: new Date(now - 90 * 24 * 60 * 60 * 1000), importance: 'fundamental' },
    ];
    const results = await scoredSearch(
      items,
      'kopi',
      (item) => String(item.text),
      {
        getCreatedAt: (item) => item.created as Date,
        getImportance: (item) => item.importance as string,
      },
    );
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe('kopi fundamental');
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

  it('returns 0.5 for missing created_at', () => {
    expect(calculateRecencyScore(undefined, 'extended')).toBe(0.5);
  });

  it('handles string dates', () => {
    const now = new Date().toISOString();
    const score = calculateRecencyScore(now, 'extended');
    expect(score).toBeCloseTo(1.0, 1);
  });
});
