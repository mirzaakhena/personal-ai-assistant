// src-v3/cron/registry.ts

import type { ScheduledTask } from 'node-cron';

/**
 * Tracks active node-cron ScheduledTask instances by job ID.
 * In-memory — tasks are re-registered on startup via reconcile.
 */
export interface CronRegistry {
  register(jobId: string, task: ScheduledTask): void;
  unregister(jobId: string): void;
  clear(): void;
}

export function createCronRegistry(): CronRegistry {
  const tasks = new Map<string, ScheduledTask>();

  return {
    register(jobId, task) {
      tasks.set(jobId, task);
    },
    unregister(jobId) {
      const task = tasks.get(jobId);
      if (task) {
        task.stop();
        tasks.delete(jobId);
      }
    },
    clear() {
      for (const task of tasks.values()) {
        task.stop();
      }
      tasks.clear();
    },
  };
}
