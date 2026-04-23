// src/tools/message-history.ts

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
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
  search: (
    filter: MessageSearchFilter
  ) => Promise<MessageSearchResult[]> | MessageSearchResult[];
  getByIds: (
    ids: string[]
  ) => Promise<MessageSearchResult[]> | MessageSearchResult[];
  count: () => Promise<number> | number;
}

export interface SearchMessagesArgs {
  ids?: string[];
  from_time?: string;
  to_time?: string;
  sender?: Sender;
  query?: string;
  gateway?: string;
  has_media?: boolean;
  limit?: number;
  order?: 'newest' | 'oldest' | 'relevant';
}

export interface SearchMessagesResult {
  count: number;
  results: Array<Omit<MessageSearchResult, 'timestamp'> & { timestamp: string }>;
}

function formatResults(
  results: MessageSearchResult[]
): SearchMessagesResult['results'] {
  return results.map((r) => ({
    id: r.id,
    timestamp: toIsoJakarta(r.timestamp),
    sender: r.sender,
    body: r.body,
    has_media: r.has_media,
    gateway: r.gateway,
  }));
}

/**
 * Pure handler for search_messages. Exported for unit testing.
 * When `ids` is provided and non-empty, routes to getByIds and ignores other
 * filters. Otherwise applies the standard filter + FTS5 search path.
 */
export async function handleSearchMessages(
  handlers: MessageHandlers,
  args: SearchMessagesArgs
): Promise<SearchMessagesResult> {
  if (args.ids && args.ids.length > 0) {
    const results = await handlers.getByIds(args.ids);
    return { count: results.length, results: formatResults(results) };
  }
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
  return { count: results.length, results: formatResults(results) };
}

export function createMessageHistoryServer(handlers: MessageHandlers) {
  const searchTool = tool(
    'search_messages',
    `Search the persistent message history for the current user. Uses SQLite FTS5 (unicode61) on body. When \`ids\` is provided, looks up specific messages by id (used for <msg_ref/> resolution from session summaries). All results auto-scoped to current user.`,
    {
      ids: z.array(z.string()).optional().describe(
        'Fetch specific messages by id (used for <msg_ref id="..."/> lookups from session summaries). When provided, other filters are ignored.'
      ),
      from_time: z.string().optional().describe('ISO 8601 start of time range (inclusive)'),
      to_time: z.string().optional().describe('ISO 8601 end of time range (exclusive)'),
      sender: z.enum(['user', 'assistant', 'system']).optional().describe('Filter by who sent the message'),
      query: z
        .string()
        .optional()
        .describe(
          "FTS5 syntax: 'word' (keyword), 'a b' (implicit AND), '\"a b\"' (phrase), 'a*' (prefix), 'a OR b', 'a NOT b'."
        ),
      gateway: z.string().optional().describe("Filter by source gateway: 'telegram', 'console'"),
      has_media: z.boolean().optional().describe('Only messages with (true) or without (false) media attachments'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20, max 100)'),
      order: z
        .enum(['newest', 'oldest', 'relevant'])
        .optional()
        .describe(
          "Sort order. Default 'relevant' when query is present (BM25 ranking), else 'newest'."
        ),
    },
    async (args) => {
      try {
        const result = await handleSearchMessages(handlers, args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ success: false, error: String(err) }) },
          ],
        };
      }
    }
  );

  const countTool = tool(
    'count_messages',
    'Return the total number of messages stored for the current user.',
    {},
    async () => {
      try {
        const n = await handlers.count();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ count: n }) }],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ success: false, error: String(err) }) },
          ],
        };
      }
    }
  );

  return createSdkMcpServer({
    name: 'messages',
    version: '1.0.0',
    tools: [searchTool, countTool],
  });
}
