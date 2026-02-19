import { beforeEach, describe, expect, it, vi } from 'vitest';

// Replace better-sqlite3 with an in-memory instance so we never touch the filesystem.
vi.mock('better-sqlite3', async () => {
  const mod = await vi.importActual<{ default: any }>('better-sqlite3');
  const Actual = mod.default;
  function MockDatabase(_path: string) {
    return new Actual(':memory:');
  }
  return { default: MockDatabase };
});

// Reset module cache before each test so each test gets a fresh in-memory DB.
beforeEach(() => {
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    phone_number: '628111',
    message: 'test message',
    type: 'once' as const,
    schedule_cron: null,
    schedule_human: 'once',
    scheduled_at: Date.now() + 60_000,
    end_date: null,
    status: 'PENDING' as const,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function makeExec(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    cronjob_id: 'job-1',
    scheduled_at: Date.now(),
    executed_at: null,
    status: 'EXECUTING' as const,
    created_at: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('insertCronjob / getCronjobById', () => {
  it('retrieves an inserted job by id', async () => {
    const { insertCronjob, getCronjobById } = await import('../../db/cronjobs.js');
    const job = makeJob();
    insertCronjob(job);
    const found = getCronjobById('job-1');
    expect(found).toBeDefined();
    expect(found?.id).toBe('job-1');
    expect(found?.message).toBe('test message');
  });

  it('returns undefined for unknown id', async () => {
    const { getCronjobById } = await import('../../db/cronjobs.js');
    expect(getCronjobById('does-not-exist')).toBeUndefined();
  });
});

describe('updateCronjobStatus', () => {
  it('changes the status of an existing job', async () => {
    const { insertCronjob, updateCronjobStatus, getCronjobById } = await import(
      '../../db/cronjobs.js'
    );
    const job = makeJob();
    insertCronjob(job);
    updateCronjobStatus('job-1', 'MISSED');
    expect(getCronjobById('job-1')?.status).toBe('MISSED');
  });
});

describe('getCronjobsByPhone', () => {
  it('returns all jobs for the phone number when activeOnly=false', async () => {
    const { insertCronjob, getCronjobsByPhone } = await import('../../db/cronjobs.js');
    insertCronjob(makeJob({ id: 'j1', status: 'PENDING' }));
    insertCronjob(makeJob({ id: 'j2', status: 'CANCELLED' }));
    const all = getCronjobsByPhone('628111', false);
    expect(all).toHaveLength(2);
  });

  it('returns only non-terminal jobs when activeOnly=true', async () => {
    const { insertCronjob, updateCronjobStatus, getCronjobsByPhone } = await import(
      '../../db/cronjobs.js'
    );
    insertCronjob(makeJob({ id: 'j1' }));
    insertCronjob(makeJob({ id: 'j2' }));
    updateCronjobStatus('j2', 'CANCELLED');
    const active = getCronjobsByPhone('628111', true);
    expect(active.map((j) => j.id)).toContain('j1');
    expect(active.map((j) => j.id)).not.toContain('j2');
  });

  it('does not return jobs belonging to a different phone number', async () => {
    const { insertCronjob, getCronjobsByPhone } = await import('../../db/cronjobs.js');
    insertCronjob(makeJob({ id: 'j1', phone_number: '628111' }));
    insertCronjob(makeJob({ id: 'j2', phone_number: '628999' }));
    const result = getCronjobsByPhone('628111');
    expect(result.map((j) => j.id)).toEqual(['j1']);
  });
});

describe('getPendingOnceCronjobs', () => {
  it('returns only once jobs with PENDING status', async () => {
    const { insertCronjob, getPendingOnceCronjobs } = await import('../../db/cronjobs.js');
    insertCronjob(makeJob({ id: 'once-pending', type: 'once', status: 'PENDING' }));
    insertCronjob(makeJob({ id: 'once-missed', type: 'once', status: 'MISSED' }));
    insertCronjob(
      makeJob({ id: 'recurring-active', type: 'recurring', status: 'ACTIVE', schedule_cron: '0 9 * * *' })
    );
    const result = getPendingOnceCronjobs();
    expect(result.map((j) => j.id)).toEqual(['once-pending']);
  });
});

describe('getActiveRecurringCronjobs', () => {
  it('returns only recurring jobs with ACTIVE status', async () => {
    const { insertCronjob, getActiveRecurringCronjobs } = await import('../../db/cronjobs.js');
    insertCronjob(
      makeJob({ id: 'recurring-active', type: 'recurring', status: 'ACTIVE', schedule_cron: '0 9 * * *' })
    );
    insertCronjob(
      makeJob({
        id: 'recurring-completed',
        type: 'recurring',
        status: 'COMPLETED',
        schedule_cron: '0 9 * * *',
      })
    );
    insertCronjob(makeJob({ id: 'once-pending', type: 'once', status: 'PENDING' }));
    const result = getActiveRecurringCronjobs();
    expect(result.map((j) => j.id)).toEqual(['recurring-active']);
  });
});

describe('insertExecution / updateExecutionStatus / getLastExecutionForJob', () => {
  it('stores, updates, and retrieves the most recent execution', async () => {
    const { insertCronjob, insertExecution, updateExecutionStatus, getLastExecutionForJob } =
      await import('../../db/cronjobs.js');
    insertCronjob(makeJob());
    const exec = makeExec({ id: 'e1' });
    insertExecution(exec);
    updateExecutionStatus('e1', 'EXECUTED', 12345);
    const last = getLastExecutionForJob('job-1');
    expect(last).toBeDefined();
    expect(last?.id).toBe('e1');
    expect(last?.status).toBe('EXECUTED');
    expect(last?.executed_at).toBe(12345);
  });

  it('returns undefined for a job with no executions', async () => {
    const { insertCronjob, getLastExecutionForJob } = await import('../../db/cronjobs.js');
    insertCronjob(makeJob());
    expect(getLastExecutionForJob('job-1')).toBeUndefined();
  });

  it('retrieves the most recent execution when multiple exist', async () => {
    const { insertCronjob, insertExecution, getLastExecutionForJob } = await import(
      '../../db/cronjobs.js'
    );
    insertCronjob(makeJob());
    const t = Date.now();
    insertExecution(makeExec({ id: 'e1', scheduled_at: t - 1000 }));
    insertExecution(makeExec({ id: 'e2', scheduled_at: t }));
    const last = getLastExecutionForJob('job-1');
    expect(last?.id).toBe('e2');
  });
});
