// src-v3/utils/prompt.ts

const TIMEZONE = 'Asia/Jakarta';

function getFormattedDateTime(): { dateStr: string; timeStr: string } {
  const now = new Date();

  const dateStr = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(now);

  return { dateStr, timeStr };
}

/**
 * Format a user message with timestamp and optional quoted context.
 * Used when a real user sends a message via gateway.
 */
export function buildUserPrompt(message: string, quotedMessage?: string): string {
  const { dateStr, timeStr } = getFormattedDateTime();

  const quotedBlock = quotedMessage
    ? `\n[REPLYING TO]\n${quotedMessage}\n`
    : '';

  return `[USER MESSAGE]

Timestamp: ${dateStr}, ${timeStr}
${quotedBlock}
[MESSAGE]
${message}`;
}

/**
 * Format a system-triggered message (cron, trigger) with timestamp.
 * Used for automated messages that appear as if from the system.
 */
export function buildSystemMessagePrompt(message: string): string {
  const { dateStr, timeStr } = getFormattedDateTime();

  return `[SYSTEM MESSAGE]

Timestamp: ${dateStr}, ${timeStr}

[MESSAGE]
${message}`;
}
