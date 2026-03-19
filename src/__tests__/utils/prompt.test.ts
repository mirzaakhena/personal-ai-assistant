import { describe, expect, it } from 'vitest';
import { buildUserPrompt, buildCronjobPrompt } from '../../utils/prompt.js';
import type { MediaContentBlock } from '../../utils/media.js';

describe('buildUserPrompt', () => {
  it('returns content blocks array with text block', () => {
    const result = buildUserPrompt('hello');
    expect(result).toBeInstanceOf(Array);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ type: 'text' }));
  });

  it('contains [USER MESSAGE] header and the message text', () => {
    const result = buildUserPrompt('hello');
    const textBlock = result.find((b) => b.type === 'text')!;
    expect(textBlock.type).toBe('text');
    expect((textBlock as { type: 'text'; text: string }).text).toContain('[USER MESSAGE]');
    expect((textBlock as { type: 'text'; text: string }).text).toContain('hello');
    expect((textBlock as { type: 'text'; text: string }).text).toContain('Timestamp:');
  });

  it('does not contain [CRONJOB MESSAGE]', () => {
    const result = buildUserPrompt('hello');
    const textBlock = result.find((b) => b.type === 'text')! as { type: 'text'; text: string };
    expect(textBlock.text).not.toContain('[CRONJOB MESSAGE]');
  });

  it('includes [REPLYING TO] block when quotedMessage is provided', () => {
    const result = buildUserPrompt('my reply', 'original message');
    const textBlock = result.find((b) => b.type === 'text')! as { type: 'text'; text: string };
    expect(textBlock.text).toContain('[REPLYING TO]');
    expect(textBlock.text).toContain('original message');
    expect(textBlock.text).toContain('[MESSAGE]');
    expect(textBlock.text).toContain('my reply');
  });

  it('does not include [REPLYING TO] block when quotedMessage is undefined', () => {
    const result = buildUserPrompt('hello');
    const textBlock = result.find((b) => b.type === 'text')! as { type: 'text'; text: string };
    expect(textBlock.text).not.toContain('[REPLYING TO]');
  });

  it('includes media blocks before text block when provided', () => {
    const imageBlock: MediaContentBlock = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
    };
    const result = buildUserPrompt('check this', undefined, [imageBlock]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('image');
    expect(result[1].type).toBe('text');
  });

  it('uses "(no caption)" when message is empty with media', () => {
    const imageBlock: MediaContentBlock = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'abc' },
    };
    const result = buildUserPrompt('', undefined, [imageBlock]);
    const textBlock = result.find((b) => b.type === 'text')! as { type: 'text'; text: string };
    expect(textBlock.text).toContain('(no caption)');
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

  it('starts with [CRONJOB MESSAGE]', () => {
    const result = buildCronjobPrompt('remind');
    expect(result).toMatch(/^\[CRONJOB MESSAGE\]/);
  });
});
