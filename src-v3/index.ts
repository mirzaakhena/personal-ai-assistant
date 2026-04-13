// src-v3/index.ts

import { createAIEngine } from './ai-engine/index.js';
import { createMessageServer } from './tools/message.js';
import { createMemoryServer } from './tools/memory.js';
import { createCronjobServer, type CronjobInfo } from './tools/cronjob.js';

// ── Simple in-memory stores for development ──────────────

const memoryStore = new Map<string, string>();

const cronjobStore = new Map<string, CronjobInfo>();
let jobCounter = 0;

// ── Create engine with all tools ─────────────────────────

const engine = createAIEngine({
  model: 'haiku',
  mcpServers: {
    message: createMessageServer(async (messages) => {
      for (const msg of messages) {
        console.log(`[send_message]: ${msg.content}`);
      }
    }),
    memory: createMemoryServer({
      save: (key, value) => {
        memoryStore.set(key, value);
        console.log(`[memory:save]: ${key} = ${value}`);
      },
      recall: (key) => {
        const value = memoryStore.get(key) ?? null;
        console.log(`[memory:recall]: ${key} → ${value}`);
        return value;
      },
    }),
    cronjob: createCronjobServer({
      create: (job) => {
        const id = `job_${++jobCounter}`;
        cronjobStore.set(id, {
          id,
          type: job.type,
          message: job.message,
          scheduleHuman: job.scheduleHuman,
          status: 'active',
        });
        console.log(`[cronjob:create]: ${id} — ${job.scheduleHuman}`);
        return id;
      },
      list: () => {
        const jobs = [...cronjobStore.values()];
        console.log(`[cronjob:list]: ${jobs.length} jobs`);
        return jobs;
      },
      delete: (jobId) => {
        const deleted = cronjobStore.delete(jobId);
        console.log(`[cronjob:delete]: ${jobId} → ${deleted}`);
        return deleted;
      },
    }),
  },
});

// ── Run a test query ─────────────────────────────────────

const prompt = '[user]: Hello, who are you?';

console.log(prompt);
console.log('---');

const result = await engine.query(prompt, {
  callbacks: {
    onInit: (info) => console.log(`[init]: model=${info.model} tools=${info.tools.length}`),
    onThinking: (text) => console.log(`[thinking]: ${text.slice(0, 100)}...`),
    onMessage: (text) => console.log(`[message]: ${text.slice(0, 100)}...`),
    onToolUse: (name) => console.log(`[tool]: ${name}`),
    onSessionId: (id) => console.log(`[session]: ${id}`),
    onRateLimit: (info) => console.log(`[rate_limit]: resets=${info.resetsAt}`),
    onError: (err) => console.error(`[error]: [${err.level}] ${err.reason}: ${err.messages.join(', ')}`),
    onFallback: (text) => console.warn(`[fallback]: send_message not called. text=${text.slice(0, 100)}`),
  },
});

console.log('---');
console.log(`Session: ${result.sessionId}`);
console.log(`Cost: $${result.costUsd.toFixed(4)}`);
console.log(`Duration: ${result.durationMs}ms`);
console.log(`Turns: ${result.numTurns}`);
console.log(`sendMessageCalled: ${result.sendMessageCalled}`);
if (result.error) {
  console.error(`Error: [${result.error.level}] ${result.error.reason}`);
}
