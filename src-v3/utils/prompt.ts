// src-v3/utils/prompt.ts

import type { ContentBlock, MediaContentBlock } from './media.js';

const TIMEZONE = 'Asia/Jakarta';

export type QuotedSender = 'user' | 'assistant';

export interface QuotedInfo {
  /** The text of the quoted message */
  content: string;
  /** Who sent the quoted message */
  sender: QuotedSender;
  /** When the quoted message was originally sent (optional) */
  at?: Date;
  /** True if the quoted message was originally forwarded from elsewhere */
  forwarded?: boolean;
}

function formatDateTime(date: Date): { dateStr: string; timeStr: string } {
  const dateStr = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);

  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);

  return { dateStr, timeStr };
}

/**
 * Build the [USER MESSAGE] text block content (the structured text part).
 * Used internally whether we return a plain string or a ContentBlock[] with text as last block.
 */
function buildUserMessageText(message: string, quoted?: QuotedInfo, hasMedia?: boolean): string {
  const now = formatDateTime(new Date());

  let quotedBlock = '';
  if (quoted) {
    const senderLine = `From: ${quoted.sender}${quoted.forwarded ? ' (forwarded)' : ''}`;
    const lines = ['', '[REPLYING TO]', senderLine];
    if (quoted.at) {
      const q = formatDateTime(quoted.at);
      lines.push(`Timestamp: ${q.dateStr}, ${q.timeStr}`);
    }
    lines.push(quoted.content, '');
    quotedBlock = lines.join('\n');
  }

  const messageText = message.length > 0 ? message : (hasMedia ? '(no caption)' : '');

  return `[USER MESSAGE]

Timestamp: ${now.dateStr}, ${now.timeStr}
${quotedBlock}
[MESSAGE]
${messageText}`;
}

/**
 * Format a user message with timestamp, optional quoted context, and optional media.
 * - No media → returns a plain string (backward compatible with console gateway etc.).
 * - With media → returns ContentBlock[] where media blocks come first, then a text block.
 */
export function buildUserPrompt(
  message: string,
  quoted?: QuotedInfo,
  mediaBlocks?: MediaContentBlock[]
): string | ContentBlock[] {
  if (!mediaBlocks || mediaBlocks.length === 0) {
    return buildUserMessageText(message, quoted, false);
  }

  const textBlock: ContentBlock = {
    type: 'text',
    text: buildUserMessageText(message, quoted, true),
  };
  return [...mediaBlocks, textBlock];
}

/**
 * Format a system-triggered message (cron, trigger) with timestamp.
 * System messages remain string-only.
 */
export function buildSystemMessagePrompt(message: string): string {
  const { dateStr, timeStr } = formatDateTime(new Date());

  return `[SYSTEM MESSAGE]

Timestamp: ${dateStr}, ${timeStr}

[MESSAGE]
${message}`;
}
