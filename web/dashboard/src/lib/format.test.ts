import { describe, it, expect } from 'vitest';
import { truncate, truncateUuid, isUuid, fmtJson } from './format.js';

describe('format helpers', () => {
  it('truncate caps long strings with ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hell…');
    expect(truncate('hi', 5)).toBe('hi');
  });

  it('truncateUuid keeps first 8 chars', () => {
    expect(truncateUuid('123e4567-e89b-12d3-a456-426614174000')).toBe('123e4567');
    expect(truncateUuid('abc')).toBe('abc');
  });

  it('isUuid detects standard UUID format', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('fmtJson stringifies non-strings, returns strings as-is', () => {
    expect(fmtJson({ a: 1 })).toBe('{"a":1}');
    expect(fmtJson('plain')).toBe('plain');
    expect(fmtJson(null)).toBe('');
  });
});
