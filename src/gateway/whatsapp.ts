import wwebjs from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { execSync } from 'child_process';
import { rmSync, existsSync } from 'fs';
import type { MessageGateway, IncomingMessage } from './types.js';
import { enqueue } from '../utils/queue.js';
import { downloadAndValidateMedia, buildMediaContentBlock } from '../utils/media.js';
import { log } from '../utils/logger.js';
import {
  WA_AUTH_PATH, WA_JID_GROUP, WA_STATUS_BROADCAST,
  JID_SUFFIX_REGEX, WA_CHROME_KILL_PATTERN, WA_LOCK_FILES,
  TYPING_MS_PER_CHAR,
  MIN_TYPING_DURATION_MS, MAX_TYPING_DURATION_MS,
  MIN_PAUSE_BEFORE_TYPING_MS,
} from '../core/constants.js';

const { Client, LocalAuth } = wwebjs;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calcTypingDuration(content: string): number {
  return Math.min(Math.max(content.length * TYPING_MS_PER_CHAR, MIN_TYPING_DURATION_MS), MAX_TYPING_DURATION_MS);
}

export interface WhatsAppGatewayOptions {
  whitelistNumbers: Set<string>;
}

export function createWhatsAppGateway(opts: WhatsAppGatewayOptions): MessageGateway {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: WA_AUTH_PATH }),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });

  return {
    type: 'whatsapp' as const,

    async sendMessage(userId: string, content: string) {
      const chatId = `${userId}@c.us`;
      const chat = await client.getChatById(chatId);

      const pause = MIN_PAUSE_BEFORE_TYPING_MS;
      await sleep(pause);
      await chat.sendStateTyping();
      await sleep(calcTypingDuration(content));
      await chat.clearState();

      await client.sendMessage(chatId, content);
      log.chat(`${userId} ← ${content}`);
    },

    async start(onMessage) {
      // Clean up orphaned Chrome processes and stale lock files
      try {
        execSync(`pkill -f "${WA_CHROME_KILL_PATTERN}" 2>/dev/null || true`, { stdio: 'ignore' });
      } catch {}
      for (const lockFile of WA_LOCK_FILES) {
        if (existsSync(lockFile)) {
          log.debug(`[STARTUP] removing stale lock file: ${lockFile}`);
          rmSync(lockFile);
        }
      }

      client.on('qr', (qr) => {
        log.debug('[WA] scan QR code:');
        qrcode.generate(qr, { small: true });
      });
      client.on('authenticated', () => log.debug('[WA] authenticated'));
      client.on('auth_failure', (msg) => log.error('[WA] auth failed', msg));
      client.on('disconnected', (reason) => log.error('[WA] disconnected', reason));

      client.on('message', (message) => {
        if (message.from.endsWith(WA_JID_GROUP) || message.from === WA_STATUS_BROADCAST) return;
        if (!message.body && !message.hasMedia) return;

        const phoneNumber = message.from.replace(JID_SUFFIX_REGEX, '');
        if (!opts.whitelistNumbers.has(phoneNumber)) {
          log.debug(`[SKIP] ${phoneNumber}`);
          return;
        }

        enqueue(phoneNumber, async () => {
          let quotedBody: string | undefined;
          if (message.hasQuotedMsg) {
            const quoted = await message.getQuotedMessage();
            quotedBody = quoted.body;
          }

          let mediaBlocks: IncomingMessage['mediaBlocks'];
          if (message.hasMedia) {
            const result = await downloadAndValidateMedia(message);
            if ('error' in result) {
              await client.sendMessage(message.from, `⚠️ ${result.error}`);
              return;
            }
            mediaBlocks = [buildMediaContentBlock(result)];
            log.debug(`${phoneNumber} | media: ${result.mimetype}${result.filename ? ` (${result.filename})` : ''}`);
          }

          const incoming: IncomingMessage = {
            userId: phoneNumber,
            body: message.body.trim(),
            mediaBlocks,
            quotedBody,
          };

          await onMessage(incoming);
        });
      });

      // Initialize and wait for ready before resolving start()
      const readyPromise = new Promise<void>((resolve) => {
        client.on('ready', () => {
          log.debug('[WA] ready');
          resolve();
        });
      });
      await client.initialize();
      await readyPromise;
    },

    async stop() {
      await client.destroy();
    },
  };
}
