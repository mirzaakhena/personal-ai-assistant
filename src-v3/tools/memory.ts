// src-v3/tools/memory.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/** Abstract handlers for memory operations. Consumer provides the storage backend. */
export interface MemoryHandlers {
  save: (key: string, value: string) => Promise<void> | void;
  recall: (key: string) => Promise<string | null> | string | null;
}

/**
 * Create a standalone MCP server for memory tools.
 * Minimal key-value interface — consumer decides storage backend.
 */
export function createMemoryServer(handlers: MemoryHandlers) {
  const saveMemoryTool = tool(
    "save_memory",
    `Save a piece of information to memory. Use a descriptive key so it can be recalled later.
Examples:
  save_memory({ key: "user_name", value: "Mirza" })
  save_memory({ key: "favorite_food", value: "Nasi goreng" })`,
    {
      key: z.string().min(1).describe("Unique key to identify this memory"),
      value: z.string().min(1).describe("The information to remember"),
    },
    async (args) => {
      try {
        await handlers.save(args.key, args.value);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true, key: args.key }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  const recallMemoryTool = tool(
    "recall_memory",
    `Recall a previously saved memory by its key.
Examples:
  recall_memory({ key: "user_name" }) → { found: true, value: "Mirza" }
  recall_memory({ key: "unknown" }) → { found: false }`,
    {
      key: z.string().min(1).describe("The key of the memory to recall"),
    },
    async (args) => {
      try {
        const value = await handlers.recall(args.key);
        if (value === null) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ found: false, key: args.key }) }],
          };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ found: true, key: args.key, value }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  return createSdkMcpServer({
    name: "memory",
    version: "1.0.0",
    tools: [saveMemoryTool, recallMemoryTool],
  });
}
