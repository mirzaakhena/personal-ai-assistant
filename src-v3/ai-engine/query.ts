// src-v3/ai-engine/query.ts

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { createQueryOptions } from "./options.js";
import type { ContentBlock } from "../utils/media.js";
import type {
  AIEngine,
  EngineConfig,
  QueryOptions,
  QueryResult,
  QueryErrorInfo,
  InitInfo,
  RateLimitInfo,
} from "./types.js";

const DEFAULT_SYSTEM_PROMPT = `You are a personal AI assistant.

RESPONSE RULE:
You must ALWAYS respond using the \`send_message\` tool. Never reply with plain text directly — every response must go through \`send_message\`.
EXCEPTION: If a [SYSTEM MESSAGE] is no longer relevant based on recent conversation (e.g. user already addressed the topic), you MAY skip send_message.

INPUT TYPES:
1. [USER MESSAGE] — Real-time message from user. Respond conversationally via send_message.
   May include [REPLYING TO] block if user replied to a specific earlier message:
   - "From: assistant" means the quoted message was YOUR previous response.
   - "From: user" means the quoted message was user's own earlier message.
   - "(forwarded)" indicates the original message was forwarded from someone/somewhere else.
   - The Timestamp inside [REPLYING TO] is when THAT earlier message was sent (NOT current time).
   Use the reply context to understand what exactly the user is responding to.
2. [SYSTEM MESSAGE] — Automated trigger from scheduler/reminder system. Proactively reach out via send_message as if on your own initiative. Never mention the underlying system. Match tone to last conversation context. If the user already addressed the topic, adapt your message accordingly — do not repeat information the user already knows, and skip send_message if no longer relevant.

MESSAGE HISTORY:
You have \`search_messages\` tool to search the complete message history for the current user — including past user messages, your own previous responses, and system-triggered messages. Use it to:
- Recall what was discussed in earlier sessions beyond your current context.
- Find specific information the user shared before.
- Review past system/cron messages and their outcomes.
Filters available: from_time, to_time (ISO 8601), sender (user/assistant/system), query (keyword), gateway, has_media, limit, order.
Message history is automatically scoped to the current user — you cannot see other users' messages.

TIMEZONE:
All times are in WIB (Asia/Jakarta, UTC+7). Timestamp in each message = current time.
- scheduled_at: ISO 8601 with +07:00 offset (e.g. "2026-04-15T09:00:00+07:00"). NEVER use UTC (Z suffix).
- schedule_cron: Write in WIB (e.g. "0 9 * * *" = 9am WIB).

Keep responses concise.`;

/**
 * Create an AI engine instance with the given configuration.
 *
 * Engine-level config sets defaults. Per-query options can override
 * model, systemPrompt, and maxTurns. The onSendMessage handler is
 * set once at engine creation and shared across all queries.
 */
export function createAIEngine(config?: EngineConfig): AIEngine {
  const defaults = {
    model: config?.model ?? 'haiku', // TODO: read from env (CLAUDE_MODEL)
    systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    maxTurns: config?.maxTurns ?? 10,
    effort: config?.effort ?? 'low',
    mcpServers: config?.mcpServers ?? {},
  };

  return {
    async query(prompt: string | ContentBlock[], options?: QueryOptions): Promise<QueryResult> {
      const resolved = {
        model: options?.model ?? defaults.model,
        systemPrompt: options?.systemPrompt ?? defaults.systemPrompt,
        maxTurns: options?.maxTurns ?? defaults.maxTurns,
        effort: options?.effort ?? defaults.effort,
        sessionId: options?.sessionId,
        mcpServers: { ...defaults.mcpServers, ...options?.mcpServers },
      };

      const sdkOptions = createQueryOptions(resolved);

      const sdkPrompt: string | AsyncIterable<SDKUserMessage> = typeof prompt === 'string'
        ? prompt
        : (async function* (): AsyncGenerator<SDKUserMessage> {
            yield {
              type: 'user' as const,
              message: { role: 'user' as const, content: prompt as any },
              parent_tool_use_id: null,
              session_id: resolved.sessionId ?? '',
            };
          })();

      const responses = sdkQuery({ prompt: sdkPrompt, options: sdkOptions });
      const callbacks = options?.callbacks;

      let responseText = '';
      let resultSessionId = '';
      let costUsd = 0;
      let durationMs = 0;
      let numTurns = 0;
      let error: QueryErrorInfo | undefined;
      let sendMessageCalled = false;

      for await (const message of responses) {
        switch (message.type) {
          case 'system': {
            if (message.subtype === 'init') {
              const initMsg = message as any;
              const info: InitInfo = {
                model: initMsg.model ?? '',
                cwd: initMsg.cwd ?? '',
                tools: Array.isArray(initMsg.tools)
                  ? initMsg.tools
                  : Object.keys(initMsg.tools ?? {}),
                mcpServers: initMsg.mcp_servers ?? [],
                sessionId: message.session_id,
              };
              resultSessionId = message.session_id;
              callbacks?.onInit?.(info);
              callbacks?.onSessionId?.(message.session_id);
            }
            break;
          }

          case 'assistant': {
            // Check for assistant-level errors (auth, billing, rate limit, etc.)
            if (message.error) {
              error = {
                level: 'assistant',
                reason: message.error,
                messages: [`Assistant error: ${message.error}`],
              };
              callbacks?.onError?.(error);
            }

            const contentBlocks = message.message.content as any[];

            // Handle thinking blocks
            for (const block of contentBlocks) {
              if (block.type === 'thinking' && block.thinking) {
                callbacks?.onThinking?.(block.thinking);
              }
            }

            // Extract text blocks
            const textBlocks = contentBlocks.filter(
              (block) => block.type === 'text'
            ) as { type: 'text'; text: string }[];
            const text = textBlocks.map((b) => b.text).join('');
            if (text) {
              responseText += text;
              callbacks?.onMessage?.(text);
            }

            // Track tool use blocks
            const toolUseBlocks = contentBlocks.filter(
              (block) => block.type === 'tool_use'
            ) as { type: 'tool_use'; name: string }[];
            for (const toolBlock of toolUseBlocks) {
              if (toolBlock.name.endsWith('send_message')) {
                sendMessageCalled = true;
              }
              callbacks?.onToolUse?.(toolBlock.name);
            }
            break;
          }

          case 'rate_limit_event': {
            const rlMsg = message as any;
            const info: RateLimitInfo = {
              resetsAt: rlMsg.rate_limit?.resets_at ?? '',
              remaining: rlMsg.rate_limit?.remaining ?? 0,
            };
            callbacks?.onRateLimit?.(info);
            break;
          }

          case 'result': {
            const resultMsg = message as any;
            costUsd = resultMsg.total_cost_usd ?? 0;
            durationMs = resultMsg.duration_ms ?? 0;
            numTurns = resultMsg.num_turns ?? 0;
            resultSessionId = resultMsg.session_id ?? resultSessionId;

            if (message.subtype !== 'success') {
              error = {
                level: 'result',
                reason: message.subtype as QueryErrorInfo['reason'],
                messages: resultMsg.errors ?? [`Query ended with: ${message.subtype}`],
              };
              callbacks?.onError?.(error);
            }
            break;
          }
        }
      }

      // Fallback detection: send_message was never called
      if (!sendMessageCalled) {
        callbacks?.onFallback?.(responseText);
      }

      return {
        sessionId: resultSessionId,
        responseText,
        costUsd,
        durationMs,
        numTurns,
        sendMessageCalled,
        ...(error ? { error } : {}),
      };
    },
  };
}
