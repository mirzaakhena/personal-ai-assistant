// src-v3/ai-engine/query.ts

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { createQueryOptions } from "./options.js";
import { DEFAULT_SYSTEM_PROMPT } from "../utils/system-prompt.js";
import { requireModel } from "../utils/model-config.js";
import type { ContentBlock } from "../utils/media.js";
import type {
  AIEngine,
  EngineConfig,
  QueryOptions,
  QueryResult,
  QueryErrorInfo,
  InitInfo,
  RateLimitInfo,
  TokenUsage,
} from "./types.js";

/**
 * Create an AI engine instance with the given configuration.
 *
 * Engine-level config sets defaults. Per-query options can override
 * model, systemPrompt, and maxTurns. The onSendMessage handler is
 * set once at engine creation and shared across all queries.
 */
export function createAIEngine(config?: EngineConfig): AIEngine {
  const defaults = {
    model: requireModel(config?.model),
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
      let model: string | null = null;
      let usage: TokenUsage | null = null;
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
              model = initMsg.model ?? null;
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
            const rl = rlMsg.rate_limit_info ?? {};
            const info: RateLimitInfo = {
              status: rl.status ?? 'unknown',
              resetsAt: typeof rl.resetsAt === 'number' ? rl.resetsAt : null,
              rateLimitType: rl.rateLimitType ?? null,
              utilization: typeof rl.utilization === 'number' ? rl.utilization : null,
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

            // Usage breakdown — SDK returns snake_case keys inside usage object
            const u = resultMsg.usage;
            if (u && typeof u === 'object') {
              usage = {
                inputTokens: u.input_tokens ?? 0,
                cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
                cacheReadTokens: u.cache_read_input_tokens ?? 0,
                outputTokens: u.output_tokens ?? 0,
              };
            }

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
        model,
        usage,
        sendMessageCalled,
        ...(error ? { error } : {}),
      };
    },
  };
}
