// src/tools/preferences.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { PreferenceStore, PreferenceKind, PreferenceRow } from '../db/preferences.js';
import { PREFERENCE_KINDS } from '../db/preferences.js';
import { toIsoJakarta } from '../utils/time.js';

export interface PreferenceResult {
  kind: PreferenceKind;
  key: string;
  value: string;
  source_msg_id: string | null;
  created_at: string;
  updated_at: string;
}

function sanitize(r: PreferenceRow): PreferenceResult {
  return {
    kind: r.kind, key: r.key, value: r.value,
    source_msg_id: r.source_msg_id,
    created_at: toIsoJakarta(r.created_at),
    updated_at: toIsoJakarta(r.updated_at),
  };
}

export interface PreferenceHandlers {
  savePreference(entries: Array<{ kind: PreferenceKind; key: string; value: string; source_msg_id?: string }>): { saved: number };
  listPreferences(filter?: { kind?: PreferenceKind }): PreferenceResult[];
  deletePreference(id: { kind: PreferenceKind; key: string }): { deleted: boolean };
}

export function createPreferenceHandlers(store: PreferenceStore): PreferenceHandlers {
  return {
    savePreference: (entries) => { store.saveMany(entries); return { saved: entries.length }; },
    listPreferences: (filter) => store.list(filter).map(sanitize),
    deletePreference: (id) => ({ deleted: store.delete(id) }),
  };
}

export function createPreferenceMcpServer(h: PreferenceHandlers) {
  return createSdkMcpServer({
    name: "preferences",
    version: "1.0.0",
    tools: [
      tool(
        "save_preference",
        "Upsert one or more preferences. kind='rule' for binding constraints, 'style' for how to talk/interact. Array input.",
        {
          entries: z.array(z.object({
            kind: z.enum(PREFERENCE_KINDS),
            key: z.string().min(1),
            value: z.string().min(1),
            source_msg_id: z.string().optional(),
          })).min(1),
        },
        async ({ entries }) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.savePreference(entries)) }],
        })
      ),
      tool(
        "list_preferences",
        "List all preferences, optionally filtered by kind.",
        {
          kind: z.enum(PREFERENCE_KINDS).optional(),
        },
        async ({ kind }) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.listPreferences({ kind }), null, 2) }],
        })
      ),
      tool(
        "delete_preference",
        "Hard-delete a preference by (kind, key).",
        {
          kind: z.enum(PREFERENCE_KINDS),
          key: z.string().min(1),
        },
        async ({ kind, key }) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.deletePreference({ kind, key })) }],
        })
      ),
    ],
  });
}
