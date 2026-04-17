// src-v3/gateway/console.ts

import * as readline from 'readline/promises';
import { stdin, stdout } from 'process';
import type { Gateway } from './types.js';
import { createAIEngine } from '../ai-engine/index.js';
import type { QueryResult, ContentBlock } from '../ai-engine/index.js';
import { createMessageServer, type MessageDeliver } from '../tools/message.js';
import { createMemoryServer, buildMemoryHandlers } from '../tools/memory.js';
import { createCronjobServer, type CronjobHandlers } from '../tools/cronjob.js';
import { createTasksServer, buildTaskHandlers } from '../tools/tasks.js';
import { createHabitsServer, buildHabitHandlers } from '../tools/habits.js';
import { createCronScheduler } from '../cron/scheduler.js';
import { createUserDbCache } from '../db/user-db-cache.js';
import { createTriggerServer } from '../trigger/server.js';
import type { TriggerServer } from '../trigger/types.js';
import { log } from '../utils/logger.js';
import { buildUserPrompt, buildSystemMessagePrompt } from '../utils/prompt.js';
import { buildSystemPromptWithMemory } from '../utils/system-prompt.js';
import { maybeResetSession } from '../utils/session-reset.js';
import { incrementTurnCount, getTurnCount, clearTurnCount } from '../utils/turns.js';
import { recordQuery, recordRateLimit, getStats, getRateLimit, clearStats } from '../utils/stats.js';
import { formatUsd } from '../utils/pricing.js';
import { getContextLimit, contextUsedFromUsage, formatTokens, formatResetsIn, formatResetsAtLocal } from '../utils/context-limits.js';
import { enqueue } from '../utils/queue.js';
import { requireModel } from '../utils/model-config.js';

export interface ConsoleGatewayConfig {
  /** Base directory for per-user DB folders, default 'data/users' */
  usersBaseDir?: string;
  /** AI model. If omitted, falls back to process.env.CLAUDE_MODEL; throws if neither set. */
  model?: string;
  /** User ID for the console session, default 'console-user' */
  userId?: string;
  /**
   * Trigger server host. Default '127.0.0.1'.
   * Set to `null` to disable the trigger server entirely.
   */
  triggerHost?: string | null;
  /** Trigger server port. Default 3100. */
  triggerPort?: number;
}

