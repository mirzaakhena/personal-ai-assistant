// src/utils/logger.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { log, getRecentLogs, _clearRingBufferForTests } from './logger.js';

describe('logger ring buffer', () => {
  beforeEach(() => {
    _clearRingBufferForTests();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('records debug, chat, and error lines into the ring buffer', () => {
    log.debug('first debug');
    log.chat('first chat');
    log.error('first error');

    const lines = getRecentLogs(10);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('first debug');
    expect(lines[1]).toContain('first chat');
    expect(lines[2]).toContain('first error');
  });

  it('strips ANSI color codes when storing', () => {
    log.debug('no color in buffer');
    log.error('definitely no red');

    const lines = getRecentLogs(10);
    for (const line of lines) {
      expect(line).not.toMatch(/\x1b\[/);
    }
  });

  it('appends an error detail when an Error is passed', () => {
    log.error('something broke', new Error('disk full'));
    const lines = getRecentLogs(1);
    expect(lines[0]).toContain('something broke');
    expect(lines[0]).toContain('disk full');
  });

  it('caps the buffer at 500 entries (oldest evicted)', () => {
    for (let i = 0; i < 600; i++) log.debug(`msg-${i}`);
    const all = getRecentLogs(1000);
    expect(all).toHaveLength(500);
    expect(all[0]).toContain('msg-100');
    expect(all[all.length - 1]).toContain('msg-599');
  });

  it('getRecentLogs(n) returns the last n lines, oldest first', () => {
    for (let i = 0; i < 30; i++) log.debug(`line-${i}`);
    const last5 = getRecentLogs(5);
    expect(last5).toHaveLength(5);
    expect(last5[0]).toContain('line-25');
    expect(last5[4]).toContain('line-29');
  });

  it('getRecentLogs(n) returns all when n >= buffer size', () => {
    log.debug('only one');
    expect(getRecentLogs(20)).toHaveLength(1);
  });

  it('getRecentLogs(0) returns empty array', () => {
    log.debug('whatever');
    expect(getRecentLogs(0)).toEqual([]);
  });
});
