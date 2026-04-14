// src-v3/gateway/telegram.ts

import { Bot } from 'grammy';
import type { Gateway } from './types.js';
import { createAIEngine } from '../ai-engine/index.js';
import type { QueryResult, ContentBlock } from '../ai-engine/index.js';
import { createMessageServer, type MessageDeliver } from '../tools/message.js';
import { createMemoryServer, type MemoryHandlers } from '../tools/memory.js';
import { createCronjobServer, type CronjobHandlers } from '../tools/cronjob.js';
import { createSessionStore } from '../db/sessions.js';
import { createCronScheduler } from '../cron/scheduler.js';
import { createTriggerServer } from '../trigger/server.js';
import type { TriggerServer } from '../trigger/types.js';
import { log } from '../utils/logger.js';
import { buildUserPrompt, buildSystemMessagePrompt, type QuotedInfo } from '../utils/prompt.js';
import { incrementTurnCount, getTurnCount, clearTurnCount } from '../utils/turns.js';
import { updateStats, getStats, clearStats } from '../utils/stats.js';
import { enqueue } from '../utils/queue.js';

/** Factory that returns handlers scoped to a specific userId */
export type MemoryHandlersFactory = (userId: string) => MemoryHandlers;

const TYPING_MS_PER_CHAR = 30;
const MIN_TYPING_DURATION_MS = 1000;
const MAX_TYPING_DURATION_MS = 8000;
// Telegram's typing indicator auto-expires after ~5s; refresh before that
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

function extractQuoted(reply: RawReplyToMessage | undefined): QuotedInfo | undefined {
  if (!reply) return undefined;
  if (typeof reply.text !== 'string') return undefined;  // only text quotes supported
  return {
    content: reply.text,
    sender: reply.from?.is_bot ? 'assistant' : 'user',
    at: typeof reply.date === 'number' ? new Date(reply.date * 1000) : undefined,
    forwarded: Boolean(reply.forward_origin),
  };
}

export interface TelegramGatewayConfig {
  /** Bot token from BotFather (required) */
  token: string;
  /** Allowed Telegram chat IDs (numeric). Empty array = no one allowed. */
  whitelist: number[];
  /** Session DB path, default 'data/sessions.db' */
  sessionDbPath?: string;
  /** Cronjob DB path, default 'data/cronjobs.db' */
  cronDbPath?: string;
  /** AI model, default 'haiku' */
  model?: string;
  /** Memory handlers factory, default in-memory Map keyed by userId */
  memoryHandlers?: MemoryHandlersFactory;
  /** Trigger server host. Default '127.0.0.1'. Set to null to disable. */
  triggerHost?: string | null;
  /** Trigger server port. Default 3100. */
  triggerPort?: number;
}

/** Default in-memory memory backend — shared Map, keyed by `${userId}:${key}` */
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

