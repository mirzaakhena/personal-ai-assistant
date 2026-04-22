// src-v4/gateway/console.ts

import * as readline from 'readline/promises';
import { stdin, stdout } from 'process';
import { join } from 'node:path';
import type { Gateway, ActiveSessionInfo } from './types.js';
import { createAIEngine } from '../ai-engine/index.js';
import type { QueryResult, ContentBlock } from '../ai-engine/index.js';
import { createMessageServer, type MessageDeliver } from '../tools/message.js';
import { createProfileMcpServer, createProfileHandlers } from '../tools/profile.js';
import { createPreferenceMcpServer, createPreferenceHandlers } from '../tools/preferences.js';
import { createKnowledgeMcpServer, createKnowledgeHandlers } from '../tools/knowledge.js';
import { createJournalMcpServer, createJournalHandlers } from '../tools/journal.js';
import { createTaskMcpServer, createTaskHandlers } from '../tools/tasks.js';
import { createCronjobServer, type CronjobHandlers } from '../tools/cronjob.js';
import { createSkillToolServer } from '../tools/skill.js';
import {
  createMessageHistoryServer,
  type MessageHandlers,
  type MessageSearchResult,
} from '../tools/message-history.js';
import { createCronScheduler } from '../cron/scheduler.js';
import { createUserDbCache } from '../db/user-db-cache.js';
import type { MessageRecord } from '../db/message.js';
import { v4 as uuidv4 } from 'uuid';
import { createTriggerServer } from '../trigger/server.js';
import type { TriggerServer } from '../trigger/types.js';
import { log } from '../utils/logger.js';
import { buildUserPrompt, buildSystemMessagePrompt } from '../utils/prompt.js';
import { assembleSystemPrompt, CORE_SYSTEM_PROMPT } from '../core/system-prompt.js';
import { buildWakeUpBriefing, renderWakeUpBriefing } from '../core/wake-up.js';
import { summarizeSession } from '../core/summarize.js';
import { ensureUserSkillDir } from '../skills/storage.js';
import { incrementTurnCount, getTurnCount, clearTurnCount } from '../utils/turns.js';
import { recordQuery, recordRateLimit, getStats, getRateLimit, clearStats } from '../utils/stats.js';
import { formatUsd } from '../utils/pricing.js';
import { getContextLimit, contextUsedFromUsage, formatTokens, formatResetsIn, formatResetsAtLocal } from '../utils/context-limits.js';
import { renderBarLine, contextPercentage } from '../utils/status-bar.js';
import { enqueue } from '../utils/queue.js';
import { requireModel } from '../utils/model-config.js';

export interface ConsoleGatewayConfig {
  /** Base data directory. Users live at <dataDir>/users/<userId>/. Default 'data'. */
  dataDir?: string;
  /** AI model. If omitted, falls back to process.env.CLAUDE_MODEL. */
  model?: string;
  /** User ID for the console session. Default 'console-user'. */
  userId?: string;
  /** Trigger server host. Default '127.0.0.1'. null disables trigger server. */
  triggerHost?: string | null;
  /** Trigger server port. Default 3100. */
  triggerPort?: number;
  /** Timezone label for wake-up briefing. Default 'WIB'. */
  timezone?: string;
  /** Soft turn threshold for session summarization. Default 30. */
  summarizeTurnThreshold?: number;
  /** Summarizer model. Default 'claude-haiku-4-5'. */
  summarizeModel?: string;
}

