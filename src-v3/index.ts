// src-v3/index.ts

import { createAIEngine } from './ai-engine/index.js';
import { createMessageServer } from './tools/message.js';
import { createMemoryServer } from './tools/memory.js';
import { createCronjobServer, type CronjobInfo } from './tools/cronjob.js';
import { createSessionStore } from './db/sessions.js';
import { createConsoleGateway } from './gateway/console.js';
import { log } from './utils/logger.js';

// ── Simple in-memory stores for development ──────────────

const memoryStore = new Map<string, string>();

const cronjobStore = new Map<string, CronjobInfo>();
let jobCounter = 0;

// ── Infrastructure ───────────────────────────────────────

const sessions = createSessionStore();

// ── Create engine with all tools ─────────────────────────

const engine = createAIEngine({
  model: 'haiku',
  mcpServers: {
    message: createMessageServer(async (messages) => {
      for (const msg of messages) {
        console.log(`\n${msg.content}\n`);
      }
    }),
    memory: createMemoryServer({
      save: (key, value) => {
        memoryStore.set(key, value);
        log.debug(`memory:save ${key} = ${value}`);
      },
      recall: (key) => {
        const value = memoryStore.get(key) ?? null;
        log.debug(`memory:recall ${key} → ${value}`);
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
        log.debug(`cronjob:create ${id} — ${job.scheduleHuman}`);
        return id;
      },
      list: () => [...cronjobStore.values()],
      delete: (jobId) => cronjobStore.delete(jobId),
    }),
  },
});

// ── Start console gateway ────────────────────────────────

const gateway = createConsoleGateway({ engine, sessions });
await gateway.start();
