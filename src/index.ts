import dotenv from 'dotenv';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { createWhatsAppGateway } from './gateway/whatsapp.js';
import { processMessage } from './handlers/message.js';
import { createCronRegistry } from './cron/registry.js';
import { reconcileOnStartup } from './cron/scheduler.js';
import { initMemoryDb, closeMemoryDb } from './db/memory.js';
import { log } from './utils/logger.js';
import { PROJECT_DIR, RESTART_FLAG_FILE } from './core/constants.js';
import type { MessageGateway } from './gateway/types.js';

dotenv.config({ path: join(PROJECT_DIR, '.env') });

const WHITELIST_NUMBERS = new Set(
  (process.env.WHITELIST_NUMBERS ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
);

if (WHITELIST_NUMBERS.size === 0) {
  log.error('[WARN] WHITELIST_NUMBERS is empty — no messages will be processed');
}

const registry = createCronRegistry();

// Gateway selection
const gatewayType = process.env.GATEWAY ?? 'whatsapp';
let gateway: MessageGateway;

if (gatewayType === 'whatsapp') {
  gateway = createWhatsAppGateway({ whitelistNumbers: WHITELIST_NUMBERS });
} else {
  throw new Error(`Unknown gateway: ${gatewayType} (webchat coming soon)`);
}

const shutdown = async (signal: string) => {
  log.debug(`[SHUTDOWN] received ${signal}, shutting down...`);
  await closeMemoryDb();
  await gateway.stop();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await initMemoryDb();

// Start gateway first — must be ready before sending any messages
await gateway.start((msg) => processMessage(gateway, msg, registry));

// Reconcile cronjobs (schedules cron timers that fire later via gateway.sendMessage)
reconcileOnStartup(registry, gateway);

// Handle restart flag (WhatsApp-specific but harmless for other gateways)
if (existsSync(RESTART_FLAG_FILE)) {
  try {
    const { chatId } = JSON.parse(readFileSync(RESTART_FLAG_FILE, 'utf-8'));
    rmSync(RESTART_FLAG_FILE);
    if (chatId) {
      const userId = chatId.replace(/@.*$/, '');
      await gateway.sendMessage(userId, '✅ Bot sudah aktif kembali.');
    }
  } catch (err) {
    log.error(`[RESTART] failed to process restart flag: ${err}`);
    rmSync(RESTART_FLAG_FILE, { force: true });
  }
}
