import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  saveMemory,
  updateMemory,
  supersedeMemory,
  deleteMemory,
  recallMemories,
  recallConversations,
  getAllMemories,
  upsertContact,
  queryRelationships,
} from "../memory/operations/index.js";
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

  const recallConversationsTool = tool(
    "recall_conversations",
    `Search past conversation summaries by topic or keyword. Use this to recall what was discussed in previous sessions — decisions made, topics covered, or context from earlier conversations. Useful for questions like "kapan terakhir kita bahas soal liburan?" or "apa yang kita obrolin kemarin?"`,
    {
      query: z.string().min(1).describe("Search query — topic or keyword to find in past conversations"),
      limit: z.number().int().min(1).max(20).optional().describe("Max number of past conversations to return (default: 5)"),
    },
    async (args) => {
      try {
        const results = await recallConversations(memCtx.phoneNumber, args.query, args.limit ?? 5);

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No past conversations found matching that query." }],
          };
        }

        const formatted = results
          .map((r, i) => {
            const topics = ((r.topics as string[]) ?? []).join(', ') || 'none';
            const decisions = (r.key_decisions as string[]) ?? [];
            const date = r.date
              ? new Date(String(r.date)).toLocaleDateString()
              : r.created_at
                ? new Date(String(r.created_at)).toLocaleDateString()
                : 'unknown date';
            let out = `[${i + 1}] ${date}\nSummary: ${r.summary}\nTopics: ${topics}`;
            if (decisions.length > 0) {
              out += `\nDecisions: ${decisions.join('; ')}`;
            }
            return out;
          })
          .join('\n\n');

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

  const queryRelationshipsTool = tool(
    "query_relationships",
    `Query relationships and connections between people and memories using graph traversal. Supports these query types:

- "contacts_by_attribute": Find contacts matching specific attributes. Filters: { occupation: "engineer", location: "Jakarta", relationship_type: "colleague", ... }
- "upcoming_birthdays": Find contacts with birthdays in the next N days. Filters: { days_ahead: 30 }
- "related_memories": Find all memories related to a specific person. Filters: { person_name: "Budi" }
- "mutual_connections": List all known contacts with their relationship info.

Use this for relational queries like "siapa aja teman kerja aku?", "ada yang ulang tahun bulan ini?", "apa yang aku tahu tentang Budi?"`,
    {
      query_type: z.enum(["contacts_by_attribute", "mutual_connections", "upcoming_birthdays", "related_memories"]).describe("Type of relationship query"),
      filters: z.record(z.string(), z.unknown()).optional().describe("Query-specific filters (varies by query_type)"),
    },
    async (args) => {
      try {
        const results = await queryRelationships(
          memCtx.phoneNumber,
          args.query_type,
          args.filters ?? {},
        );

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No matching results found." }],
          };
        }

        const formatted = results
          .map((r, i) => {
            const lines: string[] = [`[${i + 1}]`];
            if (r.type === 'contact_info') {
              lines.push(`Contact: ${r.name ?? 'Unknown'}`);
              if (r.relationship_type) lines.push(`Relationship: ${r.relationship_type}`);
              if (r.occupation) lines.push(`Occupation: ${r.occupation}`);
              if (r.location) lines.push(`Location: ${r.location}`);
              if (r.birthday) lines.push(`Birthday: ${r.birthday}`);
              if (r.relationship_notes && r.relationship_notes !== 'NONE') lines.push(`Notes: ${r.relationship_notes}`);
            } else if (r.type === 'related_memory') {
              const table = String(r.id).split(':')[0];
              lines.push(`Memory (${table}): ${r.content ?? r.value ?? r.activity ?? r.name ?? 'Unknown'}`);
              if (r.id) lines.push(`ID: ${r.id}`);
            } else {
              // Generic contact or relationship result
              if (r.name) lines.push(`Name: ${r.name}`);
              if (r.relationship_type) lines.push(`Relationship: ${r.relationship_type}`);
              if (r.occupation) lines.push(`Occupation: ${r.occupation}`);
              if (r.location) lines.push(`Location: ${r.location}`);
              if (r.birthday) lines.push(`Birthday: ${r.birthday}`);
              if (r.days_until_birthday !== undefined) lines.push(`Days until birthday: ${r.days_until_birthday}`);
              if (r.notes && r.notes !== 'NONE') lines.push(`Notes: ${r.notes}`);
            }
            return lines.join('\n');
          })
          .join('\n\n');

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

  return [saveMemoryTool, updateMemoryTool, recallMemoryTool, listMemoriesTool, forgetMemoryTool, recallConversationsTool, queryRelationshipsTool];
}
