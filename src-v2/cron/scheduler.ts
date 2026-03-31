import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import type { MessageGateway } from '../gateway/types.js';
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
import { enqueue } from '../utils/queue.js';
import { log } from '../utils/logger.js';
import { TIMEZONE, CronjobStatuses } from '../core/constants.js';

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

export function scheduleOnceJob(registry: CronRegistry, gateway: MessageGateway, job: Cronjob): void {
  if (!job.scheduled_at) return;

  const cronExpr = timestampToCronExpr(job.scheduled_at);
  log.debug(`[CRON] scheduled once ${job.id} — ${job.schedule_human} (${cronExpr})`);

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
        status: CronjobStatuses.EXECUTING,
        created_at: Date.now(),
      });
      enqueue(job.phone_number, () => processCronjob(gateway, registry, job.id, executionId));
    },
    { timezone: TIMEZONE }
  );

  registerCronTask(registry, job.id, task);
}

export function scheduleRecurringJob(registry: CronRegistry, gateway: MessageGateway, job: Cronjob): void {
  if (!job.schedule_cron) return;

  log.debug(`[CRON] scheduled recurring ${job.id} — ${job.schedule_human} (${job.schedule_cron})`);

  const task = cron.schedule(
    job.schedule_cron,
    () => {
      if (job.end_date && Date.now() >= job.end_date) {
        updateCronjobStatus(job.id, CronjobStatuses.COMPLETED);
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
        status: CronjobStatuses.EXECUTING,
        created_at: Date.now(),
      });
      enqueue(job.phone_number, () => processCronjob(gateway, registry, job.id, executionId));
    },
    { timezone: TIMEZONE }
  );

  registerCronTask(registry, job.id, task);
}

export function reconcileOnStartup(registry: CronRegistry, gateway: MessageGateway): void {
  const now = Date.now();

  const onceJobs = getPendingOnceCronjobs();
  const recurringJobs = getActiveRecurringCronjobs();

  log.debug(`[CRON] startup — ${onceJobs.length} once, ${recurringJobs.length} recurring`);

  for (const job of onceJobs) {
    if (!job.scheduled_at) continue;

    if (job.scheduled_at <= now) {
      log.debug(`[CRON] missed once job ${job.id}`);
      updateCronjobStatus(job.id, CronjobStatuses.MISSED);
      insertExecution({
        id: uuidv4(),
        cronjob_id: job.id,
        scheduled_at: job.scheduled_at,
        executed_at: null,
        status: CronjobStatuses.MISSED,
        created_at: now,
      });
    } else {
      scheduleOnceJob(registry, gateway, job);
    }
  }

  for (const job of recurringJobs) {
    if (!job.schedule_cron) continue;

    if (job.end_date && now >= job.end_date) {
      log.debug(`[CRON] completed recurring job ${job.id} — past end_date`);
      updateCronjobStatus(job.id, CronjobStatuses.COMPLETED);
      continue;
    }

    const lastExecution = getLastExecutionForJob(job.id);
    const fromTime = lastExecution?.scheduled_at ?? job.created_at;
    const missedTimes = computeMissedExecutionTimes(job.schedule_cron, fromTime, now);

    if (missedTimes.length > 0) {
      log.debug(`[CRON] ${job.id} missed ${missedTimes.length} execution(s)`);
    }

    for (const missedAt of missedTimes) {
      insertExecution({
        id: uuidv4(),
        cronjob_id: job.id,
        scheduled_at: missedAt,
        executed_at: null,
        status: CronjobStatuses.MISSED,
        created_at: now,
      });
    }

    scheduleRecurringJob(registry, gateway, job);
  }
}
