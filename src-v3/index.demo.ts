// src-v3/index.ts

import { createAIEngine } from './ai-engine/index.js';
import { createMessageServer } from './tools/message.js';
import { createMemoryServer } from './tools/memory.js';
import { createCronjobServer, type CronjobInfo } from './tools/cronjob.js';
import { log } from './utils/logger.js';
import { buildUserPrompt } from './utils/prompt.js';
import { incrementTurnCount, getTurnCount } from './utils/turns.js';
import { updateStats, getStats } from './utils/stats.js';
import { createSessionStore } from './db/sessions.js';

// ── Simple in-memory stores for development ──────────────

const memoryStore = new Map<string, string>();

const cronjobStore = new Map<string, CronjobInfo>();
let jobCounter = 0;

const sessions = createSessionStore(); // default: data/sessions.db

// ── Create engine with all tools ─────────────────────────

const engine = createAIEngine({
  model: 'haiku',
  mcpServers: {
    message: createMessageServer(async (_uid, content) => {
      log.chat(`← ${content}`);
    }, 'dev-user'),
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

// ── Run a test query ─────────────────────────────────────

const userId = 'dev-user';
const turn = incrementTurnCount(userId);
const savedSessionId = sessions.get(userId);

log.debug(`Turn ${turn}, saved session: ${savedSessionId ?? 'none'}`);

const prompt = buildUserPrompt('Hello, who are you?');

log.chat(`→ ${prompt.split('\n').pop()}`);

const result = await engine.query(prompt, {
  sessionId: savedSessionId,
  callbacks: {
    onInit: (info) => log.debug(`init: model=${info.model} tools=${info.tools.length}`),
    onThinking: (text) => log.debug(`thinking: ${text.slice(0, 80)}...`),
    onToolUse: (name) => log.debug(`tool: ${name}`),
    onSessionId: (id) => log.debug(`session: ${id}`),
    onError: (err) => log.error(`[${err.level}] ${err.reason}: ${err.messages.join(', ')}`),
    onFallback: (text) => log.error(`send_message not called. text=${text.slice(0, 100)}`),
  },
});

// ── Post-query bookkeeping ───────────────────────────────

sessions.save(userId, result.sessionId);
updateStats(userId, result.sessionId, result.costUsd, result.durationMs, result.numTurns);

const stats = getStats(userId);
log.debug(`---`);
log.debug(`Session: ${result.sessionId}`);
log.debug(`Cost: $${result.costUsd.toFixed(4)} (accumulated: $${stats?.accumulated.costUsd.toFixed(4)})`);
log.debug(`Duration: ${result.durationMs}ms`);
log.debug(`Turns: ${result.numTurns} (total: ${stats?.accumulated.numTurns})`);
log.debug(`Turn count: ${getTurnCount(userId)}`);
log.debug(`sendMessageCalled: ${result.sendMessageCalled}`);
if (result.error) {
  log.error(`Error: [${result.error.level}] ${result.error.reason}`);
}
