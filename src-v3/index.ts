// src-v3/index.ts

import 'dotenv/config';
import { createConsoleGateway } from './gateway/console.js';
import { createTelegramGateway } from './gateway/telegram.js';
import { log } from './utils/logger.js';

// Uncomment ONE gateway:

// const gateway = createConsoleGateway();

const gateway = createTelegramGateway({
  token: process.env.TELEGRAM_BOT_TOKEN ?? '',
  whitelist: process.env.TELEGRAM_WHITELIST?.split(',').map(Number) ?? [],
});

// Graceful shutdown on SIGINT (Ctrl+C) and SIGTERM
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.debug(`received ${signal}, shutting down...`);
  try {
    await gateway.stop();
  } catch (err) {
    log.error('shutdown error', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await gateway.start();