export function createConsoleGateway(config?: ConsoleGatewayConfig): Gateway {
  const userId = config?.userId ?? 'console-user';
  const model = requireModel(config?.model);
  const dataDir = config?.dataDir ?? 'data';
  const usersBaseDir = join(dataDir, 'users');
  const timezone = config?.timezone ?? 'WIB';
  const summarizeTurnThreshold =
    config?.summarizeTurnThreshold ??
    parseInt(process.env.SUMMARIZE_TURN_THRESHOLD ?? '30', 10);
  const summarizeModel =
    config?.summarizeModel ?? process.env.SUMMARIZE_MODEL ?? 'claude-haiku-4-5';

  const userDbCache = createUserDbCache(usersBaseDir);

  // Per-user cwd for the SDK's skill discovery.
  function cwdForUser(uid: string): string {
    return join(usersBaseDir, uid);
  }

  // Engine config uses the current userId's cwd as default. Fresh sessions
  // will override systemPrompt per-query with the full assembled prompt.
  const engine = createAIEngine({
    model,
    systemPrompt: assembleSystemPrompt(''),
    cwd: cwdForUser(userId),
  });

  // Pending-summarize flags per user — soft cutoff at turn threshold.
  const pendingSummarize = new Map<string, boolean>();

  // Last assembled system prompt (core + wake-up briefing). Set whenever
  // a fresh session is started; cleared on /new. Shown via /system_prompt
  // for reviewing what the AI is currently operating on.
  let lastSystemPrompt: string | undefined;

  const deliver: MessageDeliver = async (uid, content) => {
    console.log(`\n${content}\n`);
    const userDb = userDbCache.get(uid);
    userDb.messages.insert({
      id: `console:assistant:${uuidv4()}`,
      gateway: 'console',
      session_id: userDb.sessions.get() ?? null,
      sender: 'assistant',
      timestamp: Date.now(),
      type: 'text',
      body: content,
      has_media: 0,
      media_mimetype: null,
      media_filename: null,
      media_size: null,
      media_path: null,
      quoted_msg_id: null,
      is_forwarded: 0,
      raw_json: null,
    });
  };

  function toSearchResult(r: MessageRecord): MessageSearchResult {
    return {
      id: r.id,
      timestamp: r.timestamp,
      sender: r.sender,
      body: r.body,
      has_media: r.has_media === 1,
      gateway: r.gateway,
    };
  }

  const messageHandlersFactory = (uid: string): MessageHandlers => {
    const store = userDbCache.get(uid).messages;
    return {
      search: (filter) => store.search(filter).map(toSearchResult),
      getByIds: (ids) => store.getMessagesByIds(ids).map(toSearchResult),
      count: () => store.count(),
    };
  };

  const cronjobHandlersFactory = (uid: string): CronjobHandlers => ({
    create: (job) => scheduler.schedule(uid, job),
    list: () => scheduler.list(uid),
    delete: (jobId) => scheduler.delete(uid, jobId),
    update: (jobId, patch) => scheduler.update(uid, jobId, patch),
  });

  /**
   * If the user's turn count has crossed the summarize threshold in the
   * previous exchange, summarize the session and reset session state so
   * the next query starts fresh with a new briefing.
   */
  async function maybeSummarizeBeforeRun(queryUserId: string): Promise<void> {
    if (!pendingSummarize.get(queryUserId)) return;
    const userDb = userDbCache.get(queryUserId);
    const oldSessionId = userDb.sessions.get();
    if (oldSessionId) {
      log.debug(`soft-cutoff reached for ${queryUserId}: summarizing ${oldSessionId}`);
      await summarizeSession({
        sessionId: oldSessionId,
        userId: queryUserId,
        reason: 'turn_threshold',
        messages: userDb.messages,
        sessions: userDb.sessions,
        model: summarizeModel,
        cwd: cwdForUser(queryUserId),
      });
      userDb.sessions.delete();
      clearTurnCount(queryUserId);
    }
    pendingSummarize.set(queryUserId, false);
  }

  /** Shared query execution — used by user input, cron fire, and triggers */
  async function runQuery(queryUserId: string, prompt: string | ContentBlock[]): Promise<QueryResult> {
    await ensureUserSkillDir({ dataDir, userId: queryUserId });

    await maybeSummarizeBeforeRun(queryUserId);

    const userDb = userDbCache.get(queryUserId);
    const sessionId = userDb.sessions.get();
    const isFresh = sessionId === undefined;
    const cwd = cwdForUser(queryUserId);

    let systemPrompt: string | undefined;
    if (isFresh) {
      const now = new Date();
      const briefingData = buildWakeUpBriefing({
        userId: queryUserId,
        now,
        timezone,
        userDb,
      });
      systemPrompt = assembleSystemPrompt(renderWakeUpBriefing(briefingData));
      lastSystemPrompt = systemPrompt;
      log.debug(
        `fresh session for ${queryUserId} — briefing: ${
          briefingData.lastSummary ? 'summary present' : 'no summary, fallback'
        }`
      );
    }

    const result = await engine.query(prompt, {
      sessionId,
      systemPrompt,
      cwd,
      mcpServers: {
        message: createMessageServer(deliver, queryUserId),
        profile: createProfileMcpServer(createProfileHandlers(userDb.profile)),
        preferences: createPreferenceMcpServer(createPreferenceHandlers(userDb.preferences)),
        knowledge: createKnowledgeMcpServer(createKnowledgeHandlers(userDb.knowledge)),
        journal: createJournalMcpServer(createJournalHandlers(userDb.journal)),
        tasks: createTaskMcpServer(createTaskHandlers(userDb.tasks)),
        cronjob: createCronjobServer(cronjobHandlersFactory(queryUserId)),
        messages: createMessageHistoryServer(messageHandlersFactory(queryUserId)),
        skill: createSkillToolServer({ dataDir, userId: queryUserId }),
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

    // Check turn count against soft threshold AFTER the exchange completes.
    const turnAfter = getTurnCount(queryUserId);
    if (turnAfter >= summarizeTurnThreshold) {
      pendingSummarize.set(queryUserId, true);
      log.debug(`turn ${turnAfter} reached threshold ${summarizeTurnThreshold}; will summarize on next exchange`);
    }

    return result;
  }

  const scheduler = createCronScheduler({
    userDbCache,
    userIdFilter: (uid) => uid === userId,
    onFire: (job) => new Promise<void>((resolve, reject) => {
      enqueue(job.userId, async () => {
        try {
          log.debug(`cron:${job.id} firing — ${job.scheduleHuman}`);
          const cronUserDb = userDbCache.get(job.userId);
          cronUserDb.messages.insert({
            id: `system:cron:${uuidv4()}`,
            gateway: 'console',
            session_id: cronUserDb.sessions.get() ?? null,
            sender: 'system',
            timestamp: Date.now(),
            type: 'text',
            body: job.message,
            has_media: 0,
            media_mimetype: null,
            media_filename: null,
            media_size: null,
            media_path: null,
            quoted_msg_id: null,
            is_forwarded: 0,
            raw_json: null,
          });
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

  const triggerServer: TriggerServer | null = config?.triggerHost === null
    ? null
    : createTriggerServer({
        host: config?.triggerHost ?? '127.0.0.1',
        port: config?.triggerPort ?? 3100,
        onTrigger: ({ userId: triggerUserId, message }) => new Promise<void>((resolve, reject) => {
          enqueue(triggerUserId, async () => {
            try {
              log.debug(`trigger:${triggerUserId} — ${message}`);
              const triggerUserDb = userDbCache.get(triggerUserId);
              triggerUserDb.messages.insert({
                id: `system:trigger:${uuidv4()}`,
                gateway: 'console',
                session_id: triggerUserDb.sessions.get() ?? null,
                sender: 'system',
                timestamp: Date.now(),
                type: 'text',
                body: message,
                has_media: 0,
                media_mimetype: null,
                media_filename: null,
                media_size: null,
                media_path: null,
                quoted_msg_id: null,
                is_forwarded: 0,
                raw_json: null,
              });
              const prompt = buildSystemMessagePrompt(message);
              await runQuery(triggerUserId, prompt);
              resolve();
            } catch (err) {
              log.error(`trigger:${triggerUserId} failed`, err);
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
    const userDb = userDbCache.get(userId);
    const oldSessionId = userDb.sessions.get();
    if (oldSessionId) {
      // Fire-and-forget summarize for the old session so context carries over.
      void summarizeSession({
        sessionId: oldSessionId,
        userId,
        reason: 'manual',
        messages: userDb.messages,
        sessions: userDb.sessions,
        model: summarizeModel,
        cwd: cwdForUser(userId),
      });
    }
    userDb.sessions.delete();
    clearTurnCount(userId);
    clearStats(userId);
    pendingSummarize.set(userId, false);
    lastSystemPrompt = undefined;
    console.log('\nSession cleared. Starting fresh.\n');
  }

  function handleSystemPrompt(): void {
    if (!lastSystemPrompt) {
      console.log(
        '\nNo system prompt captured yet.\n' +
        '- Send any message first (a fresh session will assemble one), or\n' +
        '- Run /new to force a fresh session on the next message.\n' +
        '(Resumed sessions reuse the SDK-cached compiled prompt; the ' +
        'in-process cache only captures fresh-session assemblies.)\n'
      );
      return;
    }
    console.log('\n───────────── current system prompt ─────────────\n');
    console.log(lastSystemPrompt);
    console.log('\n───────────── end system prompt ─────────────\n');
    console.log(`(${lastSystemPrompt.length} chars)\n`);
  }

  function handleStatus(): void {
    const sessionId = getSessionId();
    const turnCount = getTurnCount(userId);
    const stats = getStats(userId);
    const userDb = userDbCache.get(userId);

    console.log('');
    console.log(`  Session:        ${sessionId ?? 'none'}`);
    console.log(`  Current turn:   ${turnCount} (this session)`);
    console.log(`  Turn threshold: ${summarizeTurnThreshold} (summarize-on-next-exchange)`);
    if (stats) {
      const a = stats.accumulated;
      const l = stats.lastQuery;
      const totalTokens = a.inputTokens + a.cacheCreationTokens + a.cacheReadTokens + a.outputTokens;
      const contextLimit = getContextLimit(stats.model);
      const lastQueryProcessed = contextUsedFromUsage({
        inputTokens: l.inputTokens,
        cacheCreationTokens: l.cacheCreationTokens,
        cacheReadTokens: l.cacheReadTokens,
      });

      const ctxPct = contextPercentage(lastQueryProcessed, contextLimit);
      console.log('');
      console.log('  ── Model & context ──');
      console.log(`  Model:          ${stats.model ?? 'unknown'}`);
      console.log(`  Context window: ${formatTokens(contextLimit)}`);
      console.log(`  Context:        ${renderBarLine(ctxPct, { color: true })}  (${formatTokens(lastQueryProcessed)} / ${formatTokens(contextLimit)})`);
      console.log(`  Last query:     ${formatTokens(lastQueryProcessed)} input tokens across ${l.numTurns} sub-turns`);
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

    const rl = getRateLimit(userId);
    if (rl) {
      const utilPct = rl.utilization !== null ? rl.utilization * 100 : null;
      console.log('');
      console.log('  ── Rate limit (Claude subscription) ──');
      console.log(`  Window:         ${rl.rateLimitType ?? 'unknown'}`);
      console.log(`  Status:         ${rl.status}`);
      console.log(
        utilPct !== null
          ? `  Usage:          ${renderBarLine(utilPct, { color: true })}`
          : '  Usage:          —'
      );
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

    // Record the incoming user message so search_messages can find it later.
    // This is what enables "amnesia recovery" and <msg_ref/> lookup.
    const userDb = userDbCache.get(userId);
    userDb.messages.insert({
      id: `console:user:${uuidv4()}`,
      gateway: 'console',
      session_id: userDb.sessions.get() ?? null,
      sender: 'user',
      timestamp: Date.now(),
      type: 'text',
      body: input,
      has_media: 0,
      media_mimetype: null,
      media_filename: null,
      media_size: null,
      media_path: null,
      quoted_msg_id: null,
      is_forwarded: 0,
      raw_json: null,
    });

    const prompt = buildUserPrompt(input);
    try {
      const result = await runQuery(userId, prompt);
      recordQuery(userDbCache.get(userId), userId, result);
      if (result.error) {
        // Non-success QueryResult — surface a concise message to the user so
        // they know the turn didn't complete cleanly, without dropping them
        // out of the gateway loop.
        console.log(
          `\n[${result.error.reason}] ${result.error.messages.join(' ')}\n` +
          `(session preserved — next message continues)\n`
        );
      }
    } catch (err) {
      // Any unexpected throw (tool crash, DB error, etc.) — keep the loop
      // alive rather than killing the process.
      log.error('handleMessage: unexpected error', err);
      console.log(
        `\n[internal error] ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }

  // Silence the "CORE_SYSTEM_PROMPT imported but unused" lint: we import it
  // only to guarantee module resolution at startup. The actual use is via
  // assembleSystemPrompt which re-exports the same constant. Keep the explicit
  // import so a missing core/system-prompt.ts fails fast at boot.
  void CORE_SYSTEM_PROMPT;

  function getActiveSessionsInternal(): ActiveSessionInfo[] {
    const sessionId = userDbCache.get(userId).sessions.get();
    if (!sessionId) return [];
    const userDb = userDbCache.get(userId);
    return [{
      sessionId,
      userId,
      cwd: cwdForUser(userId),
      messages: userDb.messages,
      sessions: userDb.sessions,
    }];
  }

  let stopping = false;

  return {
    async start(): Promise<void> {
      running = true;

      await scheduler.start();
      if (triggerServer) await triggerServer.start();

      rl = readline.createInterface({ input: stdin, output: stdout });

      console.log('');
      console.log('Personal AI Assistant v4 — Console Gateway');
      console.log(
        'Commands: /new (reset session), /status (show stats), ' +
        '/system_prompt (show active prompt), /exit (quit)'
      );
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
          case '/system_prompt':
            handleSystemPrompt();
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
      if (stopping) return;
      stopping = true;
      running = false;
      if (rl) {
        rl.close();
        rl = null;
      }
      if (triggerServer) await triggerServer.stop();
      await scheduler.stop();

      // Summarize any active session so the next boot gets a proper
      // wake-up briefing. Runs on /exit, SIGINT, and SIGTERM — all paths
      // converge here.
      const active = getActiveSessionsInternal();
      if (active.length > 0) {
        log.debug(`summarizing ${active.length} active session(s) before exit`);
        await Promise.allSettled(
          active.map((s) =>
            summarizeSession({
              sessionId: s.sessionId,
              userId: s.userId,
              reason: 'graceful_shutdown',
              messages: s.messages,
              sessions: s.sessions,
              model: summarizeModel,
              cwd: s.cwd,
              timeoutMs: 15_000,
            })
          )
        );
      }

      userDbCache.closeAll();
      console.log('\nGoodbye!\n');
    },

    getActiveSessions(): ActiveSessionInfo[] {
      return getActiveSessionsInternal();
    },
  };
}
