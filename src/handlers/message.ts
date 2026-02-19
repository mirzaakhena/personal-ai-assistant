import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Client, Message } from "whatsapp-web.js";
import { getSessionId, saveSessionId } from "../db/sessions.js";
import { type MessageContext, type CronContext } from "../tools/message.js";
import { createQueryOptions } from "../core/options.js";
import { buildUserPrompt } from "../utils/prompt.js";
import type { CronRegistry } from "../cron/registry.js";
import { log } from "../utils/logger.js";

export async function processMessage(client: Client, message: Message, registry: CronRegistry): Promise<void> {
  const chatId = message.from;
  const phoneNumber = chatId.replace(/@.*$/, '');

  log.chat(`${phoneNumber} → ${message.body}`);

  const sessionId = getSessionId(phoneNumber);
  const ctx: MessageContext = { client, chatId };
  const cronCtx: CronContext = { registry, client, phoneNumber };
  const prompt = buildUserPrompt(message.body);
  const options = await createQueryOptions(sessionId, ctx, cronCtx);
  const responses = query({ prompt, options });

  let finalSessionId: string | undefined;
  for await (const msg of responses) {
    if (msg.type === 'result') {
      finalSessionId = msg.session_id;
      log.debug(`${phoneNumber} | $${msg.total_cost_usd.toFixed(4)} | session: ${msg.session_id}`);
    }
  }

  if (finalSessionId) {
    saveSessionId(phoneNumber, finalSessionId);
  }
}
