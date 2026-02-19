import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — all must be declared before any imports that trigger module loading
// ---------------------------------------------------------------------------

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(() => ({ stop: vi.fn() })),
    validate: vi.fn(() => true),
  },
}));

vi.mock('../../db/cronjobs.js', () => ({
  getPendingOnceCronjobs: vi.fn(() => []),
  getActiveRecurringCronjobs: vi.fn(() => []),
  updateCronjobStatus: vi.fn(),
  insertExecution: vi.fn(),
  getLastExecutionForJob: vi.fn(() => undefined),
}));

vi.mock('../../cron/executor.js', () => ({ processCronjob: vi.fn() }));

vi.mock('../../utils/cron-utils.js', () => ({
  computeMissedExecutionTimes: vi.fn(() => []),
}));

vi.mock('../../whatsapp/queue.js', () => ({ enqueue: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports — after mocks are registered
// ---------------------------------------------------------------------------

import cron from 'node-cron';
import {
  getPendingOnceCronjobs,
  getActiveRecurringCronjobs,
  updateCronjobStatus,
  insertExecution,
  getLastExecutionForJob,
  type Cronjob,
} from '../../db/cronjobs.js';
import { computeMissedExecutionTimes } from '../../utils/cron-utils.js';
import { createCronRegistry } from '../../cron/registry.js';
import {
  reconcileOnStartup,
  scheduleOnceJob,
  scheduleRecurringJob,
} from '../../cron/scheduler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Date.now();

function makeOnceJob(overrides: Partial<Cronjob> = {}): Cronjob {
  return {
    id: 'job-once',
    phone_number: '628111',
    message: 'test',
    type: 'once',
    schedule_cron: null,
    schedule_human: 'once at some time',
    scheduled_at: NOW + 60_000,
    end_date: null,
    status: 'PENDING',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeRecurringJob(overrides: Partial<Cronjob> = {}): Cronjob {
  return {
    id: 'job-recurring',
    phone_number: '628111',
    message: 'test',
    type: 'recurring',
    schedule_cron: '0 9 * * *',
    schedule_human: 'daily 9am',
    scheduled_at: null,
    end_date: null,
    status: 'ACTIVE',
    created_at: NOW - 86_400_000,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default return values after clearAllMocks
  vi.mocked(getPendingOnceCronjobs).mockReturnValue([]);
  vi.mocked(getActiveRecurringCronjobs).mockReturnValue([]);
  vi.mocked(getLastExecutionForJob).mockReturnValue(undefined);
  vi.mocked(computeMissedExecutionTimes).mockReturnValue([]);
  vi.mocked(cron.schedule).mockReturnValue({ stop: vi.fn() } as any);
});

// ---------------------------------------------------------------------------
// reconcileOnStartup — once jobs
// ---------------------------------------------------------------------------

describe('reconcileOnStartup — once jobs', () => {
  it('marks a past once job as MISSED and inserts a MISSED execution', () => {
    const job = makeOnceJob({ scheduled_at: NOW - 5_000 });
    vi.mocked(getPendingOnceCronjobs).mockReturnValue([job]);

    reconcileOnStartup(createCronRegistry(), {} as any);

    expect(updateCronjobStatus).toHaveBeenCalledWith(job.id, 'MISSED');
    expect(insertExecution).toHaveBeenCalledWith(
      expect.objectContaining({ cronjob_id: job.id, status: 'MISSED' })
    );
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it('schedules a future once job via cron.schedule', () => {
    const job = makeOnceJob({ scheduled_at: NOW + 60_000 });
    vi.mocked(getPendingOnceCronjobs).mockReturnValue([job]);

    reconcileOnStartup(createCronRegistry(), {} as any);

    expect(updateCronjobStatus).not.toHaveBeenCalledWith(job.id, 'MISSED');
    expect(cron.schedule).toHaveBeenCalledOnce();
  });

  it('silently skips a once job with null scheduled_at', () => {
    const job = makeOnceJob({ scheduled_at: null });
    vi.mocked(getPendingOnceCronjobs).mockReturnValue([job]);

    expect(() => reconcileOnStartup(createCronRegistry(), {} as any)).not.toThrow();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(updateCronjobStatus).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reconcileOnStartup — recurring jobs
// ---------------------------------------------------------------------------

describe('reconcileOnStartup — recurring jobs', () => {
  it('marks a past-end_date recurring job as COMPLETED without scheduling', () => {
    const job = makeRecurringJob({ end_date: NOW - 1_000 });
    vi.mocked(getActiveRecurringCronjobs).mockReturnValue([job]);

    reconcileOnStartup(createCronRegistry(), {} as any);

    expect(updateCronjobStatus).toHaveBeenCalledWith(job.id, 'COMPLETED');
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it('inserts a MISSED execution for each missed time', () => {
    const job = makeRecurringJob();
    vi.mocked(getActiveRecurringCronjobs).mockReturnValue([job]);
    const missedTimes = [NOW - 7_200_000, NOW - 3_600_000];
    vi.mocked(computeMissedExecutionTimes).mockReturnValue(missedTimes);

    reconcileOnStartup(createCronRegistry(), {} as any);

    expect(insertExecution).toHaveBeenCalledTimes(2);
    expect(insertExecution).toHaveBeenCalledWith(
      expect.objectContaining({ cronjob_id: job.id, status: 'MISSED', scheduled_at: missedTimes[0] })
    );
    expect(insertExecution).toHaveBeenCalledWith(
      expect.objectContaining({ cronjob_id: job.id, status: 'MISSED', scheduled_at: missedTimes[1] })
    );
  });

  it('schedules an active recurring job with Jakarta timezone', () => {
    const job = makeRecurringJob();
    vi.mocked(getActiveRecurringCronjobs).mockReturnValue([job]);

    reconcileOnStartup(createCronRegistry(), {} as any);

    expect(cron.schedule).toHaveBeenCalledWith(
      job.schedule_cron,
      expect.any(Function),
      { timezone: 'Asia/Jakarta' }
    );
  });

  it('uses lastExecution.scheduled_at as fromTime when available', () => {
    const job = makeRecurringJob();
    const lastExecTime = NOW - 3_600_000;
    vi.mocked(getActiveRecurringCronjobs).mockReturnValue([job]);
    vi.mocked(getLastExecutionForJob).mockReturnValue({
      id: 'e1',
      cronjob_id: job.id,
      scheduled_at: lastExecTime,
      executed_at: null,
      status: 'EXECUTED',
      created_at: lastExecTime,
    });

    reconcileOnStartup(createCronRegistry(), {} as any);

    expect(computeMissedExecutionTimes).toHaveBeenCalledWith(
      job.schedule_cron,
      lastExecTime,
      expect.any(Number)
    );
  });

  it('falls back to job.created_at when no execution history', () => {
    const job = makeRecurringJob();
    vi.mocked(getActiveRecurringCronjobs).mockReturnValue([job]);
    vi.mocked(getLastExecutionForJob).mockReturnValue(undefined);

    reconcileOnStartup(createCronRegistry(), {} as any);

    expect(computeMissedExecutionTimes).toHaveBeenCalledWith(
      job.schedule_cron,
      job.created_at,
      expect.any(Number)
    );
  });
});

// ---------------------------------------------------------------------------
// scheduleOnceJob
// ---------------------------------------------------------------------------

describe('scheduleOnceJob', () => {
  it('calls cron.schedule with the correct cron expression for a known timestamp', () => {
    // 2026-03-15T09:30:45+07:00 = Asia/Jakarta 09:30:45 on March 15
    const scheduledAt = new Date('2026-03-15T09:30:45+07:00').getTime();
    const registry = createCronRegistry();
    const job = makeOnceJob({ id: 'job-once-ts', scheduled_at: scheduledAt });

    scheduleOnceJob(registry, {} as any, job);

    expect(cron.schedule).toHaveBeenCalledWith(
      '45 30 9 15 3 *',
      expect.any(Function),
      { timezone: 'Asia/Jakarta' }
    );
  });

  it('registers the returned task in the registry under job.id', () => {
    const mockTask = { stop: vi.fn() };
    vi.mocked(cron.schedule).mockReturnValue(mockTask as any);
    const registry = createCronRegistry();
    const job = makeOnceJob({ id: 'job-reg' });

    scheduleOnceJob(registry, {} as any, job);

    expect(registry.get('job-reg')).toBe(mockTask);
  });

  it('skips scheduling when scheduled_at is null', () => {
    const registry = createCronRegistry();
    const job = makeOnceJob({ scheduled_at: null });

    scheduleOnceJob(registry, {} as any, job);

    expect(cron.schedule).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scheduleRecurringJob
// ---------------------------------------------------------------------------

describe('scheduleRecurringJob', () => {
  it('calls cron.schedule with job.schedule_cron directly', () => {
    const registry = createCronRegistry();
    const job = makeRecurringJob({ schedule_cron: '0 8 * * 1-5' });

    scheduleRecurringJob(registry, {} as any, job);

    expect(cron.schedule).toHaveBeenCalledWith(
      '0 8 * * 1-5',
      expect.any(Function),
      { timezone: 'Asia/Jakarta' }
    );
  });

  it('registers the returned task in the registry under job.id', () => {
    const mockTask = { stop: vi.fn() };
    vi.mocked(cron.schedule).mockReturnValue(mockTask as any);
    const registry = createCronRegistry();
    const job = makeRecurringJob({ id: 'job-recurring-reg' });

    scheduleRecurringJob(registry, {} as any, job);

    expect(registry.get('job-recurring-reg')).toBe(mockTask);
  });

  it('skips scheduling when schedule_cron is null', () => {
    const registry = createCronRegistry();
    const job = makeRecurringJob({ schedule_cron: null });

    scheduleRecurringJob(registry, {} as any, job);

    expect(cron.schedule).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });
});
