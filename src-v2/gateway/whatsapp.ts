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

// --- Dedup: outgoing messages ---
// Prevents double-send when Puppeteer promise errors cause SDK retry.
const SEND_DEDUP_WINDOW_MS = 3000;
const recentSentMessages = new Map<string, number>(); // key: "userId:hash" → timestamp

function outgoingDedup(userId: string, content: string): boolean {
  const key = `${userId}:${simpleHash(content)}`;
  const now = Date.now();
  const lastSent = recentSentMessages.get(key);
  if (lastSent && now - lastSent < SEND_DEDUP_WINDOW_MS) {
    log.debug(`[WA] dedup: skipping duplicate send to ${userId}`);
    return true; // duplicate
  }
  recentSentMessages.set(key, now);
  // Cleanup old entries
  for (const [k, ts] of recentSentMessages) {
    if (now - ts > SEND_DEDUP_WINDOW_MS * 2) recentSentMessages.delete(k);
  }
  return false;
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// --- Dedup: incoming messages ---
// Prevents processing the same WhatsApp message event fired multiple times.
const processedMessageIds = new Set<string>();

export interface WhatsAppGatewayOptions {
  whitelistNumbers: Set<string>;
}

export function createWhatsAppGateway(opts: WhatsAppGatewayOptions): MessageGateway {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: WA_AUTH_PATH }),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });

  return {
    async sendMessage(userId: string, content: string) {
      // Dedup: skip if identical message sent within window
      if (outgoingDedup(userId, content)) return;

      const chatId = `${userId}@c.us`;
      try {
        const chat = await client.getChatById(chatId);
        const pause = MIN_PAUSE_BEFORE_TYPING_MS;
        await sleep(pause);
        await chat.sendStateTyping();
        await sleep(calcTypingDuration(content));
        await chat.clearState();
      } catch {
        // Typing simulation is best-effort — don't fail the send
      }

      try {
        await client.sendMessage(chatId, content);
        log.chat(`${userId} ← ${content}`);
      } catch (err) {
        // "Promise was collected" = Puppeteer lost track but message was likely sent.
        // Log but don't re-throw — prevents SDK from retrying and causing double send.
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('Promise was collected') || errMsg.includes('Protocol error')) {
          log.debug(`[WA] send likely succeeded despite Puppeteer error: ${errMsg}`);
        } else {
          throw err; // Re-throw genuine errors
        }
      }
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

        // Dedup: skip if this message ID was already processed
        const msgId = message.id._serialized;
        if (processedMessageIds.has(msgId)) {
          log.debug(`[WA] dedup: skipping duplicate incoming ${msgId}`);
          return;
        }
        processedMessageIds.add(msgId);
        // Cleanup old IDs (keep last 1000)
        if (processedMessageIds.size > 1000) {
          const iter = processedMessageIds.values();
          for (let i = 0; i < 500; i++) iter.next();
          // Clear cannot selectively remove, so rebuild
          const keep = [...processedMessageIds].slice(-500);
          processedMessageIds.clear();
          for (const id of keep) processedMessageIds.add(id);
        }

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
