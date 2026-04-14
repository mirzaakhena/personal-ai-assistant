// src-v3/utils/prompt.ts

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
 * Format a user message with timestamp and optional quoted context.
 * Used when a real user sends a message via gateway.
 */
export function buildUserPrompt(message: string, quoted?: QuotedInfo): string {
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

  return `[USER MESSAGE]

Timestamp: ${now.dateStr}, ${now.timeStr}
${quotedBlock}
[MESSAGE]
${message}`;
}

/**
 * Format a system-triggered message (cron, trigger) with timestamp.
 * Used for automated messages that appear as if from the system.
 */
export function buildSystemMessagePrompt(message: string): string {
  const { dateStr, timeStr } = formatDateTime(new Date());

  return `[SYSTEM MESSAGE]

Timestamp: ${dateStr}, ${timeStr}

[MESSAGE]
${message}`;
}
