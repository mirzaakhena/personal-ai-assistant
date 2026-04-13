// src-v3/ai-engine/query.ts

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { createQueryOptions } from "./options.js";
import type {
  AIEngine,
  EngineConfig,
  QueryOptions,
  QueryCallbacks,
  QueryResult,
  InitInfo,
  RateLimitInfo,
} from "./types.js";

const DEFAULT_SYSTEM_PROMPT = `You are a personal AI assistant.

RESPONSE RULE:
You must ALWAYS respond using the \`send_message\` tool. Never reply with plain text directly — every response must go through \`send_message\`.

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
    maxTurns: config?.maxTurns ?? 3,
    onSendMessage: config?.onSendMessage,
  };

  return {
    async query(prompt: string, options?: QueryOptions): Promise<QueryResult> {
      const resolved = {
        model: options?.model ?? defaults.model,
        systemPrompt: options?.systemPrompt ?? defaults.systemPrompt,
        maxTurns: options?.maxTurns ?? defaults.maxTurns,
        sessionId: options?.sessionId,
        onSendMessage: defaults.onSendMessage,
      };

      const sdkOptions = createQueryOptions(resolved);
      const responses = sdkQuery({ prompt, options: sdkOptions });
      const callbacks = options?.callbacks;

      let responseText = '';
      let resultSessionId = '';
      let costUsd = 0;
      let durationMs = 0;
      let numTurns = 0;

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
            if (message.subtype === 'success') {
              costUsd = message.total_cost_usd;
              durationMs = message.duration_ms;
              numTurns = message.num_turns;
              resultSessionId = message.session_id;
            }
            break;
          }
        }
      }

      return {
        sessionId: resultSessionId,
        responseText,
        costUsd,
        durationMs,
        numTurns,
      };
    },
  };
}
