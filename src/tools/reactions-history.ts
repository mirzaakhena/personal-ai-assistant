// src/tools/reactions-history.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ReactionRecord } from "../db/reactions.js";

export interface ReactionHandlers {
  listRecent(limit: number): ReactionRecord[];
  listByMessageId(messageId: string): ReactionRecord[];
}

interface SerializedReaction {
  id: number;
  message_id: string;
  actor: 'user' | 'assistant';
  old_emojis: string[];
  new_emojis: string[];
  timestamp: number;
  timestamp_iso: string;
}

function serialize(r: ReactionRecord): SerializedReaction {
  return {
    id: r.id,
    message_id: r.message_id,
    actor: r.actor,
    old_emojis: r.old_emojis,
    new_emojis: r.new_emojis,
    timestamp: r.timestamp,
    timestamp_iso: new Date(r.timestamp).toISOString(),
  };
}

export function createReactionsHistoryServer(handlers: ReactionHandlers) {
  const listTool = tool(
    "list_reactions",
    `List reaction events recorded for this chat.

Returns a chronological log of emoji reactions placed on messages — both reactions the user added on assistant messages and reactions the assistant added on user messages.

Pass message_id to filter to one specific message; otherwise returns the most recent N events.`,
    {
      message_id: z
        .string()
        .optional()
        .describe("Filter to reactions on this specific message_id (full id, e.g., 'chatId:msgId'). When omitted, returns the most recent reactions across all messages."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of recent reactions to return when message_id is omitted. Defaults to 20."),
    },
    async (args) => {
      const records = args.message_id
        ? handlers.listByMessageId(args.message_id)
        : handlers.listRecent(args.limit ?? 20);
      const payload = records.map(serialize);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ reactions: payload }) },
        ],
      };
    }
  );

  return createSdkMcpServer({
    name: "reactions-history",
    version: "1.0.0",
    tools: [listTool],
  });
}
