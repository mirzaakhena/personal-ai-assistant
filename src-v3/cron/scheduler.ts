// src-v3/cron/scheduler.ts

import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { createCronjobStore, type CronjobRecord } from '../db/cronjobs.js';
import { createCronRegistry } from './registry.js';
import { computeMissedExecutionTimes } from './utils.js';
import type { CronjobInput, CronjobInfo } from '../tools/cronjob.js';
import { log } from '../utils/logger.js';

const TIMEZONE = 'Asia/Jakarta';

/** Job representation passed to onFire callback */
export interface ScheduledJob {
  id: string;
  userId: string;
  type: 'once' | 'recurring';
  message: string;
  scheduleHuman: string;
  scheduledAt?: number;
  scheduleCron?: string;
}

export interface CronSchedulerConfig {
  /** Path to cronjobs DB file. Default: 'data/cronjobs.db' */
  cronDbPath?: string;
  /** Called when a cron fires. Consumer decides what to do. */
  onFire: (job: ScheduledJob) => Promise<void>;
}

export interface CronScheduler {
  schedule(userId: string, input: CronjobInput): Promise<string>;
  list(userId: string): Promise<CronjobInfo[]>;
  delete(userId: string, jobId: string): Promise<boolean>;
  update(userId: string, jobId: string, patch: { message?: string }): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const TERMINAL_STATUSES = new Set(['CANCELLED', 'COMPLETED', 'EXECUTED', 'FAILED', 'MISSED']);

function recordToScheduledJob(r: CronjobRecord): ScheduledJob {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    message: r.message,
    scheduleHuman: r.schedule_human,
    scheduledAt: r.scheduled_at ?? undefined,
    scheduleCron: r.schedule_cron ?? undefined,
  };
}

function recordToInfo(r: CronjobRecord): CronjobInfo {
  return {
    id: r.id,
    type: r.type,
    message: r.message,
    scheduleHuman: r.schedule_human,
    status: r.status,
  };
}

/** Convert a millisecond timestamp to a 6-field cron expression in WIB */
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
  return `${parseInt(get('second'), 10)} ${parseInt(get('minute'), 10)} ${parseInt(get('hour'), 10)} ${parseInt(get('day'), 10)} ${parseInt(get('month'), 10)} *`;
}

