import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MessageGateway, IncomingMessage } from "../gateway/types.js";
import { getSessionId, saveSessionId } from "../db/sessions.js";
import type { MessageContext } from "../tools/message.js";
import type { CronContext } from "../tools/cronjob.js";
import type { MemoryContext } from "../tools/memory.js";
import { createQueryOptions } from "../core/options.js";
import { buildUserPrompt } from "../utils/prompt.js";
import type { CronRegistry } from "../cron/registry.js";
import { log } from "../utils/logger.js";
import { updateStats } from "../core/stats.js";
import { incrementTurnCount, shouldInjectFlushReminder } from "../core/turns.js";
import { trackMessage, trackAssistantMessage } from "../memory/summarizer.js";
import { CMD_NEW, CMD_STATUS, CMD_RESTART, FALLBACK_MODEL, COST_USD_PRECISION } from "../core/constants.js";
import { handleNew, handleStatus, handleRestart } from "./commands.js";

export async function processMessage(gateway: MessageGateway, msg: IncomingMessage, registry: CronRegistry): Promise<void> {
  const { userId, body, quotedBody, mediaBlocks } = msg;

  log.chat(`${userId} → ${body}`);

  // --- Commands (early return) ---
  if (body === CMD_NEW) return handleNew(gateway, userId);
  if (body === CMD_STATUS) return handleStatus(gateway, userId);
  if (body === CMD_RESTART) return handleRestart(gateway, userId);

  // --- Query orchestration ---
  trackMessage(userId, 'user', body);

  const sessionId = getSessionId(userId);
  let messageSent = false;
  const ctx: MessageContext = {
    sendMessage: (content: string) => {
      messageSent = true;
      return gateway.sendMessage(userId, content);
    },
    onAssistantMessage: (content: string) => trackAssistantMessage(userId, content),
  };
  const cronCtx: CronContext = { registry, phoneNumber: userId, gateway };
  const memCtx: MemoryContext = { phoneNumber: userId };
  const contentBlocks = buildUserPrompt(body, quotedBody, mediaBlocks);

  incrementTurnCount(userId);
  const flushReminder = shouldInjectFlushReminder(userId);
  const options = await createQueryOptions(sessionId, ctx, cronCtx, memCtx, {
    injectFlushReminder: flushReminder,
    effort: 'high',
  });

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

  // Fallback: if Claude finished without calling send_message, notify user
  if (!messageSent) {
    log.error(`${userId} | send_message was never called — sending fallback`);
    await gateway.sendMessage(userId, '⚠️ Maaf, terjadi kesalahan. Coba kirim ulang pesanmu.');
  }

  if (finalSessionId) {
    saveSessionId(userId, finalSessionId);
  }
}
