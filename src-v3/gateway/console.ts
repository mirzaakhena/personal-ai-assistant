// src-v3/gateway/console.ts

import * as readline from 'readline/promises';
import { stdin, stdout } from 'process';
import type { Gateway } from './types.js';
import { createAIEngine } from '../ai-engine/index.js';
import { createMessageServer, type MessageDeliver } from '../tools/message.js';
import { createMemoryServer, type MemoryHandlers } from '../tools/memory.js';
import { createCronjobServer, type CronjobHandlers, type CronjobInfo } from '../tools/cronjob.js';
import { createSessionStore } from '../db/sessions.js';
import { log } from '../utils/logger.js';
import { buildUserPrompt } from '../utils/prompt.js';
import { incrementTurnCount, getTurnCount, clearTurnCount } from '../utils/turns.js';
import { updateStats, getStats, clearStats } from '../utils/stats.js';

/** Factory that returns handlers scoped to a specific userId */
export type MemoryHandlersFactory = (userId: string) => MemoryHandlers;
export type CronjobHandlersFactory = (userId: string) => CronjobHandlers;

export interface ConsoleGatewayConfig {
  /** Session DB path, default 'data/sessions.db' */
  sessionDbPath?: string;
  /** AI model, default 'haiku' */
  model?: string;
  /** Memory handlers factory, default in-memory Map keyed by userId */
  memoryHandlers?: MemoryHandlersFactory;
  /** Cronjob handlers factory, default in-memory Map keyed by userId */
  cronjobHandlers?: CronjobHandlersFactory;
  /** User ID for the console session, default 'console-user' */
  userId?: string;
}

/** Default in-memory backend — shared Map, keyed by `${userId}:${key}` */
function defaultMemoryHandlersFactory(): MemoryHandlersFactory {
  const backend = new Map<string, string>();
  return (userId: string) => ({
    save: (key, value) => {
      backend.set(`${userId}:${key}`, value);
      log.debug(`memory:save [${userId}] ${key} = ${value}`);
    },
    recall: (key) => {
      const value = backend.get(`${userId}:${key}`) ?? null;
      log.debug(`memory:recall [${userId}] ${key} → ${value}`);
      return value;
    },
  });
}

/** Default in-memory cronjob backend — shared Map, each entry tagged with userId */
function defaultCronjobHandlersFactory(): CronjobHandlersFactory {
  interface StoredJob extends CronjobInfo { userId: string; }
  const backend = new Map<string, StoredJob>();
  let counter = 0;
  return (userId: string) => ({
    create: (job) => {
      const id = `job_${++counter}`;
      backend.set(id, {
        id,
        userId,
        type: job.type,
        message: job.message,
        scheduleHuman: job.scheduleHuman,
        status: 'active',
      });
      log.debug(`cronjob:create [${userId}] ${id} — ${job.scheduleHuman}`);
      return id;
    },
    list: () =>
      [...backend.values()]
        .filter((j) => j.userId === userId)
        .map(({ userId: _uid, ...info }) => info),
    delete: (id) => {
      const job = backend.get(id);
      if (!job || job.userId !== userId) return false;
      return backend.delete(id);
    },
  });
}

export function createConsoleGateway(config?: ConsoleGatewayConfig): Gateway {
  const userId = config?.userId ?? 'console-user';
  const model = config?.model ?? 'haiku';
  const memoryHandlersFactory = config?.memoryHandlers ?? defaultMemoryHandlersFactory();
  const cronjobHandlersFactory = config?.cronjobHandlers ?? defaultCronjobHandlersFactory();

  const sessions = createSessionStore(config?.sessionDbPath);

  // Engine has NO MCP servers at creation — all servers bind userId per-query
  const engine = createAIEngine({ model });

  // Internal delivery — how this gateway sends messages to the user
  const deliver: MessageDeliver = async (_uid, content) => {
    console.log(`\n${content}\n`);
  };

  let rl: readline.Interface | null = null;
  let running = false;

  function getSessionId(): string | undefined {
    return sessions.get(userId);
  }

  function handleNew(): void {
    sessions.delete(userId);
    clearTurnCount(userId);
    clearStats(userId);
    console.log('\nSession cleared. Starting fresh.\n');
  }

  function handleStatus(): void {
    const sessionId = getSessionId();
    const turnCount = getTurnCount(userId);
    const stats = getStats(userId);

    console.log('');
    console.log(`  Session:  ${sessionId ?? 'none'}`);
    console.log(`  Turns:    ${turnCount}`);
    if (stats) {
      console.log(`  Cost:     $${stats.accumulated.costUsd.toFixed(4)} (last: $${stats.lastQuery.costUsd.toFixed(4)})`);
      console.log(`  Duration: ${stats.accumulated.durationMs}ms (last: ${stats.lastQuery.durationMs}ms)`);
      console.log(`  AI Turns: ${stats.accumulated.numTurns} (last: ${stats.lastQuery.numTurns})`);
    } else {
      console.log('  Stats:    no queries yet');
    }
    console.log('');
  }

  async function handleMessage(input: string): Promise<void> {
    const turn = incrementTurnCount(userId);
    const sessionId = getSessionId();
    const prompt = buildUserPrompt(input);

    log.debug(`turn ${turn}, session: ${sessionId ?? 'new'}`);

    const result = await engine.query(prompt, {
      sessionId,
      mcpServers: {
        message: createMessageServer(deliver, userId),
        memory: createMemoryServer(memoryHandlersFactory(userId)),
        cronjob: createCronjobServer(cronjobHandlersFactory(userId)),
      },
      callbacks: {
        onInit: (info) => log.debug(`model=${info.model} tools=${info.tools.length}`),
        onThinking: (text) => log.debug(`thinking: ${text.slice(0, 80)}...`),
        onToolUse: (name) => log.debug(`tool: ${name}`),
        onSessionId: (id) => log.debug(`session: ${id}`),
        onError: (err) => log.error(`[${err.level}] ${err.reason}: ${err.messages.join(', ')}`),
        onFallback: (text) => {
          log.error('send_message not called');
          if (text) {
            console.log(`\n${text}\n`);
          }
        },
      },
    });

    sessions.save(userId, result.sessionId);
    updateStats(userId, result.sessionId, result.costUsd, result.durationMs, result.numTurns);
  }

  return {
    async start(): Promise<void> {
      running = true;
      rl = readline.createInterface({ input: stdin, output: stdout });

      console.log('');
      console.log('Personal AI Assistant v3 — Console Gateway');
      console.log('Commands: /new (reset session), /status (show stats), /exit (quit)');
      console.log('');

      const savedSession = getSessionId();
      if (savedSession) {
        log.debug(`resuming session: ${savedSession}`);
      }

      while (running) {
        let input: string;
        try {
          input = await rl.question('you > ');
        } catch {
          break;
        }

        const trimmed = input.trim();
        if (!trimmed) continue;

        switch (trimmed) {
          case '/new':
            handleNew();
            break;
          case '/status':
            handleStatus();
            break;
          case '/exit':
            running = false;
            break;
          default:
            await handleMessage(trimmed);
            break;
        }
      }

      await this.stop();
    },

    async stop(): Promise<void> {
      running = false;
      if (rl) {
        rl.close();
        rl = null;
      }
      console.log('\nGoodbye!\n');
    },
  };
}
