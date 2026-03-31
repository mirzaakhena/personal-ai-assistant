import { type Options } from "@anthropic-ai/claude-agent-sdk";
import { createToolServer } from "../tools/server.js";
import type { MessageContext } from "../tools/message.js";
import type { CronContext } from "../tools/cronjob.js";
import type { MemoryContext } from "../tools/memory.js";
import { getFundamentalMemories } from "../memory/operations.js";
import { formatFundamentalMemory } from "../memory/formatter.js";
import { log } from "../utils/logger.js";
import { DEFAULT_MODEL, MAX_TURNS } from "./constants.js";
import { buildBaseSystemPrompt, MEMORY_FLUSH_REMINDER } from "./system-prompt.js";

export async function buildSystemPrompt(phoneNumber: string): Promise<string> {
  const basePrompt = buildBaseSystemPrompt();
  try {
    const memories = await getFundamentalMemories(phoneNumber);
    const memoryBlock = formatFundamentalMemory(memories);
    return `${basePrompt}\n\n${memoryBlock}`;
  } catch (err) {
    log.error('Failed to load fundamental memories', err);
    return basePrompt;
  }
}

type EffortLevel = 'low' | 'medium' | 'high';

export async function createQueryOptions(
  sessionId: string | undefined,
  ctx: MessageContext,
  cronCtx: CronContext,
  memCtx: MemoryContext,
  { injectFlushReminder = false, effort = 'high' as EffortLevel } = {}
): Promise<Options> {
  let systemPrompt = await buildSystemPrompt(memCtx.phoneNumber);
  if (injectFlushReminder) {
    systemPrompt += MEMORY_FLUSH_REMINDER;
  }

  const options: Options = {
    model: DEFAULT_MODEL,
    maxTurns: MAX_TURNS,
    effort,
    permissionMode: 'bypassPermissions' as const,
    allowDangerouslySkipPermissions: true,
    systemPrompt,
    cwd: process.env.CLAUDE_CWD ?? '/home/botuser/personal-ai-assistant',
    settingSources: ['user', 'project'],
    allowedTools: ['Skill'],
    mcpServers: {
      "tools": createToolServer(ctx, cronCtx, memCtx),
    },
  };

  if (sessionId) {
    log.debug(`session: ${sessionId}`);
    options.resume = sessionId;
  } else {
    log.debug('new session');
  }

  return options;
}
