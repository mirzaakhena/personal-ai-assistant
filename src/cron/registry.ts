import type { ScheduledTask } from 'node-cron';

export type CronRegistry = Map<string, ScheduledTask>;

export function createCronRegistry(): CronRegistry {
  return new Map();
}

export function registerCronTask(registry: CronRegistry, jobId: string, task: ScheduledTask): void {
  registry.set(jobId, task);
}

export function unregisterCronTask(registry: CronRegistry, jobId: string): void {
  const task = registry.get(jobId);
  if (task) {
    task.stop();
    registry.delete(jobId);
  }
}
