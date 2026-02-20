import 'dotenv/config';
import { execSync } from 'child_process';
import { rmSync, existsSync } from 'fs';
import type { Message } from 'whatsapp-web.js';
import { createWhatsAppClient } from './whatsapp/client.js';
import { enqueue } from './whatsapp/queue.js';
import { processMessage } from './handlers/message.js';
import { createCronRegistry } from './cron/registry.js';
import { reconcileOnStartup } from './cron/scheduler.js';
import { log } from './utils/logger.js';
import { WA_JID_GROUP, WA_STATUS_BROADCAST, JID_SUFFIX_REGEX, WA_CHROME_KILL_PATTERN, WA_LOCK_FILES } from './core/constants.js';

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
const client = createWhatsAppClient();

client.on('ready', () => {
  reconcileOnStartup(registry, client);
});

client.on('message', (message: Message) => {
  if (message.from.endsWith(WA_JID_GROUP) || message.from === WA_STATUS_BROADCAST) return;
  if (!message.body) return;

  const phoneNumber = message.from.replace(JID_SUFFIX_REGEX, '');

  if (!WHITELIST_NUMBERS.has(phoneNumber)) {
    log.debug(`[SKIP] ${phoneNumber}`);
    return;
  }

  enqueue(phoneNumber, () => processMessage(client, message, registry));
});

// Kill orphaned Chrome processes and remove stale lock files before init
try {
  execSync(`pkill -f "${WA_CHROME_KILL_PATTERN}" 2>/dev/null || true`, { stdio: 'ignore' });
} catch {}
for (const lockFile of WA_LOCK_FILES) {
  if (existsSync(lockFile)) {
    log.debug(`[STARTUP] removing stale lock file: ${lockFile}`);
    rmSync(lockFile);
  }
}

const shutdown = async (signal: string) => {
  log.debug(`[SHUTDOWN] received ${signal}, destroying client...`);
  await client.destroy();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await client.initialize();
