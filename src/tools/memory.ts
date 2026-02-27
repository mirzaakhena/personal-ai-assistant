import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  saveMemory,
  updateMemory,
  supersedeMemory,
  deleteMemory,
  recallMemories,
  getAllMemories,
  upsertContact,
} from "../memory/operations.js";
import {
  formatRecalledMemories,
  formatAllMemories,
} from "../memory/formatter.js";

export type MemoryContext = {
  phoneNumber: string;
};

const MEMORY_TYPE_ENUM = ["preference", "fact", "routine", "persona", "contact"] as const;
type MemoryType = (typeof MEMORY_TYPE_ENUM)[number];

export function createMemoryTools(memCtx: MemoryContext) {
  const saveMemoryTool = tool(
    "save_memory",
    `Save a new memory about the user. Use this to store preferences, facts, routines, persona settings, or contacts.

For each memory_type, provide the relevant fields in "data":
- preference: { category, value, context?, importance }
- fact: { content, category, importance }
- routine: { activity, schedule?, details?, importance }
- persona: { name, personality_traits?, communication_style?, language_preference? }
- contact: { name, relationship, notes? }

"importance" should be "fundamental" (loaded every conversation) or "extended" (recalled on-demand).`,
    {
      memory_type: z.enum(MEMORY_TYPE_ENUM).describe("Type of memory to save"),
      data: z.record(z.string(), z.unknown()).describe("Memory data fields (varies by memory_type)"),
    },
    async (args) => {
      try {
        if (args.memory_type === "contact") {
          const name = args.data.name as string;
          const relationship = args.data.relationship as string;
          const notes = args.data.notes as string | undefined;

          if (!name || !relationship) {
            return {
              content: [{ type: "text", text: JSON.stringify({ success: false, error: "Contact requires 'name' and 'relationship' in data" }) }],
            };
          }

          const recordId = await upsertContact(memCtx.phoneNumber, name, relationship, notes);
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, record_id: recordId }) }],
          };
        }

        const table = args.memory_type as "preference" | "fact" | "routine" | "persona";
        const recordId = await saveMemory(memCtx.phoneNumber, table, args.data);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, record_id: recordId }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  const updateMemoryTool = tool(
    "update_memory",
    `Update an existing memory or supersede it with new information. Use supersede=true when the old info is replaced (e.g., user moved to a new city), which keeps an audit trail. Use supersede=false for minor edits.`,
    {
      record_id: z.string().min(1).describe("The record ID of the memory to update (e.g., 'fact:abc123')"),
      new_data: z.record(z.string(), z.unknown()).describe("New data fields to set on the memory"),
      supersede: z.boolean().optional().describe("If true, creates a new record and marks the old one as superseded (default: false)"),
    },
    async (args) => {
      try {
        if (args.supersede) {
          // Extract table from record_id (e.g., "fact:abc" -> "fact")
          const table = args.record_id.split(":")[0];
          if (!table || !["preference", "fact", "routine", "persona"].includes(table)) {
            return {
              content: [{ type: "text", text: JSON.stringify({ success: false, error: `Invalid record_id table prefix: ${table}` }) }],
            };
          }
          const newId = await supersedeMemory(args.record_id, memCtx.phoneNumber, table, args.new_data);
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, new_record_id: newId, superseded: args.record_id }) }],
          };
        }

        await updateMemory(args.record_id, args.new_data);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, record_id: args.record_id }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  const recallMemoryTool = tool(
    "recall_memory",
    `Search stored memories by keyword or topic. Returns matching memories ranked by relevance. Use this to find specific information mid-conversation.`,
    {
      query: z.string().min(1).describe("Search query — keywords or topic to search for"),
      type_filter: z.enum(["preference", "fact", "routine", "persona"]).optional().describe("Optional: filter results to a specific memory type"),
    },
    async (args) => {
      try {
        let results = await recallMemories(memCtx.phoneNumber, args.query);

        if (args.type_filter) {
          results = results.filter((r) => {
            const table = String(r.id).split(":")[0];
            return table === args.type_filter;
          });
        }

        const formatted = formatRecalledMemories(results);
        return {
          content: [{ type: "text", text: formatted }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  const listMemoriesTool = tool(
    "list_memories",
    `List all stored memories for the current user. Shows all memory types with their record IDs, which can be used for updating or deleting specific memories.`,
    {},
    async () => {
      try {
        const memories = await getAllMemories(memCtx.phoneNumber);
        const formatted = formatAllMemories(memories);
        return {
          content: [{ type: "text", text: formatted }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  const forgetMemoryTool = tool(
    "forget_memory",
    `Delete a specific memory by its record ID. This permanently removes the memory and its graph edges. Always confirm with the user before deleting.`,
    {
      record_id: z.string().min(1).describe("The record ID to delete (e.g., 'fact:abc123')"),
    },
    async (args) => {
      try {
        await deleteMemory(args.record_id);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  return [saveMemoryTool, updateMemoryTool, recallMemoryTool, listMemoriesTool, forgetMemoryTool];
}
