// src-v3/ai-engine/query.ts

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createQueryOptions } from "./options.js";
import type { QueryCallbacks, QueryResult } from "./types.js";

/**
 * Execute a query against the Claude AI engine.
 *
 * Wraps the SDK query() call, iterates async responses,
 * invokes callbacks on relevant events, and returns a structured result.
 *
 * @param prompt - The user prompt to send
 * @param callbacks - Optional callbacks for reacting to events
 * @param sessionId - Optional session ID to resume a conversation
 */
export async function executeQuery(
  prompt: string,
  callbacks?: QueryCallbacks,
  sessionId?: string,
): Promise<QueryResult> {
  const options = createQueryOptions(sessionId);
  const responses = query({ prompt, options });

  let responseText = '';
  let resultSessionId = '';
  let costUsd = 0;
  let durationMs = 0;
  let numTurns = 0;

  for await (const message of responses) {
    switch (message.type) {
      case 'assistant': {
        // Extract text blocks from the assistant message
        const textBlocks = (message.message.content as any[]).filter(
          (block) => block.type === 'text'
        ) as { type: 'text'; text: string }[];
        const text = textBlocks.map((b) => b.text).join('');
        if (text) {
          responseText += text;
          callbacks?.onMessage?.(text);
        }

        // Capture session ID from the first assistant message
        if (!resultSessionId && message.session_id) {
          resultSessionId = message.session_id;
          callbacks?.onSessionId?.(message.session_id);
        }

        // Track tool use blocks
        const toolUseBlocks = (message.message.content as any[]).filter(
          (block) => block.type === 'tool_use'
        ) as { type: 'tool_use'; name: string }[];
        for (const toolBlock of toolUseBlocks) {
          callbacks?.onToolUse?.(toolBlock.name);
        }
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
}