export function createTelegramGateway(config: TelegramGatewayConfig): Gateway {
  if (!config.token) {
    throw new Error('Telegram bot token is required');
  }

  const model = config.model ?? 'haiku';
  const memoryHandlersFactory = config.memoryHandlers ?? defaultMemoryHandlersFactory();
  const whitelist = new Set(config.whitelist);

  const sessions = createSessionStore(config.sessionDbPath);

  const engine = createAIEngine({ model });

  const bot = new Bot(config.token);

  // Internal delivery — how this gateway sends messages to the user
  const deliver: MessageDeliver = async (userId, content, options) => {
    const chatId = Number(userId);
    const pause = options?.pauseBeforeTyping ?? 0;

    if (pause > 0) {
      await sleep(pause);
    }

    // Keep typing indicator alive for the full duration.
    // Telegram auto-expires typing after ~5s, so we refresh every 4s.
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
      await bot.api.sendMessage(chatId, content);
      log.chat(`${chatId} ← ${content.slice(0, 80)}`);
    } catch (err) {
      log.error(`[TG] sendMessage failed for ${chatId}`, err);
      throw err;
    }
  };

  // Cronjob handlers factory — delegates to scheduler (defined below)
  const cronjobHandlersFactory = (userId: string): CronjobHandlers => ({
    create: (job) => scheduler.schedule(userId, job),
    list: () => scheduler.list(userId),
    delete: (jobId) => scheduler.delete(userId, jobId),
    update: (jobId, patch) => scheduler.update(userId, jobId, patch),
  });

  /** Shared query execution — used by message handler, cron fire, and trigger */
  async function runQuery(queryUserId: string, prompt: string | ContentBlock[]): Promise<QueryResult> {
    const sessionId = sessions.get(queryUserId);

    const result = await engine.query(prompt, {
      sessionId,
      mcpServers: {
        message: createMessageServer(deliver, queryUserId),
        memory: createMemoryServer(memoryHandlersFactory(queryUserId)),
        cronjob: createCronjobServer(cronjobHandlersFactory(queryUserId)),
      },
      callbacks: {
        onInit: (info) => log.debug(`[TG] model=${info.model} tools=${info.tools.length}`),
        onThinking: (text) => log.debug(`[TG] thinking: ${text.slice(0, 80)}...`),
        onToolUse: (name) => log.debug(`[TG] tool: ${name}`),
        onSessionId: (id) => log.debug(`[TG] session: ${id}`),
        onError: (err) => log.error(`[TG] [${err.level}] ${err.reason}: ${err.messages.join(', ')}`),
        onFallback: (_text) => {
          log.debug('[TG] send_message not called (possibly not relevant)');
        },
      },
    });

    sessions.save(queryUserId, result.sessionId);
    return result;
  }

  // Cron scheduler — fires wrapped in queue to serialize per-user
  const scheduler = createCronScheduler({
    cronDbPath: config.cronDbPath,
    onFire: (job) => new Promise<void>((resolve, reject) => {
      enqueue(job.userId, async () => {
        try {
          log.debug(`[TG] cron:${job.id} firing — ${job.scheduleHuman}`);
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

  // Trigger server — optional, disabled if triggerHost === null
  const triggerServer: TriggerServer | null = config.triggerHost === null
    ? null
    : createTriggerServer({
        host: config.triggerHost ?? '127.0.0.1',
        port: config.triggerPort ?? 3100,
        onTrigger: ({ userId, message }) => new Promise<void>((resolve, reject) => {
          enqueue(userId, async () => {
            try {
              log.debug(`[TG] trigger:${userId} — ${message.slice(0, 60)}`);
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

  // Message handler — wire before bot.start()
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id;
    if (!whitelist.has(chatId)) {
      log.debug(`[TG] blocked chat: ${chatId}`);
      return;
    }

    // Dedup guard
    const msgKey = `${chatId}:${ctx.message.message_id}`;
    if (isDuplicateIncoming(msgKey)) {
      log.debug(`[TG] dedup: skipping duplicate incoming ${msgKey}`);
      return;
    }

    const text = ctx.message.text.trim();
    if (!text) return;

    const userId = String(chatId);

    // Commands
    if (text === '/start') {
      await bot.api.sendMessage(chatId, 'Hi! Aku asisten pribadimu. Ada yang bisa aku bantu?');
      return;
    }
    if (text === '/new') {
      sessions.delete(userId);
      clearTurnCount(userId);
      clearStats(userId);
      await bot.api.sendMessage(chatId, 'Session cleared. Starting fresh.');
      return;
    }
    if (text === '/status') {
      const sessionId = sessions.get(userId);
      const turnCount = getTurnCount(userId);
      const stats = getStats(userId);
      const lines = [
        `Session: ${sessionId ?? 'none'}`,
        `Turns: ${turnCount}`,
      ];
      if (stats) {
        lines.push(
          `Cost: $${stats.accumulated.costUsd.toFixed(4)} (last: $${stats.lastQuery.costUsd.toFixed(4)})`,
          `Duration: ${stats.accumulated.durationMs}ms (last: ${stats.lastQuery.durationMs}ms)`,
          `AI Turns: ${stats.accumulated.numTurns} (last: ${stats.lastQuery.numTurns})`,
        );
      } else {
        lines.push('Stats: no queries yet');
      }
      await bot.api.sendMessage(chatId, lines.join('\n'));
      return;
    }

    // Regular message → engine, with quoted context if user replied to something
    const quoted = extractQuoted(ctx.message.reply_to_message as RawReplyToMessage | undefined);
    const turn = incrementTurnCount(userId);
    log.chat(`${chatId} → ${text.slice(0, 80)}`);
    log.debug(`[TG] turn ${turn}${quoted ? ` (replying to ${quoted.sender}${quoted.forwarded ? '/forwarded' : ''})` : ''}`);
    try {
      const result = await runQuery(userId, buildUserPrompt(text, quoted));
      updateStats(userId, result.sessionId, result.costUsd, result.durationMs, result.numTurns);
    } catch (err) {
      log.error(`[TG] runQuery failed for ${chatId}`, err);
    }
  });

  return {
    async start() {
      await scheduler.start();
      if (triggerServer) await triggerServer.start();

      log.debug(`[TG] starting bot (whitelist: ${whitelist.size} chats)`);
      // bot.start() polls forever — launch async, don't await
      void bot.start({
        onStart: (info) => log.debug(`[TG] bot @${info.username} online`),
      });
    },
    async stop() {
      await bot.stop();
      if (triggerServer) await triggerServer.stop();
      await scheduler.stop();
      log.debug('[TG] stopped');
    },
  };
}
