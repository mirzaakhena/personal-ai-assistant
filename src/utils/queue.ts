// src/utils/queue.ts

/**
 * Per-key sequential task queue.
 * Tasks enqueued under the same key execute sequentially (FIFO).
 * Tasks under different keys execute in parallel.
 *
 * Typical use: per-user message delivery to prevent interleaving.
 * Errors in a task do not block subsequent tasks under the same key.
 */
const queues = new Map<string, Promise<void>>();

export function enqueue(key: string, task: () => Promise<void>): void {
  const current = queues.get(key) ?? Promise.resolve();
  const next = current.then(task).catch((err) => {
    console.error(`[queue] task failed for key ${key}:`, err);
  });
  queues.set(key, next);
  next.finally(() => {
    // Clean up the map entry only if no newer task was chained after this one
    if (queues.get(key) === next) queues.delete(key);
  });
}
