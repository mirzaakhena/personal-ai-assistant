import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Client } from 'whatsapp-web.js';
import { getCronjobById, updateCronjobStatus, updateExecutionStatus } from '../db/cronjobs.js';
import { unregisterCronTask, type CronRegistry } from './registry.js';
import { getSessionId, saveSessionId } from '../db/sessions.js';
import { createQueryOptions } from '../core/options.js';
import { buildCronjobPrompt } from '../utils/prompt.js';
import type { MessageContext } from '../tools/message.js';
import type { CronContext } from '../tools/message.js';

export async function processCronjob(
  client: Client,
  registry: CronRegistry,
  jobId: string,
  executionId: string
): Promise<void> {
  const job = getCronjobById(jobId);
  if (!job || job.status === 'CANCELLED') {
    console.log(`[CRON] Job ${jobId} not found or cancelled — skipping`);
    return;
  }

  const chatId = `${job.phone_number}@c.us`;
  const phoneNumber = job.phone_number;

  console.log(`[CRON][${phoneNumber}] Firing job ${jobId}: ${job.schedule_human}`);

  updateExecutionStatus(executionId, 'EXECUTING');
  if (job.type === 'once') {
    updateCronjobStatus(jobId, 'EXECUTING');
  }

  const sessionId = getSessionId(phoneNumber);
  const ctx: MessageContext = { client, chatId };
  const cronCtx: CronContext = { registry, client, phoneNumber };
  const prompt = buildCronjobPrompt(job.message);
  const options = await createQueryOptions(sessionId, ctx, cronCtx);
  const responses = query({ prompt, options });

  try {
    let finalSessionId: string | undefined;
    for await (const msg of responses) {
      if (msg.type === 'result') {
        finalSessionId = msg.session_id;
        console.log(`[CRON][${phoneNumber}] Cost: $${msg.total_cost_usd.toFixed(6)} | Session: ${msg.session_id}`);
      }
    }

    if (finalSessionId) {
      saveSessionId(phoneNumber, finalSessionId);
    }

    updateExecutionStatus(executionId, 'EXECUTED', Date.now());

    if (job.type === 'once') {
      updateCronjobStatus(jobId, 'EXECUTED');
      unregisterCronTask(registry, jobId);
    } else if (job.type === 'recurring') {
      if (job.end_date && Date.now() >= job.end_date) {
        updateCronjobStatus(jobId, 'COMPLETED');
        unregisterCronTask(registry, jobId);
      }
    }
  } catch (err) {
    console.error(`[CRON][${phoneNumber}] Job ${jobId} execution failed:`, err);
    updateExecutionStatus(executionId, 'FAILED', Date.now());
    if (job.type === 'once') {
      updateCronjobStatus(jobId, 'FAILED');
      unregisterCronTask(registry, jobId);
    }
    // recurring jobs stay ACTIVE on failure
  }
}
