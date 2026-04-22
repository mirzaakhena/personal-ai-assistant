// src-v4/tools/profile.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ProfileStore, ProfileKey } from '../db/profile.js';
import { PROFILE_KEYS } from '../db/profile.js';

export interface ProfileHandlers {
  getProfile(): Partial<Record<ProfileKey, string>>;
  setProfile(entries: Array<{ key: ProfileKey; value: string; source_msg_id?: string }>): {
    updated: ProfileKey[];
  };
}

export function createProfileHandlers(store: ProfileStore): ProfileHandlers {
  return {
    getProfile: () => store.getAll(),
    setProfile: (entries) => {
      store.setMany(entries);
      return { updated: entries.map(e => e.key) };
    },
  };
}

export function createProfileMcpServer(handlers: ProfileHandlers) {
  return createSdkMcpServer({
    name: "profile",
    version: "1.0.0",
    tools: [
      tool(
        "get_profile",
        "Return the full profile object (name, called_as, language, timezone, home_location, current_location, active_hours). Missing slots are absent.",
        {},
        async () => ({
          content: [{ type: "text" as const, text: JSON.stringify(handlers.getProfile(), null, 2) }],
        })
      ),
      tool(
        "set_profile",
        "Upsert one or more profile slots. Accepts an array for batch updates.",
        {
          entries: z.array(z.object({
            key: z.enum(PROFILE_KEYS),
            value: z.string().min(1),
            source_msg_id: z.string().optional(),
          })).min(1),
        },
        async ({ entries }) => {
          const res = handlers.setProfile(entries);
          return { content: [{ type: "text" as const, text: JSON.stringify(res) }] };
        }
      ),
    ],
  });
}
