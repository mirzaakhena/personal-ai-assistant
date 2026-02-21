import dotenv from 'dotenv';
import { execSync } from 'child_process';
import { readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import type { Message } from 'whatsapp-web.js';
import { createWhatsAppClient } from './whatsapp/client.js';
import { enqueue } from './whatsapp/queue.js';
import { processMessage } from './handlers/message.js';
import { createCronRegistry } from './cron/registry.js';
import { reconcileOnStartup } from './cron/scheduler.js';
import { log } from './utils/logger.js';
import { PROJECT_DIR, WA_JID_GROUP, WA_STATUS_BROADCAST, JID_SUFFIX_REGEX, WA_CHROME_KILL_PATTERN, WA_LOCK_FILES, RESTART_FLAG_FILE } from './core/constants.js';

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
const client = createWhatsAppClient();

client.on('ready', () => {
  reconcileOnStartup(registry, client);

  if (existsSync(RESTART_FLAG_FILE)) {
    try {
      const { chatId } = JSON.parse(readFileSync(RESTART_FLAG_FILE, 'utf-8'));
      rmSync(RESTART_FLAG_FILE);
      if (chatId) {
        client.sendMessage(chatId, '✅ Bot sudah aktif kembali.');
      }
    } catch (err) {
      log.error(`[RESTART] failed to process restart flag: ${err}`);
      rmSync(RESTART_FLAG_FILE, { force: true });
    }
  }
});

client.on('message', (message: Message) => {
  if (message.from.endsWith(WA_JID_GROUP) || message.from === WA_STATUS_BROADCAST) return;
  if (!message.body && !message.hasMedia) return;

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
