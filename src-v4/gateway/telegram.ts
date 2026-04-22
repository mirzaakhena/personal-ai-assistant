// src-v4/gateway/telegram.ts

import { Bot } from 'grammy';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'node:path';
import type { Gateway, ActiveSessionInfo } from './types.js';
import { createAIEngine } from '../ai-engine/index.js';
import type { QueryResult, ContentBlock } from '../ai-engine/index.js';
import {
  validateAndBuildBlock,
  formatValidationError,
  type MediaContentBlock,
} from '../utils/media.js';
import { createMessageServer, type MessageDeliver } from '../tools/message.js';
import { createProfileMcpServer, createProfileHandlers } from '../tools/profile.js';
import { createPreferenceMcpServer, createPreferenceHandlers } from '../tools/preferences.js';
import { createKnowledgeMcpServer, createKnowledgeHandlers } from '../tools/knowledge.js';
import { createJournalMcpServer, createJournalHandlers } from '../tools/journal.js';
import { createTaskMcpServer, createTaskHandlers } from '../tools/tasks.js';
import { createCronjobServer, type CronjobHandlers } from '../tools/cronjob.js';
import { createSkillToolServer } from '../tools/skill.js';
import { createCronScheduler } from '../cron/scheduler.js';
import { createUserDbCache } from '../db/user-db-cache.js';
import type { MessageRecord } from '../db/message.js';
import {
  createMessageHistoryServer,
  type MessageHandlers,
  type MessageSearchResult,
} from '../tools/message-history.js';
import { createTriggerServer } from '../trigger/server.js';
import type { TriggerServer } from '../trigger/types.js';
import { log } from '../utils/logger.js';
import {
  buildUserPrompt,
  buildSystemMessagePrompt,
  type QuotedInfo,
} from '../utils/prompt.js';
import { assembleSystemPrompt, CORE_SYSTEM_PROMPT } from '../core/system-prompt.js';
import { buildWakeUpBriefing, renderWakeUpBriefing } from '../core/wake-up.js';
import { summarizeSession } from '../core/summarize.js';
import { ensureUserSkillDir } from '../skills/storage.js';
import { incrementTurnCount, getTurnCount, clearTurnCount } from '../utils/turns.js';
import { requireModel } from '../utils/model-config.js';
import {
  recordQuery,
  recordRateLimit,
  getStats,
  getRateLimit,
  clearStats,
} from '../utils/stats.js';
import { formatUsd } from '../utils/pricing.js';
import {
  getContextLimit,
  contextUsedFromUsage,
  formatTokens,
  formatResetsIn,
  formatResetsAtLocal,
} from '../utils/context-limits.js';
import { renderBarLine, contextPercentage } from '../utils/status-bar.js';
import { enqueue } from '../utils/queue.js';

const TYPING_MS_PER_CHAR = 30;
const MIN_TYPING_DURATION_MS = 1000;
const MAX_TYPING_DURATION_MS = 8000;
const TYPING_REFRESH_INTERVAL_MS = 4000;

