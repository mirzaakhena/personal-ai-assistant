import { TIMEZONE } from '../core/constants.js';

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

export function buildCronjobPrompt(message: string): string {
  const { dateStr, timeStr } = getFormattedDateTime();

  return `[CRONJOB MESSAGE]

Timestamp: ${dateStr}, ${timeStr}

[MESSAGE]
${message}`;
}
