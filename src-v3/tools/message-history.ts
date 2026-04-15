// src-v3/tools/message-history.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { toIsoJakarta, parseIsoToMs } from '../utils/time.js';

export type Sender = 'user' | 'assistant' | 'system';

export interface MessageSearchFilter {
  fromTime?: number;
  toTime?: number;
  sender?: Sender;
  query?: string;
  gateway?: string;
  hasMedia?: boolean;
  limit?: number;
  order?: 'newest' | 'oldest' | 'relevant';
}

export interface MessageSearchResult {
  id: string;
  timestamp: number;
  sender: Sender;
  body: string | null;
  has_media: boolean;
  gateway: string;
}

/** Abstract handlers — consumer provides scoped (per-userId) implementation */
export interface MessageHandlers {
  search: (filter: MessageSearchFilter) => Promise<MessageSearchResult[]> | MessageSearchResult[];
  count: () => Promise<number> | number;
}

/**
 * Create a standalone MCP server for message history search.
 */
export function createMessageHistoryServer(handlers: MessageHandlers) {
  const searchTool = tool(
    "search_messages",
    `Search the persistent message history for the current user.

Messages include: user messages, your (assistant) responses, and system-triggered messages (cron, external triggers).

Use this to:
- Recall what was discussed in earlier sessions beyond the current context.
- Find specific information the user shared before.
- Check past system messages (reminders, triggers) and their outcomes.

All results are automatically scoped to the current user — you cannot see other users' messages.
Timestamps in args use ISO 8601 format; timestamps in results are ISO 8601 with +07:00 (WIB) offset.`,
    {
      from_time: z.string().optional().describe("ISO 8601 start of time range (inclusive)"),
      to_time: z.string().optional().describe("ISO 8601 end of time range (exclusive)"),
      sender: z.enum(['user', 'assistant', 'system']).optional().describe("Filter by who sent the message"),
      query: z.string().optional().describe(
        "Search text. Uses SQLite FTS5 (unicode61, case-insensitive). Syntax: " +
        "'koper' (simple keyword), 'koper pilox' (implicit AND), '\"koper pilox\"' (exact phrase), " +
        "'koper*' (prefix match), 'koper OR ransel' (boolean), 'koper NOT hitam' (exclude)."
      ),
      gateway: z.string().optional().describe("Filter by source gateway: 'telegram', 'whatsapp', 'console'"),
      has_media: z.boolean().optional().describe("Only messages with (true) or without (false) media attachments"),
      limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20, max 100)"),
      order: z.enum(['newest', 'oldest', 'relevant']).optional().describe(
        "Sort order. Default 'relevant' when query is present (BM25 ranking), else 'newest'."
      ),
    },
    async (args) => {
      try {
        const filter: MessageSearchFilter = {
          fromTime: args.from_time ? parseIsoToMs(args.from_time) : undefined,
          toTime: args.to_time ? parseIsoToMs(args.to_time) : undefined,
          sender: args.sender,
          query: args.query,
          gateway: args.gateway,
          hasMedia: args.has_media,
          limit: args.limit,
          order: args.order,
        };
        const results = await handlers.search(filter);
        const formatted = results.map((r) => ({
          id: r.id,
          timestamp: toIsoJakarta(r.timestamp),
          sender: r.sender,
          body: r.body,
          has_media: r.has_media,
          gateway: r.gateway,
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ count: formatted.length, results: formatted }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  const countTool = tool(
    "count_messages",
    "Return the total number of messages stored in the message history for the current user.",
    {},
    async () => {
      try {
        const n = await handlers.count();
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ count: n }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  return createSdkMcpServer({
    name: "messages",
    version: "1.0.0",
    tools: [searchTool, countTool],
  });
}
