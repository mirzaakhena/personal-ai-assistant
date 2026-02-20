import { describe, expect, it } from 'vitest';
import { buildUserPrompt, buildCronjobPrompt } from '../../utils/prompt.js';

describe('buildUserPrompt', () => {
  it('contains [USER MESSAGE] header and the message text', () => {
    const result = buildUserPrompt('hello');
    expect(result).toContain('[USER MESSAGE]');
    expect(result).toContain('hello');
    expect(result).toContain('Timestamp:');
  });

  it('does not contain [CRONJOB MESSAGE]', () => {
    const result = buildUserPrompt('hello');
    expect(result).not.toContain('[CRONJOB MESSAGE]');
  });

  it('includes [REPLYING TO] block when quotedMessage is provided', () => {
    const result = buildUserPrompt('my reply', 'original message');
    expect(result).toContain('[REPLYING TO]');
    expect(result).toContain('original message');
    expect(result).toContain('[MESSAGE]');
    expect(result).toContain('my reply');
  });

  it('does not include [REPLYING TO] block when quotedMessage is undefined', () => {
    const result = buildUserPrompt('hello');
    expect(result).not.toContain('[REPLYING TO]');
  });
});

describe('buildCronjobPrompt', () => {
  it('contains [CRONJOB MESSAGE] header and the message text', () => {
    const result = buildCronjobPrompt('remind');
    expect(result).toContain('[CRONJOB MESSAGE]');
    expect(result).toContain('remind');
    expect(result).toContain('Timestamp:');
  });

  it('does not contain [USER MESSAGE]', () => {
    const result = buildCronjobPrompt('remind');
    expect(result).not.toContain('[USER MESSAGE]');
  });
});