function calcTypingDuration(content: string): number {
  return Math.min(
    Math.max(content.length * TYPING_MS_PER_CHAR, MIN_TYPING_DURATION_MS),
    MAX_TYPING_DURATION_MS
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Incoming message dedup ---
const DEDUP_CAP = 1000;
const DEDUP_KEEP = 500;
const processedIncomingIds = new Set<string>();

function isDuplicateIncoming(key: string): boolean {
  if (processedIncomingIds.has(key)) return true;
  processedIncomingIds.add(key);
  if (processedIncomingIds.size > DEDUP_CAP) {
    const keep = [...processedIncomingIds].slice(-DEDUP_KEEP);
    processedIncomingIds.clear();
    for (const id of keep) processedIncomingIds.add(id);
  }
  return false;
}

// --- Quoted message extraction ---
interface RawReplyToMessage {
  text?: string;
  date?: number;
  from?: { is_bot?: boolean };
  forward_origin?: unknown;
}

function extractQuoted(
  reply: RawReplyToMessage | undefined
): QuotedInfo | undefined {
  if (!reply) return undefined;
  if (typeof reply.text !== 'string') return undefined;
  return {
    content: reply.text,
    sender: reply.from?.is_bot ? 'assistant' : 'user',
    at: typeof reply.date === 'number' ? new Date(reply.date * 1000) : undefined,
    forwarded: Boolean(reply.forward_origin),
  };
}

export interface TelegramGatewayConfig {
  token: string;
  whitelist: number[];
  /** Base data directory. Users live at <dataDir>/users/<userId>/. Default 'data'. */
  dataDir?: string;
  model?: string;
  triggerHost?: string | null;
  triggerPort?: number;
  timezone?: string;
  summarizeTurnThreshold?: number;
  summarizeModel?: string;
}

export function createTelegramGateway(config: TelegramGatewayConfig): Gateway {
  if (!config.token) {
    throw new Error('Telegram bot token is required');
  }

  const model = requireModel(config.model);
  const dataDir = config.dataDir ?? 'data';
  const usersBaseDir = join(dataDir, 'users');
  const timezone = config.timezone ?? 'WIB';
  const summarizeTurnThreshold =
    config.summarizeTurnThreshold ??
    parseInt(process.env.SUMMARIZE_TURN_THRESHOLD ?? '30', 10);
  const summarizeModel =
    config.summarizeModel ?? process.env.SUMMARIZE_MODEL ?? 'claude-haiku-4-5';
  const userDbCache = createUserDbCache(usersBaseDir);
  const whitelist = new Set(config.whitelist);

  function cwdForUser(uid: string): string {
    return join(usersBaseDir, uid);
  }

  // Engine created once; cwd & systemPrompt overridden per-query per-user.
  // The engine-level cwd is a placeholder pointing at the users root dir —
  // every query resolves its own user cwd.
  const engine = createAIEngine({
    model,
    systemPrompt: assembleSystemPrompt(''),
    cwd: usersBaseDir,
  });

  const bot = new Bot(config.token);

  // Track users we've seen during this process lifetime, so getActiveSessions
  // can report all of them for graceful-shutdown summarization.
  const seenUsers = new Set<string>();

  // Per-user pending-summarize flag (soft cutoff at turn threshold).
  const pendingSummarize = new Map<string, boolean>();

  async function downloadTelegramFile(fileId: string): Promise<string> {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) throw new Error('file_path missing from getFile response');
    const url = `https://api.telegram.org/file/bot${config.token}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download failed: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  }

  const deliver: MessageDeliver = async (userId, content, options) => {
    const chatId = Number(userId);
    const pause = options?.pauseBeforeTyping ?? 0;

    if (pause > 0) await sleep(pause);

    const end = Date.now() + calcTypingDuration(content);
    while (Date.now() < end) {
      try {
        await bot.api.sendChatAction(chatId, 'typing');
      } catch (err) {
        log.debug(`[TG] sendChatAction failed: ${err}`);
      }
      const remaining = end - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(TYPING_REFRESH_INTERVAL_MS, remaining));
    }

    try {
      const sent = await bot.api.sendMessage(chatId, content);
      const assistantUserDb = userDbCache.get(String(chatId));
      assistantUserDb.messages.insert({
        id: `${chatId}:${sent.message_id}`,
        gateway: 'telegram',
        session_id: assistantUserDb.sessions.get() ?? null,
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
      log.chat(`${chatId} ← ${content}`);
    } catch (err) {
      log.error(`[TG] sendMessage failed for ${chatId}`, err);
      throw err;
    }
  };

  const cronjobHandlersFactory = (uid: string): CronjobHandlers => ({
    create: (job) => scheduler.schedule(uid, job),
    list: () => scheduler.list(uid),
    delete: (jobId) => scheduler.delete(uid, jobId),
    update: (jobId, patch) => scheduler.update(uid, jobId, patch),
  });

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

  async function maybeSummarizeBeforeRun(uid: string): Promise<void> {
    if (!pendingSummarize.get(uid)) return;
    const userDb = userDbCache.get(uid);
    const oldSessionId = userDb.sessions.get();
    if (oldSessionId) {
      log.debug(`[TG] soft-cutoff reached for ${uid}: summarizing ${oldSessionId}`);
      await summarizeSession({
        sessionId: oldSessionId,
        userId: uid,
        reason: 'turn_threshold',
        messages: userDb.messages,
        sessions: userDb.sessions,
        model: summarizeModel,
        cwd: cwdForUser(uid),
      });
      userDb.sessions.delete();
      clearTurnCount(uid);
    }
    pendingSummarize.set(uid, false);
  }

  async function runQuery(
    queryUserId: string,
    prompt: string | ContentBlock[]
  ): Promise<QueryResult> {
    seenUsers.add(queryUserId);

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
      log.debug(
        `[TG] fresh session for ${queryUserId} — briefing: ${
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
        onInit: (info) => log.debug(`[TG] model=${info.model} tools=${info.tools.length}`),
        onThinking: (text) => log.debug(`[TG] thinking: ${text}`),
        onToolUse: (name) => log.debug(`[TG] tool: ${name}`),
        onSessionId: (id) => log.debug(`[TG] session: ${id}`),
        onRateLimit: (info) => recordRateLimit(queryUserId, info),
        onError: (err) =>
          log.error(`[TG] [${err.level}] ${err.reason}: ${err.messages.join(', ')}`),
        onFallback: (_text) => {
          log.debug('[TG] send_message not called (possibly not relevant)');
        },
      },
    });

    userDb.sessions.save(result.sessionId);

    const turnAfter = getTurnCount(queryUserId);
    if (turnAfter >= summarizeTurnThreshold) {
      pendingSummarize.set(queryUserId, true);
      log.debug(
        `[TG] turn ${turnAfter} reached threshold ${summarizeTurnThreshold}; will summarize on next exchange`
      );
    }

    return result;
  }

  // Telegram whitelist uses numeric chat IDs; per-user dirs use stringified.
  const whitelistStrings = new Set(config.whitelist.map(String));

  const scheduler = createCronScheduler({
    userDbCache,
    userIdFilter: (uid) => whitelistStrings.has(uid),
    onFire: (job) =>
      new Promise<void>((resolve, reject) => {
        enqueue(job.userId, async () => {
          try {
            log.debug(`[TG] cron:${job.id} firing — ${job.scheduleHuman}`);
            const userDb = userDbCache.get(job.userId);
            userDb.messages.insert({
              id: `system:cron:${uuidv4()}`,
              gateway: 'telegram',
              session_id: userDb.sessions.get() ?? null,
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
            log.error(`[TG] cron:${job.id} failed`, err);
            reject(err);
          }
        });
      }),
  });

  const triggerServer: TriggerServer | null =
    config.triggerHost === null
      ? null
      : createTriggerServer({
          host: config.triggerHost ?? '127.0.0.1',
          port: config.triggerPort ?? 3100,
          onTrigger: ({ userId, message }) =>
            new Promise<void>((resolve, reject) => {
              enqueue(userId, async () => {
                try {
                  log.debug(`[TG] trigger:${userId} — ${message}`);
                  const userDb = userDbCache.get(userId);
                  userDb.messages.insert({
                    id: `system:trigger:${uuidv4()}`,
                    gateway: 'telegram',
                    session_id: userDb.sessions.get() ?? null,
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
                  await runQuery(userId, prompt);
                  resolve();
                } catch (err) {
                  log.error(`[TG] trigger:${userId} failed`, err);
                  reject(err);
                }
              });
            }),
        });

  bot.on(['message:text', ':photo', ':document'], async (ctx) => {
    const chatId = ctx.chat.id;
    if (!whitelist.has(chatId)) {
      log.debug(`[TG] blocked chat: ${chatId}`);
      return;
    }
    if (!ctx.message) return;

    const msgKey = `${chatId}:${ctx.message.message_id}`;
    if (isDuplicateIncoming(msgKey)) {
      log.debug(`[TG] dedup: skipping duplicate incoming ${msgKey}`);
      return;
    }

    const text = (ctx.message.text ?? ctx.message.caption ?? '').trim();
    const userId = String(chatId);

    const mediaBlocks: MediaContentBlock[] = [];

    if (ctx.message.photo && ctx.message.photo.length > 0) {
      const largest = ctx.message.photo[ctx.message.photo.length - 1];
      try {
        const data = await downloadTelegramFile(largest.file_id);
        const validation = validateAndBuildBlock({ data, mimetype: 'image/jpeg' });
        if (!validation.ok) {
          await bot.api.sendMessage(chatId, `⚠️ ${formatValidationError(validation.error)}`);
          return;
        }
        mediaBlocks.push(validation.block);
      } catch (err) {
        log.error(`[TG] photo download failed`, err);
        await bot.api.sendMessage(chatId, '⚠️ Gagal memuat foto. Coba kirim ulang.');
        return;
      }
    }

    if (ctx.message.document) {
      const doc = ctx.message.document;
      try {
        const data = await downloadTelegramFile(doc.file_id);
        const validation = validateAndBuildBlock({
          data,
          mimetype: doc.mime_type ?? 'application/octet-stream',
          filename: doc.file_name,
        });
        if (!validation.ok) {
          await bot.api.sendMessage(chatId, `⚠️ ${formatValidationError(validation.error)}`);
          return;
        }
        mediaBlocks.push(validation.block);
      } catch (err) {
        log.error(`[TG] document download failed`, err);
        await bot.api.sendMessage(chatId, '⚠️ Gagal memuat dokumen. Coba kirim ulang.');
        return;
      }
    }

    if (!text && mediaBlocks.length === 0) return;

    const photoMeta =
      ctx.message.photo && ctx.message.photo.length > 0
        ? ctx.message.photo[ctx.message.photo.length - 1]
        : null;
    const docMeta = ctx.message.document ?? null;

    const isCommand =
      mediaBlocks.length === 0 && ['/start', '/new', '/status'].includes(text);
    if (!isCommand) {
      const messageType =
        mediaBlocks.length > 0 ? (photoMeta ? 'image' : 'document') : 'text';
      const mediaMimetype = photoMeta ? 'image/jpeg' : docMeta?.mime_type ?? null;
      const mediaSize = photoMeta?.file_size ?? docMeta?.file_size ?? null;
      const mediaFilename = docMeta?.file_name ?? null;

      const userDb = userDbCache.get(userId);
      userDb.messages.insert({
        id: msgKey,
        gateway: 'telegram',
        session_id: userDb.sessions.get() ?? null,
        sender: 'user',
        timestamp: (ctx.message.date ?? Math.floor(Date.now() / 1000)) * 1000,
        type: messageType,
        body: text.length > 0 ? text : null,
        has_media: mediaBlocks.length > 0 ? 1 : 0,
        media_mimetype: mediaMimetype,
        media_filename: mediaFilename,
        media_size: mediaSize,
        media_path: null,
        quoted_msg_id: ctx.message.reply_to_message
          ? `${chatId}:${ctx.message.reply_to_message.message_id}`
          : null,
        is_forwarded: ctx.message.forward_origin ? 1 : 0,
        raw_json: null,
      });
    }

    if (mediaBlocks.length === 0) {
      if (text === '/start') {
        log.chat(`${chatId} → /start`);
        await bot.api.sendMessage(chatId, 'Hi! Aku asisten pribadimu. Ada yang bisa aku bantu?');
        return;
      }
      if (text === '/new') {
        log.chat(`${chatId} → /new`);
        const userDb = userDbCache.get(userId);
        const oldSessionId = userDb.sessions.get();
        if (oldSessionId) {
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
        await bot.api.sendMessage(chatId, 'Session cleared. Starting fresh.');
        return;
      }
      if (text === '/status') {
        log.chat(`${chatId} → /status`);
        const userDb = userDbCache.get(userId);
        const sessionId = userDb.sessions.get();
        const turnCount = getTurnCount(userId);
        const stats = getStats(userId);
        await bot.api.sendMessage(
          chatId,
          buildStatusReport({ userId, sessionId, turnCount, stats, userDb })
        );
        return;
      }
    }

    const quoted = extractQuoted(
      ctx.message.reply_to_message as RawReplyToMessage | undefined
    );
    const prompt = buildUserPrompt(
      text,
      quoted,
      mediaBlocks.length > 0 ? mediaBlocks : undefined
    );

    const turn = incrementTurnCount(userId);
    const mediaLog = mediaBlocks.length > 0 ? ` [+${mediaBlocks.length} media]` : '';
    log.chat(`${chatId} → ${text}${mediaLog}`);
    log.debug(
      `[TG] turn ${turn}${
        quoted ? ` (replying to ${quoted.sender}${quoted.forwarded ? '/forwarded' : ''})` : ''
      }${mediaLog}`
    );
    try {
      const result = await runQuery(userId, prompt);
      recordQuery(userDbCache.get(userId), userId, result);
      if (result.error) {
        // Non-success QueryResult — notify user, keep bot alive.
        try {
          await bot.api.sendMessage(
            chatId,
            `[${result.error.reason}] ${result.error.messages.join(' ')}`
          );
        } catch {
          // Swallow follow-on send errors; primary error already logged.
        }
      }
    } catch (err) {
      log.error(`[TG] runQuery failed for ${chatId}`, err);
    }
  });

  function buildStatusReport(opts: {
    userId: string;
    sessionId: string | undefined;
    turnCount: number;
    stats: ReturnType<typeof getStats>;
    userDb: ReturnType<typeof userDbCache.get>;
  }): string {
    const { userId: uid, sessionId, turnCount, stats, userDb } = opts;
    const lines = [
      `Session:        ${sessionId ?? 'none'}`,
      `Current turn:   ${turnCount} (this session)`,
      `Turn threshold: ${summarizeTurnThreshold}`,
    ];

    if (stats) {
      const a = stats.accumulated;
      const l = stats.lastQuery;
      const totalTokens =
        a.inputTokens + a.cacheCreationTokens + a.cacheReadTokens + a.outputTokens;
      const contextLimit = getContextLimit(stats.model);
      const lastQueryProcessed = contextUsedFromUsage({
        inputTokens: l.inputTokens,
        cacheCreationTokens: l.cacheCreationTokens,
        cacheReadTokens: l.cacheReadTokens,
      });

      const ctxPct = contextPercentage(lastQueryProcessed, contextLimit);
      lines.push(
        '',
        '── Model & context ──',
        `Model:          ${stats.model ?? 'unknown'}`,
        `Context window: ${formatTokens(contextLimit)}`,
        `Context:        ${renderBarLine(ctxPct, { color: false })}  (${formatTokens(lastQueryProcessed)} / ${formatTokens(contextLimit)})`,
        `Last query:     ${formatTokens(lastQueryProcessed)} input tokens across ${l.numTurns} sub-turns`,
        '',
        '── This session ──',
        `Actual cost:    ${formatUsd(a.costUsd)} (last: ${formatUsd(l.costUsd)})`,
        `Simulated API:  ${formatUsd(a.simulatedApiCostUsd)} (last: ${formatUsd(l.simulatedApiCostUsd)})`,
        `Tokens total:   ${totalTokens.toLocaleString()}`,
        `  input:        ${a.inputTokens.toLocaleString()}`,
        `  cache write:  ${a.cacheCreationTokens.toLocaleString()}`,
        `  cache read:   ${a.cacheReadTokens.toLocaleString()} (cached → cheap)`,
        `  output:       ${a.outputTokens.toLocaleString()}`,
        `Duration:       ${a.durationMs}ms (last: ${l.durationMs}ms)`,
        `AI sub-turns:   ${a.numTurns} (last: ${l.numTurns})`
      );
    } else {
      lines.push('', 'No queries in this session yet');
    }

    const rl = getRateLimit(uid);
    if (rl) {
      const utilPct =
        rl.utilization !== null ? rl.utilization * 100 : null;
      lines.push(
        '',
        '── Rate limit (Claude subscription) ──',
        `Window:         ${rl.rateLimitType ?? 'unknown'}`,
        `Status:         ${rl.status}`,
        utilPct !== null
          ? `Usage:          ${renderBarLine(utilPct, { color: false })}`
          : 'Usage:          —',
        `Resets:         ${formatResetsAtLocal(rl.resetsAt)} WIB (in ${formatResetsIn(rl.resetsAt)})`
      );
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const today = userDb.queryCosts.aggregateSince(now - dayMs);
    const month = userDb.queryCosts.aggregateSince(now - 30 * dayMs);
    if (today.queries > 0 || month.queries > 0) {
      lines.push(
        '',
        '── Last 24h ──',
        `Queries:        ${today.queries}`,
        `Actual cost:    ${formatUsd(today.actual_cost_usd)}`,
        `Simulated API:  ${formatUsd(today.simulated_api_cost_usd)}`,
        '',
        '── Last 30d ──',
        `Queries:        ${month.queries}`,
        `Actual cost:    ${formatUsd(month.actual_cost_usd)}`,
        `Simulated API:  ${formatUsd(month.simulated_api_cost_usd)}`
      );
    }

    return lines.join('\n');
  }

  void CORE_SYSTEM_PROMPT;

  function getActiveSessionsInternal(): ActiveSessionInfo[] {
    const result: ActiveSessionInfo[] = [];
    for (const uid of seenUsers) {
      const userDb = userDbCache.get(uid);
      const sessionId = userDb.sessions.get();
      if (!sessionId) continue;
      result.push({
        sessionId,
        userId: uid,
        cwd: cwdForUser(uid),
        messages: userDb.messages,
        sessions: userDb.sessions,
      });
    }
    return result;
  }

  let stopping = false;

  return {
    async start() {
      await scheduler.start();
      if (triggerServer) await triggerServer.start();

      log.debug(`[TG] starting bot (whitelist: ${whitelist.size} chats)`);
      void bot.start({
        onStart: (info) => log.debug(`[TG] bot @${info.username} online`),
      });
    },
    async stop() {
      if (stopping) return;
      stopping = true;
      await bot.stop();
      if (triggerServer) await triggerServer.stop();
      await scheduler.stop();

      // Summarize every active session before closing DB handles so the
      // next boot gets proper wake-up briefings.
      const active = getActiveSessionsInternal();
      if (active.length > 0) {
        log.debug(`[TG] summarizing ${active.length} active session(s) before exit`);
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
              timeoutMs: 30_000,
            })
          )
        );
      }

      userDbCache.closeAll();
      log.debug('[TG] stopped');
    },
    getActiveSessions(): ActiveSessionInfo[] {
      return getActiveSessionsInternal();
    },
  };
}
