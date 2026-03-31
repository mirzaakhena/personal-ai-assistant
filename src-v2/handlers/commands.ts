import type { MessageGateway } from "../gateway/types.js";
import { getSessionId, deleteSessionId } from "../db/sessions.js";
import { log } from "../utils/logger.js";
import { clearStats, getStats } from "../core/stats.js";
import { clearTurnCount } from "../core/turns.js";
import { clearTrackedMessages, summarizeAndSave } from "../memory/summarizer.js";
import { FALLBACK_MODEL, COST_USD_PRECISION } from "../core/constants.js";

/**
 * Handle /new — summarize, clear session, start fresh.
 */
export async function handleNew(gateway: MessageGateway, userId: string): Promise<void> {
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
}

/**
 * Handle /status — show session info, model, token costs.
 */
export async function handleStatus(gateway: MessageGateway, userId: string): Promise<void> {
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
}

/**
 * Handle /restart — WhatsApp-only command.
 */
export async function handleRestart(gateway: MessageGateway, userId: string): Promise<void> {
  await gateway.sendMessage(userId, '⚠️ /restart is only available via WhatsApp gateway.');
}
