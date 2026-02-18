import 'dotenv/config';
import type { Message } from 'whatsapp-web.js';
import { createWhatsAppClient } from './whatsapp/client.js';
import { enqueue } from './whatsapp/queue.js';
import { processMessage } from './handlers/message.js';

const WHITELIST_NUMBERS = new Set(
  (process.env.WHITELIST_NUMBERS ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
);

if (WHITELIST_NUMBERS.size === 0) {
  console.warn('[WARN] WHITELIST_NUMBERS is empty — no messages will be processed');
}

const client = createWhatsAppClient();

client.on('message', (message: Message) => {
  // Skip group messages and status broadcast
  if (message.from.endsWith('@g.us') || message.from === 'status@broadcast') return;

  // Skip non-text messages
  if (!message.body) return;

  const phoneNumber = message.from.replace(/@.*$/, '');

  // Whitelist check
  if (!WHITELIST_NUMBERS.has(phoneNumber)) {
    console.log(`[SKIP] Not whitelisted: ${phoneNumber}`);
    return;
  }

  enqueue(phoneNumber, () => processMessage(client, message));
});

await client.initialize();
