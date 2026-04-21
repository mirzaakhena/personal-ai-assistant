// src-v4/cron/scheduler.ts

import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import type { CronjobRecord, CronjobStore } from '../db/cronjobs.js';
import { createCronRegistry } from './registry.js';
import { computeMissedExecutionTimes } from './utils.js';
import type { CronjobInput, CronjobInfo } from '../tools/cronjob.js';
import type { UserDbCache } from '../db/user-db-cache.js';
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
  /** User DB cache for resolving per-user cronjob stores */
  userDbCache: UserDbCache;
  /** Called when a cron fires. Consumer decides what to do. */
  onFire: (job: ScheduledJob) => Promise<void>;
  /**
   * Optional predicate for which user IDs this scheduler should reconcile at
   * startup. If omitted, ALL known users are reconciled (v3 behavior). Each
   * gateway should pass this so it does not cross-fire cronjobs belonging to
   * users from a different gateway (e.g. console booting with leftover
   * Telegram-user data in the same data dir).
   */
  userIdFilter?: (userId: string) => boolean;
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

function recordToScheduledJob(r: CronjobRecord, userId: string): ScheduledJob {
  return {
    id: r.id,
    userId,
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
  const userDbCache = config.userDbCache;
  const registry = createCronRegistry();

  /** Resolve the cronjob store for a given user. */
  function getStoreFor(userId: string): CronjobStore {
    return userDbCache.get(userId).cronjobs;
  }

  /** Fire handler — executes onFire + updates DB */
  async function fire(job: CronjobRecord, userId: string): Promise<void> {
    const store = getStoreFor(userId);
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
      await config.onFire(recordToScheduledJob(job, userId));
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
      log.error(`[CRON] job ${job.id} (${userId}) failed`, err);
      store.updateExecutionStatus(executionId, 'FAILED', Date.now());
      if (job.type === 'once') {
        store.updateJobStatus(job.id, 'FAILED');
        registry.unregister(job.id);
      }
    }
  }

  /** Register a once-type job with node-cron */
  function registerOnceTask(job: CronjobRecord, userId: string): void {
    if (!job.scheduled_at) return;
    const cronExpr = timestampToCronExpr(job.scheduled_at);
    log.debug(`[CRON] register once ${job.id} (${userId}) — ${job.schedule_human} (${cronExpr})`);
    const task = cron.schedule(
      cronExpr,
      () => {
        task.stop();
        void fire(job, userId);
      },
      { timezone: TIMEZONE }
    );
    registry.register(job.id, task);
  }

  /** Register a recurring job with node-cron */
  function registerRecurringTask(job: CronjobRecord, userId: string): void {
    if (!job.schedule_cron) return;
    log.debug(`[CRON] register recurring ${job.id} (${userId}) — ${job.schedule_human} (${job.schedule_cron})`);
    const task = cron.schedule(
      job.schedule_cron,
      () => {
        const store = getStoreFor(userId);
        if (job.end_date && Date.now() >= job.end_date) {
          store.updateJobStatus(job.id, 'COMPLETED');
          registry.unregister(job.id);
          return;
        }
        void fire(job, userId);
      },
      { timezone: TIMEZONE }
    );
    registry.register(job.id, task);
  }

  return {
    async schedule(userId, input) {
      const store = getStoreFor(userId);

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
        registerOnceTask(record, userId);
      } else {
        registerRecurringTask(record, userId);
      }

      log.debug(`[CRON] scheduled ${input.type} ${jobId} for ${userId}: ${input.scheduleHuman}`);
      return jobId;
    },

    async list(userId) {
      const store = getStoreFor(userId);
      return store.getJobs(true).map(recordToInfo);
    },

    async delete(userId, jobId) {
      const store = getStoreFor(userId);
      const job = store.getJobById(jobId);
      if (!job) return false;
      if (TERMINAL_STATUSES.has(job.status)) return false;
      store.updateJobStatus(jobId, 'CANCELLED');
      registry.unregister(jobId);
      log.debug(`[CRON] cancelled ${jobId}`);
      return true;
    },

    async update(userId, jobId, patch) {
      const store = getStoreFor(userId);
      const job = store.getJobById(jobId);
      if (!job) return false;
      if (TERMINAL_STATUSES.has(job.status)) return false;
      if (patch.message) {
        store.updateJobMessage(jobId, patch.message);
        log.debug(`[CRON] updated message for ${jobId}`);
      }
      return true;
    },

    async start() {
      const now = Date.now();
      const allKnown = userDbCache.listKnownUsers();
      const userIds = config.userIdFilter
        ? allKnown.filter(config.userIdFilter)
        : allKnown;
      const skipped = allKnown.length - userIds.length;
      if (skipped > 0) {
        log.debug(`[CRON] skipped ${skipped} user(s) outside this gateway's scope`);
      }
      let totalOnce = 0;
      let totalRecurring = 0;

      for (const userId of userIds) {
        const store = getStoreFor(userId);
        const onceJobs = store.getPendingOnceJobs();
        const recurringJobs = store.getActiveRecurringJobs();

        for (const job of onceJobs) {
          if (!job.scheduled_at) continue;
          if (job.scheduled_at <= now) {
            log.debug(`[CRON] missed once ${job.id} (${userId})`);
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
            registerOnceTask(job, userId);
            totalOnce++;
          }
        }

        for (const job of recurringJobs) {
          if (!job.schedule_cron) continue;

          if (job.end_date && now >= job.end_date) {
            log.debug(`[CRON] recurring ${job.id} (${userId}) past end_date`);
            store.updateJobStatus(job.id, 'COMPLETED');
            continue;
          }

          const lastExecution = store.getLastExecutionForJob(job.id);
          const fromTime = lastExecution?.scheduled_at ?? job.created_at;
          const missedTimes = computeMissedExecutionTimes(job.schedule_cron, fromTime, now);

          if (missedTimes.length > 0) {
            log.debug(`[CRON] ${job.id} (${userId}) missed ${missedTimes.length} execution(s)`);
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

          registerRecurringTask(job, userId);
          totalRecurring++;
        }
      }

      log.debug(`[CRON] startup — ${totalOnce} once, ${totalRecurring} recurring (across ${userIds.length} user${userIds.length === 1 ? '' : 's'})`);
    },

    async stop() {
      registry.clear();
    },
  };
}