export function createCronScheduler(config: CronSchedulerConfig): CronScheduler {
  const store = createCronjobStore(config.cronDbPath);
  const registry = createCronRegistry();

  /** Fire handler — executes onFire + updates DB */
  async function fire(job: CronjobRecord): Promise<void> {
    const executionId = uuidv4();
    const scheduledAt = job.scheduled_at ?? Date.now();
    store.insertExecution({
      id: executionId,
      cronjob_id: job.id,
      scheduled_at: scheduledAt,
      executed_at: null,
      status: 'EXECUTING',
      created_at: Date.now(),
    });

    try {
      await config.onFire(recordToScheduledJob(job));
      store.updateExecutionStatus(executionId, 'EXECUTED', Date.now());

      if (job.type === 'once') {
        store.updateJobStatus(job.id, 'EXECUTED');
        registry.unregister(job.id);
      } else if (job.type === 'recurring') {
        if (job.end_date && Date.now() >= job.end_date) {
          store.updateJobStatus(job.id, 'COMPLETED');
          registry.unregister(job.id);
        }
      }
    } catch (err) {
      log.error(`[CRON] job ${job.id} failed`, err);
      store.updateExecutionStatus(executionId, 'FAILED', Date.now());
      if (job.type === 'once') {
        store.updateJobStatus(job.id, 'FAILED');
        registry.unregister(job.id);
      }
    }
  }

  /** Register a once-type job with node-cron */
  function registerOnceTask(job: CronjobRecord): void {
    if (!job.scheduled_at) return;
    const cronExpr = timestampToCronExpr(job.scheduled_at);
    log.debug(`[CRON] register once ${job.id} — ${job.schedule_human} (${cronExpr})`);
    const task = cron.schedule(
      cronExpr,
      () => {
        task.stop();
        void fire(job);
      },
      { timezone: TIMEZONE }
    );
    registry.register(job.id, task);
  }

  /** Register a recurring job with node-cron */
  function registerRecurringTask(job: CronjobRecord): void {
    if (!job.schedule_cron) return;
    log.debug(`[CRON] register recurring ${job.id} — ${job.schedule_human} (${job.schedule_cron})`);
    const task = cron.schedule(
      job.schedule_cron,
      () => {
        if (job.end_date && Date.now() >= job.end_date) {
          store.updateJobStatus(job.id, 'COMPLETED');
          registry.unregister(job.id);
          return;
        }
        void fire(job);
      },
      { timezone: TIMEZONE }
    );
    registry.register(job.id, task);
  }

  return {
    async schedule(userId, input) {
      if (input.type === 'recurring') {
        if (!input.scheduleCron) throw new Error('schedule_cron is required for recurring jobs');
        if (!cron.validate(input.scheduleCron)) throw new Error(`Invalid cron expression: ${input.scheduleCron}`);
      }
      if (input.type === 'once') {
        if (!input.scheduledAt) throw new Error('scheduled_at is required for once jobs');
        const scheduledMs = new Date(input.scheduledAt).getTime();
        if (isNaN(scheduledMs)) throw new Error('Invalid scheduled_at datetime');
        if (scheduledMs <= Date.now()) throw new Error('scheduled_at must be in the future');
      }

      const now = Date.now();
      const jobId = uuidv4();
      const scheduledAtMs = input.scheduledAt ? new Date(input.scheduledAt).getTime() : null;

      const record: CronjobRecord = {
        id: jobId,
        user_id: userId,
        message: input.message,
        type: input.type,
        schedule_cron: input.scheduleCron ?? null,
        schedule_human: input.scheduleHuman,
        scheduled_at: scheduledAtMs,
        end_date: null,
        status: input.type === 'once' ? 'PENDING' : 'ACTIVE',
        created_at: now,
        updated_at: now,
      };

      store.insertJob(record);

      if (input.type === 'once') {
        registerOnceTask(record);
      } else {
        registerRecurringTask(record);
      }

      log.debug(`[CRON] scheduled ${input.type} ${jobId} for ${userId}: ${input.scheduleHuman}`);
      return jobId;
    },

    async list(userId) {
      return store.getJobsByUser(userId, true).map(recordToInfo);
    },

    async delete(userId, jobId) {
      const job = store.getJobById(jobId);
      if (!job) return false;
      if (job.user_id !== userId) return false;
      if (TERMINAL_STATUSES.has(job.status)) return false;
      store.updateJobStatus(jobId, 'CANCELLED');
      registry.unregister(jobId);
      log.debug(`[CRON] cancelled ${jobId}`);
      return true;
    },

    async update(userId, jobId, patch) {
      const job = store.getJobById(jobId);
      if (!job) return false;
      if (job.user_id !== userId) return false;
      if (TERMINAL_STATUSES.has(job.status)) return false;
      if (patch.message) {
        store.updateJobMessage(jobId, patch.message);
        log.debug(`[CRON] updated message for ${jobId}`);
      }
      return true;
    },

    async start() {
      const now = Date.now();

      const onceJobs = store.getPendingOnceJobs();
      const recurringJobs = store.getActiveRecurringJobs();

      log.debug(`[CRON] startup — ${onceJobs.length} once, ${recurringJobs.length} recurring`);

      for (const job of onceJobs) {
        if (!job.scheduled_at) continue;
        if (job.scheduled_at <= now) {
          log.debug(`[CRON] missed once ${job.id}`);
          store.updateJobStatus(job.id, 'MISSED');
          store.insertExecution({
            id: uuidv4(),
            cronjob_id: job.id,
            scheduled_at: job.scheduled_at,
            executed_at: null,
            status: 'MISSED',
            created_at: now,
          });
        } else {
          registerOnceTask(job);
        }
      }

      for (const job of recurringJobs) {
        if (!job.schedule_cron) continue;

        if (job.end_date && now >= job.end_date) {
          log.debug(`[CRON] recurring ${job.id} past end_date`);
          store.updateJobStatus(job.id, 'COMPLETED');
          continue;
        }

        const lastExecution = store.getLastExecutionForJob(job.id);
        const fromTime = lastExecution?.scheduled_at ?? job.created_at;
        const missedTimes = computeMissedExecutionTimes(job.schedule_cron, fromTime, now);

        if (missedTimes.length > 0) {
          log.debug(`[CRON] ${job.id} missed ${missedTimes.length} execution(s)`);
        }

        for (const missedAt of missedTimes) {
          store.insertExecution({
            id: uuidv4(),
            cronjob_id: job.id,
            scheduled_at: missedAt,
            executed_at: null,
            status: 'MISSED',
            created_at: now,
          });
        }

        registerRecurringTask(job);
      }
    },

    async stop() {
      registry.clear();
    },
  };
}
