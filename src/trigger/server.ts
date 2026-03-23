import http from 'http';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildCronjobPrompt } from '../utils/prompt.js';
import { createQueryOptions } from '../core/options.js';
import { enqueue } from '../utils/queue.js';
import { saveSessionId } from '../db/sessions.js';
import { log } from '../utils/logger.js';
import { TRIGGER_PORT, TRIGGER_HOST, COST_USD_PRECISION } from '../core/constants.js';
import type { MessageGateway } from '../gateway/types.js';
import type { CronRegistry } from '../cron/registry.js';
import type { MessageContext } from '../tools/message.js';
import type { CronContext } from '../tools/cronjob.js';
import type { MemoryContext } from '../tools/memory.js';

export function startTriggerServer(gateway: MessageGateway, registry: CronRegistry): void {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/trigger') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { message, phone_number } = JSON.parse(body) as { message: string; phone_number: string };

        if (!message || !phone_number) {
          res.writeHead(400);
          res.end('Missing message or phone_number');
          return;
        }

        // Respond immediately — don't block Claude Code
        res.writeHead(200);
        res.end('OK');

        // Process async via the existing queue (same pattern as cronjob executor)
        enqueue(phone_number, async () => {
          log.debug(`[TRIGGER] ${phone_number} — processing notification`);

          const ctx: MessageContext = {
            sendMessage: (content: string) => gateway.sendMessage(phone_number, content),
          };
          const cronCtx: CronContext = { registry, phoneNumber: phone_number, gateway };
          const memCtx: MemoryContext = { phoneNumber: phone_number };

          const prompt = buildCronjobPrompt(message);
          const options = await createQueryOptions(undefined, ctx, cronCtx, memCtx);

          const responses = query({ prompt, options });
          for await (const msg of responses) {
            if (msg.type === 'result') {
              saveSessionId(phone_number, msg.session_id);
              log.debug(`[TRIGGER] ${phone_number} done | $${msg.total_cost_usd.toFixed(COST_USD_PRECISION)}`);
            }
          }
        });
      } catch (err) {
        log.error('[TRIGGER] failed to process request', err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal error');
        }
      }
    });
  });

  server.listen(TRIGGER_PORT, TRIGGER_HOST, () => {
    log.debug(`[TRIGGER] listening on ${TRIGGER_HOST}:${TRIGGER_PORT}`);
  });
}
