// src-v4/utils/status-bar.test.ts

import { describe, it, expect } from 'vitest';
import {
  makeBar,
  pctColor,
  renderBarLine,
  contextPercentage,
} from './status-bar.js';

describe('makeBar', () => {
  it('renders 50% as half filled', () => {
    expect(makeBar(50, 10)).toBe('█████░░░░░');
  });

  it('renders 0% as all empty', () => {
    expect(makeBar(0, 10)).toBe('░░░░░░░░░░');
  });

  it('renders 100% as all filled', () => {
    expect(makeBar(100, 10)).toBe('██████████');
  });

  it('clamps values above 100', () => {
    expect(makeBar(150, 10)).toBe('██████████');
  });

  it('clamps negative values', () => {
    expect(makeBar(-5, 10)).toBe('░░░░░░░░░░');
  });

  it('respects custom width', () => {
    expect(makeBar(50, 4)).toBe('██░░');
  });
});

describe('pctColor', () => {
  it('green for <50', () => {
    expect(pctColor(10).open).toBe('\x1b[32m');
    expect(pctColor(49).open).toBe('\x1b[32m');
  });

  it('yellow for 50-74', () => {
    expect(pctColor(50).open).toBe('\x1b[33m');
    expect(pctColor(74).open).toBe('\x1b[33m');
  });

  it('red for >=75', () => {
    expect(pctColor(75).open).toBe('\x1b[31m');
    expect(pctColor(100).open).toBe('\x1b[31m');
  });
});

describe('renderBarLine', () => {
  it('plain mode shows bar and percent without ANSI', () => {
    const out = renderBarLine(30, { color: false });
    expect(out).toBe('███░░░░░░░ 30%');
    expect(out).not.toContain('\x1b');
  });

  it('color mode includes ANSI escapes', () => {
    const out = renderBarLine(30, { color: true });
    expect(out).toContain('\x1b[32m');
    expect(out).toContain('\x1b[0m');
  });

  it('rounds to integer', () => {
    expect(renderBarLine(29.7, { color: false })).toBe('███░░░░░░░ 30%');
  });

  it('handles NaN as 0', () => {
    expect(renderBarLine(Number.NaN, { color: false })).toBe('░░░░░░░░░░ 0%');
  });
});

describe('contextPercentage', () => {
  it('returns 0 for zero limit', () => {
    expect(contextPercentage(100, 0)).toBe(0);
  });

  it('computes proportion', () => {
    expect(contextPercentage(50_000, 200_000)).toBe(25);
  });
});
