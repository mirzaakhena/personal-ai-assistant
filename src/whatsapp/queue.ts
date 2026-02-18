const queues = new Map<string, Promise<void>>();

export function enqueue(phone: string, task: () => Promise<void>): void {
  const current = queues.get(phone) ?? Promise.resolve();
  const next = current.then(task).catch(console.error);
  queues.set(phone, next);
  next.finally(() => {
    if (queues.get(phone) === next) queues.delete(phone);
  });
}
