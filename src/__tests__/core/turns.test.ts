import { beforeEach, describe, expect, it } from 'vitest';
import { incrementTurnCount, getTurnCount, clearTurnCount, shouldInjectFlushReminder } from '../../core/turns.js';

beforeEach(() => {
  clearTurnCount('628111');
  clearTurnCount('628222');
});

describe('getTurnCount', () => {
  it('returns 0 for unknown phone number', () => {
    expect(getTurnCount('628111')).toBe(0);
  });
});

describe('incrementTurnCount', () => {
  it('increments from 0 to 1 on first call', () => {
    const count = incrementTurnCount('628111');
    expect(count).toBe(1);
    expect(getTurnCount('628111')).toBe(1);
  });

  it('increments sequentially', () => {
    incrementTurnCount('628111');
    incrementTurnCount('628111');
    const count = incrementTurnCount('628111');
    expect(count).toBe(3);
  });

  it('isolates counts between phone numbers', () => {
    incrementTurnCount('628111');
    incrementTurnCount('628111');
    incrementTurnCount('628222');
    expect(getTurnCount('628111')).toBe(2);
    expect(getTurnCount('628222')).toBe(1);
  });
});

describe('clearTurnCount', () => {
  it('resets count to 0', () => {
    incrementTurnCount('628111');
    incrementTurnCount('628111');
    clearTurnCount('628111');
    expect(getTurnCount('628111')).toBe(0);
  });

  it('does not throw for unknown phone number', () => {
    expect(() => clearTurnCount('628999')).not.toThrow();
  });

  it('does not affect other phone numbers', () => {
    incrementTurnCount('628111');
    incrementTurnCount('628222');
    clearTurnCount('628111');
    expect(getTurnCount('628111')).toBe(0);
    expect(getTurnCount('628222')).toBe(1);
  });
});

describe('shouldInjectFlushReminder', () => {
  it('returns false when turn count is below threshold', () => {
    // MEMORY_FLUSH_TURN_THRESHOLD = 7
    for (let i = 0; i < 6; i++) incrementTurnCount('628111');
    expect(shouldInjectFlushReminder('628111')).toBe(false);
  });

  it('returns true when turn count reaches threshold', () => {
    for (let i = 0; i < 7; i++) incrementTurnCount('628111');
    expect(shouldInjectFlushReminder('628111')).toBe(true);
  });

  it('returns true when turn count exceeds threshold', () => {
    for (let i = 0; i < 10; i++) incrementTurnCount('628111');
    expect(shouldInjectFlushReminder('628111')).toBe(true);
  });

  it('returns false for new phone number', () => {
    expect(shouldInjectFlushReminder('628111')).toBe(false);
  });
});
