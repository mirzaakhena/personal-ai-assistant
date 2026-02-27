import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Client } from 'whatsapp-web.js';
import { getCronjobById, updateCronjobStatus, updateExecutionStatus } from '../db/cronjobs.js';
import { unregisterCronTask, type CronRegistry } from './registry.js';
import { saveSessionId } from '../db/sessions.js';
import { createQueryOptions } from '../core/options.js';
import { buildCronjobPrompt } from '../utils/prompt.js';
import type { MessageContext } from '../tools/message.js';
import type { CronContext } from '../tools/cronjob.js';
import type { MemoryContext } from '../tools/memory.js';
import { getFundamentalMemories } from '../memory/operations.js';
import { formatFundamentalMemory } from '../memory/formatter.js';
import { log } from '../utils/logger.js';
import { WA_JID_PERSONAL, CronjobStatuses, COST_USD_PRECISION } from '../core/constants.js';

export async function processCronjob(
  client: Client,
  registry: CronRegistry,
  jobId: string,
  executionId: string
): Promise<void> {
  const job = getCronjobById(jobId);
  if (!job || job.status === CronjobStatuses.CANCELLED) {
    log.debug(`[CRON] skipping ${jobId} — not found or cancelled`);
    return;
  }

  const chatId = `${job.phone_number}${WA_JID_PERSONAL}`;
  const phoneNumber = job.phone_number;

  log.debug(`[CRON] ${phoneNumber} firing: ${job.schedule_human}`);

  updateExecutionStatus(executionId, CronjobStatuses.EXECUTING);
  if (job.type === 'once') {
    updateCronjobStatus(jobId, CronjobStatuses.EXECUTING);
  }

  const sessionId = undefined; // always start a fresh session to avoid replaying prior tool calls
  const ctx: MessageContext = { client, chatId };
  const cronCtx: CronContext = { registry, client, phoneNumber };
  const memCtx: MemoryContext = { phoneNumber };

  let memoryContext: string | undefined;
  try {
    const memories = await getFundamentalMemories(phoneNumber);
    memoryContext = formatFundamentalMemory(memories);
  } catch (err) {
    log.error(`[CRON] Failed to load memory for ${phoneNumber}`, err);
  }

  const prompt = buildCronjobPrompt(job.message, memoryContext);

  try {
    const options = await createQueryOptions(sessionId, ctx, cronCtx, memCtx);
    const responses = query({ prompt, options });
    let finalSessionId: string | undefined;
    for await (const msg of responses) {
      if (msg.type === 'result') {
        finalSessionId = msg.session_id;
        log.debug(`[CRON] ${phoneNumber} | $${msg.total_cost_usd.toFixed(COST_USD_PRECISION)} | session: ${msg.session_id}`);
      }
    }

    if (finalSessionId) {
      saveSessionId(phoneNumber, finalSessionId);
    }

    updateExecutionStatus(executionId, CronjobStatuses.EXECUTED, Date.now());

    if (job.type === 'once') {
      updateCronjobStatus(jobId, CronjobStatuses.EXECUTED);
      unregisterCronTask(registry, jobId);
    } else if (job.type === 'recurring') {
      if (job.end_date && Date.now() >= job.end_date) {
        updateCronjobStatus(jobId, CronjobStatuses.COMPLETED);
        unregisterCronTask(registry, jobId);
      }
    }
  } catch (err) {
    log.error(`[CRON] ${phoneNumber} job ${jobId} failed`, err);
    updateExecutionStatus(executionId, CronjobStatuses.FAILED, Date.now());
    if (job.type === 'once') {
      updateCronjobStatus(jobId, CronjobStatuses.FAILED);
      unregisterCronTask(registry, jobId);
    }
  }
}
