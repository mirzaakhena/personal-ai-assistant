import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from './use-debounced-value.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useDebouncedValue', () => {
  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 1000));
    expect(result.current).toBe('hello');
  });

  it('does not change value before delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 1000),
      { initialProps: { v: 'a' } },
    );
    rerender({ v: 'b' });
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBe('a');
  });

  it('updates value after delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 1000),
      { initialProps: { v: 'a' } },
    );
    rerender({ v: 'b' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe('b');
  });

  it('cancels pending update when value changes again', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 1000),
      { initialProps: { v: 'a' } },
    );
    rerender({ v: 'b' });
    act(() => { vi.advanceTimersByTime(500); });
    rerender({ v: 'c' });
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBe('a');
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBe('c');
  });
});
