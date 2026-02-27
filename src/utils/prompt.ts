import { TIMEZONE } from '../core/constants.js';
import type { MediaContentBlock } from './media.js';

export type TextBlock = { type: 'text'; text: string };
export type ContentBlock = TextBlock | MediaContentBlock;

function getFormattedDateTime(): { dateStr: string; timeStr: string } {
  const now = new Date();

  const dateStr = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  const timeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(now);

  return { dateStr, timeStr };
}

export function buildUserPrompt(
  message: string,
  quotedMessage?: string,
  mediaBlocks?: MediaContentBlock[]
): ContentBlock[] {
  const { dateStr, timeStr } = getFormattedDateTime();

  const quotedBlock = quotedMessage
    ? `\n[REPLYING TO]\n${quotedMessage}\n`
    : '';

  const textContent = `[USER MESSAGE]

Timestamp: ${dateStr}, ${timeStr}
${quotedBlock}
[MESSAGE]
${message || '(no caption)'}`;

  const blocks: ContentBlock[] = [];

  if (mediaBlocks && mediaBlocks.length > 0) {
    blocks.push(...mediaBlocks);
  }

  blocks.push({ type: 'text', text: textContent });

  return blocks;
}

export function buildCronjobPrompt(message: string, memoryContext?: string): string {
  const { dateStr, timeStr } = getFormattedDateTime();

  const memoryBlock = memoryContext ? `${memoryContext}\n\n` : '';

  return `${memoryBlock}[CRONJOB MESSAGE]

Timestamp: ${dateStr}, ${timeStr}

[MESSAGE]
${message}`;
}
