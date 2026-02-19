import { describe, expect, it, vi } from 'vitest';
import {
  createCronRegistry,
  registerCronTask,
  unregisterCronTask,
} from '../../cron/registry.js';
import type { ScheduledTask } from 'node-cron';

function makeMockTask(): ScheduledTask {
  return { stop: vi.fn() } as unknown as ScheduledTask;
}

describe('createCronRegistry', () => {
  it('returns an empty Map', () => {
    const registry = createCronRegistry();
    expect(registry).toBeInstanceOf(Map);
    expect(registry.size).toBe(0);
  });
});

describe('registerCronTask', () => {
  it('adds a task to the registry under the given id', () => {
    const registry = createCronRegistry();
    const task = makeMockTask();
    registerCronTask(registry, 'job-1', task);
    expect(registry.get('job-1')).toBe(task);
  });

  it('overwrites an existing entry for the same id', () => {
    const registry = createCronRegistry();
    const task1 = makeMockTask();
    const task2 = makeMockTask();
    registerCronTask(registry, 'job-1', task1);
    registerCronTask(registry, 'job-1', task2);
    expect(registry.get('job-1')).toBe(task2);
    expect(registry.size).toBe(1);
  });
});

describe('unregisterCronTask', () => {
  it('calls task.stop() and removes the task from the registry', () => {
    const registry = createCronRegistry();
    const task = makeMockTask();
    registerCronTask(registry, 'job-1', task);

    unregisterCronTask(registry, 'job-1');

    expect(task.stop).toHaveBeenCalledOnce();
    expect(registry.has('job-1')).toBe(false);
  });

  it('does nothing when the id does not exist', () => {
    const registry = createCronRegistry();
    expect(() => unregisterCronTask(registry, 'nonexistent')).not.toThrow();
    expect(registry.size).toBe(0);
  });
});
