// src/utils/prompt.ts

import type { ContentBlock, MediaContentBlock } from './media.js';
import { TIMEZONE } from './model-config.js';

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

/** Format a Date as ISO 8601 with the local timezone offset derived from TIMEZONE. */
function toIsoLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const utcMs = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const localMs = new Date(date.toLocaleString('en-US', { timeZone: TIMEZONE })).getTime();
  const offsetMs = localMs - utcMs;
  const local = new Date(date.getTime() + offsetMs);
  const sign = offsetMs >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMs) / 60000;
  const offset = `${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`;
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${offset}`;
}

/** Escape XML-significant characters in element body / attribute values. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the <user_message> XML block.
 * Returns the structured XML text. Used for both string and ContentBlock[] return paths.
 */
function buildUserMessageText(
  message: string,
  quoted?: QuotedInfo,
  hasMedia?: boolean,
  messageId?: number
): string {
  const ts = toIsoLocal(new Date());
  const attrs = [`timestamp="${ts}"`];
  if (messageId !== undefined) attrs.push(`message_id="${messageId}"`);
  if (hasMedia) attrs.push(`has_media="true"`);

  const lines: string[] = [`<user_message ${attrs.join(' ')}>`];

  if (quoted) {
    const qAttrs = [`from="${quoted.sender}"`];
    if (quoted.at) qAttrs.push(`timestamp="${toIsoLocal(quoted.at)}"`);
    if (quoted.forwarded) qAttrs.push(`forwarded="true"`);
    lines.push(`  <replying_to ${qAttrs.join(' ')}>`);
    lines.push(`    <content>${escapeXml(quoted.content)}</content>`);
    lines.push(`  </replying_to>`);
  }

  const body = message.length > 0 ? message : (hasMedia ? '(no caption)' : '');
  lines.push(`  <body>${escapeXml(body)}</body>`);
  lines.push(`</user_message>`);
  return lines.join('\n');
}

/**
 * Format a user message with timestamp, optional quoted context, and optional media.
 * - No media → returns a plain string (backward compatible with console gateway etc.).
 * - With media → returns ContentBlock[] where media blocks come first, then a text block.
 */
export function buildUserPrompt(
  message: string,
  quoted?: QuotedInfo,
  mediaBlocks?: MediaContentBlock[],
  messageId?: number
): string | ContentBlock[] {
  if (!mediaBlocks || mediaBlocks.length === 0) {
    return buildUserMessageText(message, quoted, false, messageId);
  }

  const textBlock: ContentBlock = {
    type: 'text',
    text: buildUserMessageText(message, quoted, true, messageId),
  };
  return [...mediaBlocks, textBlock];
}

/**
 * Format a system-triggered message (cron, trigger) with timestamp.
 * System messages remain string-only.
 */
export function buildSystemMessagePrompt(message: string): string {
  const ts = toIsoLocal(new Date());
  return [
    `<system_message timestamp="${ts}">`,
    `  <body>${escapeXml(message)}</body>`,
    `</system_message>`,
  ].join('\n');
}

// re-export for backward compat (in case anything else imports TIMEZONE)
export { TIMEZONE };
