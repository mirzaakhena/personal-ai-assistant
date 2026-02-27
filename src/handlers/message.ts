import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Client, Message } from "whatsapp-web.js";
import { getSessionId, saveSessionId, deleteSessionId } from "../db/sessions.js";
import type { MessageContext } from "../tools/message.js";
import type { CronContext } from "../tools/cronjob.js";
import type { MemoryContext } from "../tools/memory.js";
import { createQueryOptions } from "../core/options.js";
import { buildUserPrompt } from "../utils/prompt.js";
import { downloadAndValidateMedia, buildMediaContentBlock } from "../utils/media.js";
import type { MediaContentBlock } from "../utils/media.js";
import type { CronRegistry } from "../cron/registry.js";
import { execSync, exec } from "child_process";
import { writeFileSync } from "fs";
import { log } from "../utils/logger.js";
import { updateStats, clearStats, getStats } from "../core/stats.js";
import { incrementTurnCount, clearTurnCount, shouldInjectFlushReminder } from "../core/turns.js";
import { trackMessage, clearTrackedMessages, summarizeAndSave } from "../memory/summarizer.js";
import { PROJECT_DIR, JID_SUFFIX_REGEX, CMD_NEW, CMD_STATUS, CMD_RESTART, RESTART_FLAG_FILE, FALLBACK_MODEL, COST_USD_PRECISION } from "../core/constants.js";

export async function processMessage(client: Client, message: Message, registry: CronRegistry): Promise<void> {
  const chatId = message.from;
  const phoneNumber = chatId.replace(JID_SUFFIX_REGEX, '');
  const body = message.body.trim();

  log.chat(`${phoneNumber} → ${body}`);

  if (body === CMD_NEW) {
    // Generate conversation summary before clearing session
    try {
      await summarizeAndSave(phoneNumber);
    } catch (err) {
      log.error(`${phoneNumber} | /new — summary generation failed`, err);
    }
    clearTrackedMessages(phoneNumber);
    deleteSessionId(phoneNumber);
    clearStats(phoneNumber);
    clearTurnCount(phoneNumber);
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

  if (body === CMD_RESTART) {
    log.debug(`${phoneNumber} | /restart`);
    await client.sendMessage(chatId, '🔄 Restarting... pulling latest code and restarting bot.');

    try {
      const gitOutput = execSync('git pull', { encoding: 'utf-8', timeout: 30_000, cwd: PROJECT_DIR });
      log.debug(`[RESTART] git pull: ${gitOutput.trim()}`);
    } catch (err) {
      log.error(`[RESTART] git pull failed: ${err}`);
      await client.sendMessage(chatId, '⚠️ git pull failed. Restart aborted.');
      return;
    }

    writeFileSync(RESTART_FLAG_FILE, JSON.stringify({ chatId }));
    exec('pm2 restart wa-bot');
    return;
  }

  let quotedBody: string | undefined;
  if (message.hasQuotedMsg) {
    const quoted = await message.getQuotedMessage();
    quotedBody = quoted.body;
  }

  // Download and validate media if present
  let mediaBlocks: MediaContentBlock[] | undefined;
  if (message.hasMedia) {
    const result = await downloadAndValidateMedia(message);
    if ('error' in result) {
      await client.sendMessage(chatId, `⚠️ ${result.error}`);
      return;
    }
    mediaBlocks = [buildMediaContentBlock(result)];
    log.debug(`${phoneNumber} | media: ${result.mimetype}${result.filename ? ` (${result.filename})` : ''}`);
  }

  // Track user message for conversation summary generation
  trackMessage(phoneNumber, 'user', body);

  const sessionId = getSessionId(phoneNumber);
  const ctx: MessageContext = { client, chatId };
  const cronCtx: CronContext = { registry, client, phoneNumber };
  const memCtx: MemoryContext = { phoneNumber };
  const contentBlocks = buildUserPrompt(body, quotedBody, mediaBlocks);

  incrementTurnCount(phoneNumber);
  const flushReminder = shouldInjectFlushReminder(phoneNumber);
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
      log.debug(`${phoneNumber} | $${msg.total_cost_usd.toFixed(COST_USD_PRECISION)} | session: ${msg.session_id}`);
      updateStats(phoneNumber, msg.session_id, finalModel, msg.total_cost_usd, msg.usage.input_tokens, msg.usage.output_tokens);
    }
  }

  if (finalSessionId) {
    saveSessionId(phoneNumber, finalSessionId);
  }
}
