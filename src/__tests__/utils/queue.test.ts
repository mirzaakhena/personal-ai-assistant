import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueue } from '../../utils/queue.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('enqueue', () => {
  it('executes a single task', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    enqueue('628111', fn);
    await sleep(10);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('executes tasks for the same phone sequentially in order', async () => {
    const order: number[] = [];

    const task1 = vi.fn(async () => {
      await sleep(30);
      order.push(1);
    });
    const task2 = vi.fn(async () => {
      order.push(2);
    });

    enqueue('628111', task1);
    enqueue('628111', task2);

    await sleep(80);
    expect(order).toEqual([1, 2]);
  });

  it('executes tasks for different phones concurrently', async () => {
    const order: string[] = [];

    const slowTask = vi.fn(async () => {
      await sleep(40);
      order.push('slow');
    });
    const fastTask = vi.fn(async () => {
      order.push('fast');
    });

    enqueue('628111', slowTask);
    enqueue('628222', fastTask);

    await sleep(80);
    expect(order).toEqual(['fast', 'slow']);
  });

  it('continues processing after a task rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const order: number[] = [];

    const failingTask = vi.fn().mockRejectedValue(new Error('boom'));
    const nextTask = vi.fn(async () => {
      order.push(2);
    });

    enqueue('628111', failingTask);
    enqueue('628111', nextTask);

    await sleep(30);
    expect(failingTask).toHaveBeenCalledOnce();
    expect(nextTask).toHaveBeenCalledOnce();
    expect(order).toEqual([2]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('maintains order across many rapid enqueues', async () => {
    const order: number[] = [];

    for (let i = 0; i < 5; i++) {
      const idx = i;
      enqueue('628111', async () => {
        await sleep(5);
        order.push(idx);
      });
    }

    await sleep(100);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});
