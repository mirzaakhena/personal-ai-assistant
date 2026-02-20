import { beforeEach, describe, expect, it } from 'vitest';
import { updateStats, clearStats, getStats } from '../../core/stats.js';

beforeEach(() => {
  clearStats('628111');
  clearStats('628222');
});

describe('getStats', () => {
  it('returns undefined for an unknown phone number', () => {
    expect(getStats('628111')).toBeUndefined();
  });
});

describe('updateStats', () => {
  it('creates new stats on first call', () => {
    updateStats('628111', 'sess-1', 'sonnet', 0.0012, 100, 50);
    const stats = getStats('628111');
    expect(stats).toBeDefined();
    expect(stats!.model).toBe('sonnet');
    expect(stats!.sessionId).toBe('sess-1');
    expect(stats!.accumulated).toEqual({ costUsd: 0.0012, inputTokens: 100, outputTokens: 50 });
    expect(stats!.lastQuery).toEqual({ costUsd: 0.0012, inputTokens: 100, outputTokens: 50 });
  });

  it('accumulates stats within the same session', () => {
    updateStats('628111', 'sess-1', 'sonnet', 0.001, 100, 50);
    updateStats('628111', 'sess-1', 'sonnet', 0.002, 200, 80);
    const stats = getStats('628111')!;
    expect(stats.accumulated.costUsd).toBeCloseTo(0.003);
    expect(stats.accumulated.inputTokens).toBe(300);
    expect(stats.accumulated.outputTokens).toBe(130);
    expect(stats.lastQuery).toEqual({ costUsd: 0.002, inputTokens: 200, outputTokens: 80 });
  });

  it('resets accumulated stats when session changes', () => {
    updateStats('628111', 'sess-1', 'sonnet', 0.005, 500, 200);
    updateStats('628111', 'sess-2', 'haiku', 0.001, 100, 40);
    const stats = getStats('628111')!;
    expect(stats.sessionId).toBe('sess-2');
    expect(stats.model).toBe('haiku');
    expect(stats.accumulated).toEqual({ costUsd: 0.001, inputTokens: 100, outputTokens: 40 });
    expect(stats.lastQuery).toEqual({ costUsd: 0.001, inputTokens: 100, outputTokens: 40 });
  });

  it('isolates stats between different phone numbers', () => {
    updateStats('628111', 'sess-a', 'sonnet', 0.01, 1000, 500);
    updateStats('628222', 'sess-b', 'haiku', 0.002, 200, 100);
    expect(getStats('628111')!.sessionId).toBe('sess-a');
    expect(getStats('628222')!.sessionId).toBe('sess-b');
    expect(getStats('628111')!.accumulated.costUsd).toBeCloseTo(0.01);
    expect(getStats('628222')!.accumulated.costUsd).toBeCloseTo(0.002);
  });

  it('updates model on each call', () => {
    updateStats('628111', 'sess-1', 'haiku', 0.001, 100, 50);
    updateStats('628111', 'sess-1', 'sonnet', 0.002, 200, 80);
    expect(getStats('628111')!.model).toBe('sonnet');
  });
});

describe('clearStats', () => {
  it('removes stats for a phone number', () => {
    updateStats('628111', 'sess-1', 'sonnet', 0.001, 100, 50);
    clearStats('628111');
    expect(getStats('628111')).toBeUndefined();
  });

  it('does not throw when clearing non-existent phone number', () => {
    expect(() => clearStats('628999')).not.toThrow();
  });

  it('does not affect other phone numbers', () => {
    updateStats('628111', 'sess-1', 'sonnet', 0.001, 100, 50);
    updateStats('628222', 'sess-2', 'sonnet', 0.002, 200, 80);
    clearStats('628111');
    expect(getStats('628111')).toBeUndefined();
    expect(getStats('628222')).toBeDefined();
  });
});
