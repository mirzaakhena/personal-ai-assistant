// src-v4/tools/journal.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { JournalStore, JournalRow } from '../db/journal.js';
import { toIsoJakarta } from '../utils/time.js';

export interface JournalResult {
  id: string;
  content: string;
  event_date: string | null;
  source_msg_id: string | null;
  created_at: string;
}

function sanitize(r: JournalRow): JournalResult {
  return {
    id: r.id, content: r.content, event_date: r.event_date, source_msg_id: r.source_msg_id,
    created_at: toIsoJakarta(r.created_at),
  };
}

export interface JournalHandlers {
  saveJournal(entry: { content: string; event_date?: string; source_msg_id?: string }): JournalResult;
  listRecentJournal(opts: { days?: number; limit?: number }): JournalResult[];
}

export function createJournalHandlers(store: JournalStore): JournalHandlers {
  return {
    saveJournal: (entry) => sanitize(store.save(entry)),
    listRecentJournal: (opts) => store.listRecent(opts).map(sanitize),
  };
}

export function createJournalMcpServer(h: JournalHandlers) {
  return createSdkMcpServer({
    name: "journal",
    version: "1.0.0",
    tools: [
      tool(
        "save_journal",
        "Save a curated moment to the user's diary. Use for salient emotional moments, events, reflections — things worth remembering later. event_date (YYYY-MM-DD) for when the event happened if different from now.",
        {
          content: z.string().min(1),
          event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          source_msg_id: z.string().optional(),
        },
        async (entry) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.saveJournal(entry)) }],
        })
      ),
      tool(
        "list_recent_journal",
        "List recent diary entries, newest first. Default days=7, limit=20.",
        {
          days: z.number().int().positive().optional(),
          limit: z.number().int().positive().max(100).optional(),
        },
        async (opts) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.listRecentJournal(opts), null, 2) }],
        })
      ),
    ],
  });
}
