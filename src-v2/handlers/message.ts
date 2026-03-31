import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MessageGateway, IncomingMessage } from "../gateway/types.js";
import { getSessionId, saveSessionId, deleteSessionId } from "../db/sessions.js";
import type { MessageContext } from "../tools/message.js";
import type { CronContext } from "../tools/cronjob.js";
import type { MemoryContext } from "../tools/memory.js";
import { createQueryOptions } from "../core/options.js";
import { buildUserPrompt } from "../utils/prompt.js";
import type { CronRegistry } from "../cron/registry.js";
import { log } from "../utils/logger.js";
import { updateStats, clearStats, getStats } from "../core/stats.js";
import { incrementTurnCount, clearTurnCount, shouldInjectFlushReminder } from "../core/turns.js";
import { trackMessage, clearTrackedMessages, summarizeAndSave } from "../memory/summarizer.js";
import { CMD_NEW, CMD_STATUS, CMD_RESTART, FALLBACK_MODEL, COST_USD_PRECISION } from "../core/constants.js";

export async function processMessage(gateway: MessageGateway, msg: IncomingMessage, registry: CronRegistry): Promise<void> {
  const { userId, body, quotedBody, mediaBlocks } = msg;

  log.chat(`${userId} → ${body}`);

  if (body === CMD_NEW) {
    // Generate conversation summary before clearing session
    try {
      await summarizeAndSave(userId);
    } catch (err) {
      log.error(`${userId} | /new — summary generation failed`, err);
    }
    clearTrackedMessages(userId);
    deleteSessionId(userId);
    clearStats(userId);
    clearTurnCount(userId);
    log.debug(`${userId} | /new — session cleared`);
    await gateway.sendMessage(userId, '✅ New conversation session started. Previous context has been cleared.');
    return;
  }

  if (body === CMD_STATUS) {
    const sessionId = getSessionId(userId);
    const stats = getStats(userId);
    log.debug(`${userId} | /status`);

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

    await gateway.sendMessage(userId, statusText);
    return;
  }

  if (body === CMD_RESTART) {
    await gateway.sendMessage(userId, '⚠️ /restart is only available via WhatsApp gateway.');
    return;
  }

  // Track user message for conversation summary generation
  trackMessage(userId, 'user', body);

  const sessionId = getSessionId(userId);
  const ctx: MessageContext = {
    sendMessage: (content: string) => gateway.sendMessage(userId, content),
  };
  const cronCtx: CronContext = { registry, phoneNumber: userId, gateway };
  const memCtx: MemoryContext = { phoneNumber: userId };
  const contentBlocks = buildUserPrompt(body, quotedBody, mediaBlocks);

  incrementTurnCount(userId);
  const flushReminder = shouldInjectFlushReminder(userId);
  const options = await createQueryOptions(sessionId, ctx, cronCtx, memCtx, flushReminder);

  // Build async iterable prompt with content blocks
  async function* buildPrompt(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: 'user' as const,
      message: { role: 'user' as const, content: contentBlocks },
      parent_tool_use_id: null,
      session_id: sessionId ?? '',
    };
  }

  const responses = query({ prompt: buildPrompt(), options });

  let finalSessionId: string | undefined;
  let finalModel = FALLBACK_MODEL;
  for await (const msg of responses) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      finalModel = msg.model;
    }
    if (msg.type === 'result') {
      finalSessionId = msg.session_id;
      log.debug(`${userId} | $${msg.total_cost_usd.toFixed(COST_USD_PRECISION)} | session: ${msg.session_id}`);
      updateStats(userId, msg.session_id, finalModel, msg.total_cost_usd, msg.usage.input_tokens, msg.usage.output_tokens);
    }
  }

  if (finalSessionId) {
    saveSessionId(userId, finalSessionId);
  }
}