export function createConsoleGateway(config?: ConsoleGatewayConfig): Gateway {
  const userId = config?.userId ?? 'console-user';
  const model = requireModel(config?.model);
  const userDbCache = createUserDbCache(config?.usersBaseDir);

  // Engine has NO MCP servers at creation — all servers bind userId per-query
  const engine = createAIEngine({ model });

  // Internal delivery — how this gateway sends messages to the user
  const deliver: MessageDeliver = async (_uid, content) => {
    console.log(`\n${content}\n`);
  };

  // Cronjob handlers factory — delegates to scheduler
  const cronjobHandlersFactory = (userId: string): CronjobHandlers => ({
    create: (job) => scheduler.schedule(userId, job),
    list: () => scheduler.list(userId),
    delete: (jobId) => scheduler.delete(userId, jobId),
    update: (jobId, patch) => scheduler.update(userId, jobId, patch),
  });

  /** Shared query execution — used by both user input and cron fire */
  async function runQuery(queryUserId: string, prompt: string | ContentBlock[]): Promise<QueryResult> {
    const userDb = userDbCache.get(queryUserId);

    maybeResetSession(userDb, `[console:${queryUserId}]`);

    const sessionId = userDb.sessions.get();
    const isFresh = sessionId === undefined;

    let systemPrompt: string | undefined;
    if (isFresh) {
      const bundle = userDb.loadAlwaysBundle();
      systemPrompt = buildSystemPromptWithMemory(bundle);
      log.debug(`fresh session for ${queryUserId} — injecting memory bundle (profile=${bundle.profile.length}, relationships=${bundle.relationships.length}, ongoing=${bundle.ongoing.length}, recent=${bundle.recent.length}, tasks=${bundle.tasks.length}, habits=${bundle.habits.length})`);
    }

    const result = await engine.query(prompt, {
      sessionId,
      systemPrompt,
      mcpServers: {
        message: createMessageServer(deliver, queryUserId),
        memory: createMemoryServer(buildMemoryHandlers(userDb.memory, sessionId ?? null)),
        cronjob: createCronjobServer(cronjobHandlersFactory(queryUserId)),
        tasks: createTasksServer(buildTaskHandlers(userDb.tasks)),
        habits: createHabitsServer(buildHabitHandlers(userDb.habits)),
      },
      callbacks: {
        onInit: (info) => log.debug(`model=${info.model} tools=${info.tools.length}`),
        onThinking: (text) => log.debug(`thinking: ${text}`),
        onToolUse: (name) => log.debug(`tool: ${name}`),
        onSessionId: (id) => log.debug(`session: ${id}`),
        onRateLimit: (info) => recordRateLimit(queryUserId, info),
        onError: (err) => log.error(`[${err.level}] ${err.reason}: ${err.messages.join(', ')}`),
        onFallback: (text) => {
          log.debug('send_message not called (possibly not relevant)');
          if (text) console.log(`\n${text}\n`);
        },
      },
    });

    userDb.sessions.save(result.sessionId);
    return result;
  }

  // Cron scheduler — fires wrapped in queue to serialize per-user
  const scheduler = createCronScheduler({
    userDbCache,
    onFire: (job) => new Promise<void>((resolve, reject) => {
      enqueue(job.userId, async () => {
        try {
          log.debug(`cron:${job.id} firing — ${job.scheduleHuman}`);
          const prompt = buildSystemMessagePrompt(job.message);
          await runQuery(job.userId, prompt);
          resolve();
        } catch (err) {
          log.error(`cron:${job.id} failed`, err);
          reject(err);
        }
      });
    }),
  });

  // Trigger server — optional, disabled if triggerHost === null
  const triggerServer: TriggerServer | null = config?.triggerHost === null
    ? null
    : createTriggerServer({
        host: config?.triggerHost ?? '127.0.0.1',
        port: config?.triggerPort ?? 3100,
        onTrigger: ({ userId, message }) => new Promise<void>((resolve, reject) => {
          enqueue(userId, async () => {
            try {
              log.debug(`trigger:${userId} — ${message}`);
              const prompt = buildSystemMessagePrompt(message);
              await runQuery(userId, prompt);
              resolve();
            } catch (err) {
              log.error(`trigger:${userId} failed`, err);
              reject(err);
            }
          });
        }),
      });

  let rl: readline.Interface | null = null;
  let running = false;

  function getSessionId(): string | undefined {
    return userDbCache.get(userId).sessions.get();
  }

  function handleNew(): void {
    userDbCache.get(userId).sessions.delete();
    clearTurnCount(userId);
    clearStats(userId);
    console.log('\nSession cleared. Starting fresh.\n');
  }

  function handleStatus(): void {
    const sessionId = getSessionId();
    const turnCount = getTurnCount(userId);
    const stats = getStats(userId);
    const userDb = userDbCache.get(userId);

    console.log('');
    console.log(`  Session:        ${sessionId ?? 'none'}`);
    console.log(`  Current turn:   ${turnCount} (this session)`);
    if (stats) {
      const a = stats.accumulated;
      const l = stats.lastQuery;
      const totalTokens = a.inputTokens + a.cacheCreationTokens + a.cacheReadTokens + a.outputTokens;
      const contextLimit = getContextLimit(stats.model);
      const contextUsed = contextUsedFromUsage({
        inputTokens: l.inputTokens,
        cacheCreationTokens: l.cacheCreationTokens,
        cacheReadTokens: l.cacheReadTokens,
      });
      const contextPct = contextLimit > 0 ? Math.round((contextUsed / contextLimit) * 100) : 0;

      console.log('');
      console.log('  ── Context ──');
      console.log(`  Model:          ${stats.model ?? 'unknown'}`);
      console.log(`  Context:        ${formatTokens(contextUsed)} / ${formatTokens(contextLimit)} (${contextPct}%)`);
      console.log('');
      console.log('  ── This session ──');
      console.log(`  Actual cost:    ${formatUsd(a.costUsd)} (last: ${formatUsd(l.costUsd)})`);
      console.log(`  Simulated API:  ${formatUsd(a.simulatedApiCostUsd)} (last: ${formatUsd(l.simulatedApiCostUsd)})`);
      console.log(`  Tokens total:   ${totalTokens.toLocaleString()}`);
      console.log(`    input:        ${a.inputTokens.toLocaleString()}`);
      console.log(`    cache write:  ${a.cacheCreationTokens.toLocaleString()}`);
      console.log(`    cache read:   ${a.cacheReadTokens.toLocaleString()} (cached → cheap)`);
      console.log(`    output:       ${a.outputTokens.toLocaleString()}`);
      console.log(`  Duration:       ${a.durationMs}ms (last: ${l.durationMs}ms)`);
      console.log(`  AI sub-turns:   ${a.numTurns} (last: ${l.numTurns}) — internal tool cycles`);
    } else {
      console.log('  Stats:    no queries yet');
    }

    // Rate limit
    const rl = getRateLimit(userId);
    if (rl) {
      const utilPct = rl.utilization !== null ? Math.round(rl.utilization * 100) : null;
      console.log('');
      console.log('  ── Rate limit (Claude subscription) ──');
      console.log(`  Window:         ${rl.rateLimitType ?? 'unknown'}`);
      console.log(`  Status:         ${rl.status}`);
      console.log(utilPct !== null ? `  Usage:          ${utilPct}%` : '  Usage:          —');
      console.log(`  Resets:         ${formatResetsAtLocal(rl.resetsAt)} WIB (in ${formatResetsIn(rl.resetsAt)})`);
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const today = userDb.queryCosts.aggregateSince(now - dayMs);
    const month = userDb.queryCosts.aggregateSince(now - 30 * dayMs);
    if (today.queries > 0 || month.queries > 0) {
      console.log('');
      console.log('  ── Last 24h ──');
      console.log(`  Queries:        ${today.queries}`);
      console.log(`  Actual cost:    ${formatUsd(today.actual_cost_usd)}`);
      console.log(`  Simulated API:  ${formatUsd(today.simulated_api_cost_usd)}`);
      console.log('');
      console.log('  ── Last 30d ──');
      console.log(`  Queries:        ${month.queries}`);
      console.log(`  Actual cost:    ${formatUsd(month.actual_cost_usd)}`);
      console.log(`  Simulated API:  ${formatUsd(month.simulated_api_cost_usd)}`);
    }
    console.log('');
  }

  async function handleMessage(input: string): Promise<void> {
    const turn = incrementTurnCount(userId);
    log.debug(`turn ${turn}`);

    const prompt = buildUserPrompt(input);
    const result = await runQuery(userId, prompt);
    recordQuery(userDbCache.get(userId), userId, result);
  }

  return {
    async start(): Promise<void> {
      running = true;

      // Start cron scheduler first — reconciles DB and starts ticking
      await scheduler.start();
      if (triggerServer) await triggerServer.start();

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
      if (triggerServer) await triggerServer.stop();
      await scheduler.stop();
      userDbCache.closeAll();
      console.log('\nGoodbye!\n');
    },
  };
}
