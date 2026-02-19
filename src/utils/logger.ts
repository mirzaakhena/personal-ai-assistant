const GRAY  = '\x1b[90m';
const RED   = '\x1b[31m';
const RESET = '\x1b[0m';

function ts(): string {
  return new Date().toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const log = {
  /** System / operational info — dark gray */
  debug: (msg: string) => console.log(`${GRAY}[${ts()}] ${msg}${RESET}`),

  /** Conversation (user ↔ assistant) — default white */
  chat: (msg: string) => console.log(`[${ts()}] ${msg}`),

  /** Errors — red */
  error: (msg: string, err?: unknown) => {
    const detail = err instanceof Error ? err.message : err ? String(err) : '';
    console.error(`${RED}[${ts()}] ${msg}${detail ? ' — ' + detail : ''}${RESET}`);
  },
};
