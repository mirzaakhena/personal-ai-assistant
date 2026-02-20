import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Client, Message } from "whatsapp-web.js";
import { getSessionId, saveSessionId, deleteSessionId } from "../db/sessions.js";
import type { MessageContext } from "../tools/message.js";
import type { CronContext } from "../tools/cronjob.js";
import { createQueryOptions } from "../core/options.js";
import { buildUserPrompt } from "../utils/prompt.js";
import type { CronRegistry } from "../cron/registry.js";
import { log } from "../utils/logger.js";
import { updateStats, clearStats, getStats } from "../core/stats.js";
import { JID_SUFFIX_REGEX, CMD_NEW, CMD_STATUS, FALLBACK_MODEL, COST_USD_PRECISION } from "../core/constants.js";

export async function processMessage(client: Client, message: Message, registry: CronRegistry): Promise<void> {
  const chatId = message.from;
  const phoneNumber = chatId.replace(JID_SUFFIX_REGEX, '');
  const body = message.body.trim();

  log.chat(`${phoneNumber} → ${body}`);

  if (body === CMD_NEW) {
    deleteSessionId(phoneNumber);
    clearStats(phoneNumber);
    log.debug(`${phoneNumber} | /new — session cleared`);
    await client.sendMessage(chatId, '✅ New conversation session started. Previous context has been cleared.');
    return;
  }

  if (body === CMD_STATUS) {
    const sessionId = getSessionId(phoneNumber);
    const stats = getStats(phoneNumber);
    log.debug(`${phoneNumber} | /status`);

    let statusText: string;
    if (!sessionId) {
      statusText = '📊 *Session Status*\n\nNo active session.';
    } else {
      const model = stats?.model ?? FALLBACK_MODEL;
      const accCost = stats ? `$${stats.accumulated.costUsd.toFixed(COST_USD_PRECISION)}` : '-';
      const accIn   = stats ? stats.accumulated.inputTokens.toLocaleString() : '-';
      const accOut  = stats ? stats.accumulated.outputTokens.toLocaleString() : '-';
      const lastCost = stats ? `$${stats.lastQuery.costUsd.toFixed(COST_USD_PRECISION)}` : '-';
      const lastIn   = stats ? stats.lastQuery.inputTokens.toLocaleString() : '-';
      const lastOut  = stats ? stats.lastQuery.outputTokens.toLocaleString() : '-';

      statusText = [
        '📊 *Session Status*',
        '',
        `*Model:* ${model}`,
        `*Session ID:* ${sessionId}`,
        '',
        '*This session (accumulated):*',
        `Cost: ${accCost}`,
        `Tokens: ${accIn} in / ${accOut} out`,
        '',
        '*Last message:*',
        `Cost: ${lastCost}`,
        `Tokens: ${lastIn} in / ${lastOut} out`,
      ].join('\n');
    }

    await client.sendMessage(chatId, statusText);
    return;
  }

  let quotedBody: string | undefined;
  if (message.hasQuotedMsg) {
    const quoted = await message.getQuotedMessage();
    quotedBody = quoted.body;
  }

  const sessionId = getSessionId(phoneNumber);
  const ctx: MessageContext = { client, chatId };
  const cronCtx: CronContext = { registry, client, phoneNumber };
  const prompt = buildUserPrompt(body, quotedBody);
  const options = await createQueryOptions(sessionId, ctx, cronCtx);
  const responses = query({ prompt, options });

  let finalSessionId: string | undefined;
  let finalModel = FALLBACK_MODEL;
  for await (const msg of responses) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      finalModel = msg.model;
    }
    if (msg.type === 'result') {
      finalSessionId = msg.session_id;
      log.debug(`${phoneNumber} | $${msg.total_cost_usd.toFixed(COST_USD_PRECISION)} | session: ${msg.session_id}`);
      updateStats(phoneNumber, msg.session_id, finalModel, msg.total_cost_usd, msg.usage.input_tokens, msg.usage.output_tokens);
    }
  }

  if (finalSessionId) {
    saveSessionId(phoneNumber, finalSessionId);
  }
}
