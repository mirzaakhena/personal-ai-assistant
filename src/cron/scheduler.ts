import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import type { Client } from 'whatsapp-web.js';
import {
  getPendingOnceCronjobs,
  getActiveRecurringCronjobs,
  updateCronjobStatus,
  insertExecution,
  getLastExecutionForJob,
  type Cronjob,
} from '../db/cronjobs.js';
import { registerCronTask, type CronRegistry } from './registry.js';
import { processCronjob } from './executor.js';
import { computeMissedExecutionTimes } from '../utils/cron-utils.js';
import { enqueue } from '../whatsapp/queue.js';

const TIMEZONE = 'Asia/Jakarta';

function timestampToCronExpr(ms: number): string {
  const date = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    second: '2-digit',
    minute: '2-digit',
    hour: '2-digit',
    day: '2-digit',
    month: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const sec = parseInt(get('second'), 10);
  const min = parseInt(get('minute'), 10);
  const hour = parseInt(get('hour'), 10);
  const day = parseInt(get('day'), 10);
  const month = parseInt(get('month'), 10);

  return `${sec} ${min} ${hour} ${day} ${month} *`;
}

export function scheduleOnceJob(registry: CronRegistry, client: Client, job: Cronjob): void {
  if (!job.scheduled_at) return;

  const cronExpr = timestampToCronExpr(job.scheduled_at);
  console.log(`[CRON] Scheduling once job ${job.id} at cron: ${cronExpr}`);

  const task = cron.schedule(
    cronExpr,
    () => {
      task.stop();
      const executionId = uuidv4();
      insertExecution({
        id: executionId,
        cronjob_id: job.id,
        scheduled_at: job.scheduled_at!,
        executed_at: null,
        status: 'EXECUTING',
        created_at: Date.now(),
      });
      enqueue(job.phone_number, () => processCronjob(client, registry, job.id, executionId));
    },
    { timezone: TIMEZONE }
  );

  registerCronTask(registry, job.id, task);
}

export function scheduleRecurringJob(registry: CronRegistry, client: Client, job: Cronjob): void {
  if (!job.schedule_cron) return;

  console.log(`[CRON] Scheduling recurring job ${job.id} at cron: ${job.schedule_cron}`);

  const task = cron.schedule(
    job.schedule_cron,
    () => {
      if (job.end_date && Date.now() >= job.end_date) {
        updateCronjobStatus(job.id, 'COMPLETED');
        task.stop();
        registry.delete(job.id);
        return;
      }

      const scheduledAt = Date.now();
      const executionId = uuidv4();
      insertExecution({
        id: executionId,
        cronjob_id: job.id,
        scheduled_at: scheduledAt,
        executed_at: null,
        status: 'EXECUTING',
        created_at: Date.now(),
      });
      enqueue(job.phone_number, () => processCronjob(client, registry, job.id, executionId));
    },
    { timezone: TIMEZONE }
  );

  registerCronTask(registry, job.id, task);
}

export function reconcileOnStartup(registry: CronRegistry, client: Client): void {
  const now = Date.now();
  console.log('[CRON] Reconciling on startup...');

  // Reconcile pending once jobs
  const onceJobs = getPendingOnceCronjobs();
  for (const job of onceJobs) {
    if (!job.scheduled_at) continue;

    if (job.scheduled_at <= now) {
      console.log(`[CRON] Once job ${job.id} was missed — marking MISSED`);
      updateCronjobStatus(job.id, 'MISSED');
      insertExecution({
        id: uuidv4(),
        cronjob_id: job.id,
        scheduled_at: job.scheduled_at,
        executed_at: null,
        status: 'MISSED',
        created_at: now,
      });
    } else {
      scheduleOnceJob(registry, client, job);
    }
  }

  // Reconcile active recurring jobs
  const recurringJobs = getActiveRecurringCronjobs();
  for (const job of recurringJobs) {
    if (!job.schedule_cron) continue;

    if (job.end_date && now >= job.end_date) {
      console.log(`[CRON] Recurring job ${job.id} past end_date — marking COMPLETED`);
      updateCronjobStatus(job.id, 'COMPLETED');
      continue;
    }

    // Detect missed executions
    const lastExecution = getLastExecutionForJob(job.id);
    const fromTime = lastExecution?.scheduled_at ?? job.created_at;
    const missedTimes = computeMissedExecutionTimes(job.schedule_cron, fromTime, now);

    for (const missedAt of missedTimes) {
      console.log(`[CRON] Recurring job ${job.id} missed execution at ${new Date(missedAt).toISOString()}`);
      insertExecution({
        id: uuidv4(),
        cronjob_id: job.id,
        scheduled_at: missedAt,
        executed_at: null,
        status: 'MISSED',
        created_at: now,
      });
    }

    scheduleRecurringJob(registry, client, job);
  }

  console.log(`[CRON] Reconciliation complete — ${onceJobs.length} once, ${recurringJobs.length} recurring`);
}
