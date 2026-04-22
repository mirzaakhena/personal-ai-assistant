// src-v4/tools/knowledge.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { KnowledgeStore, KnowledgeCategory, KnowledgeRow } from '../db/knowledge.js';
import { KNOWLEDGE_CATEGORIES } from '../db/knowledge.js';
import { toIsoJakarta } from '../utils/time.js';

export interface KnowledgeResult {
  category: KnowledgeCategory;
  key: string;
  value: string;
  source_msg_id: string | null;
  created_at: string;
  updated_at: string;
}

function sanitize(r: KnowledgeRow): KnowledgeResult {
  return {
    category: r.category, key: r.key, value: r.value,
    source_msg_id: r.source_msg_id,
    created_at: toIsoJakarta(r.created_at),
    updated_at: toIsoJakarta(r.updated_at),
  };
}

export interface KnowledgeHandlers {
  saveKnowledge(entries: Array<{ category: KnowledgeCategory; key: string; value: string; source_msg_id?: string }>): { saved: number };
  listKnowledge(filter?: { category?: KnowledgeCategory }): KnowledgeResult[];
  searchKnowledge(query: string, filter?: { category?: KnowledgeCategory }): KnowledgeResult[];
  deleteKnowledge(id: { category: KnowledgeCategory; key: string }): { deleted: boolean };
}

export function createKnowledgeHandlers(store: KnowledgeStore): KnowledgeHandlers {
  return {
    saveKnowledge: (entries) => { store.saveMany(entries); return { saved: entries.length }; },
    listKnowledge: (filter) => store.list(filter).map(sanitize),
    searchKnowledge: (query, filter) => store.search(query, filter).map(sanitize),
    deleteKnowledge: (id) => ({ deleted: store.delete(id) }),
  };
}

export function createKnowledgeMcpServer(h: KnowledgeHandlers) {
  return createSdkMcpServer({
    name: "knowledge",
    version: "1.0.0",
    tools: [
      tool(
        "save_knowledge",
        "Upsert one or more knowledge entries. Use category: 'identity' for self-facts not in profile; 'person' for other people; 'routine' for recurring behavior; 'context' for situational/procedural facts; 'insight' for cognitive patterns and worldview. Array input supports batching multiple related facts in one call.",
        {
          entries: z.array(z.object({
            category: z.enum(KNOWLEDGE_CATEGORIES),
            key: z.string().min(1),
            value: z.string().min(1),
            source_msg_id: z.string().optional(),
          })).min(1),
        },
        async ({ entries }) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.saveKnowledge(entries)) }],
        })
      ),
      tool(
        "list_knowledge",
        "List knowledge entries, optionally filtered by category.",
        {
          category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
        },
        async ({ category }) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.listKnowledge({ category }), null, 2) }],
        })
      ),
      tool(
        "search_knowledge",
        "Full-text search knowledge entries by value content. Optionally scope to a category.",
        {
          query: z.string().min(1),
          category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
        },
        async ({ query, category }) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.searchKnowledge(query, { category }), null, 2) }],
        })
      ),
      tool(
        "delete_knowledge",
        "Hard-delete a knowledge entry by (category, key).",
        {
          category: z.enum(KNOWLEDGE_CATEGORIES),
          key: z.string().min(1),
        },
        async ({ category, key }) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.deleteKnowledge({ category, key })) }],
        })
      ),
    ],
  });
}
