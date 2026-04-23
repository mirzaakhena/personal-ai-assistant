// src/tools/cronjob.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/** Input for creating a cronjob */
export interface CronjobInput {
  type: "once" | "recurring";
  message: string;
  scheduleHuman: string;
  scheduledAt?: string;
  scheduleCron?: string;
}

/** Info about an existing cronjob */
export interface CronjobInfo {
  id: string;
  type: "once" | "recurring";
  message: string;
  scheduleHuman: string;
  status: string;
}

/** Abstract handlers for cronjob operations. Consumer provides scheduling/persistence. */
export interface CronjobHandlers {
  create: (job: CronjobInput) => Promise<string> | string;
  list: () => Promise<CronjobInfo[]> | CronjobInfo[];
  delete: (jobId: string) => Promise<boolean> | boolean;
  update: (jobId: string, patch: { message?: string }) => Promise<boolean> | boolean;
}

/**
 * Create a standalone MCP server for cronjob tools.
 * Minimal CRUD interface — consumer decides scheduling and persistence.
 */
export function createCronjobServer(handlers: CronjobHandlers) {
  const createCronjobTool = tool(
    "create_cronjob",
    `Schedule a future reminder or recurring task.
The "message" field is instructions for your future self (third person), e.g.:
  "The user asked you to follow up on their job application. Ask how it went."

For "once" jobs: provide scheduled_at as an ISO 8601 datetime string (must be in the future).
For "recurring" jobs: provide schedule_cron as a standard 5-field cron expression.
Always provide schedule_human: a plain-language description (e.g. "Every day at 9am", "Tomorrow at 3pm").`,
    {
      type: z.enum(["once", "recurring"]).describe("Job type: 'once' fires one time, 'recurring' fires repeatedly"),
      message: z.string().min(1).describe("Instructions for your future self about what to tell/ask the user"),
      schedule_human: z.string().min(1).describe("Human-readable description of the schedule"),
      scheduled_at: z.string().optional().describe("ISO 8601 datetime for one-time job (required for once)"),
      schedule_cron: z.string().optional().describe("5-field cron expression (required for recurring)"),
    },
    async (args) => {
      try {
        const jobId = await handlers.create({
          type: args.type,
          message: args.message,
          scheduleHuman: args.schedule_human,
          scheduledAt: args.scheduled_at,
          scheduleCron: args.schedule_cron,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true, job_id: jobId, schedule_human: args.schedule_human }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  const listCronjobsTool = tool(
    "list_cronjobs",
    "List scheduled reminders and cronjobs for the current user.",
    {},
    async () => {
      try {
        const jobs = await handlers.list();
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ jobs }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  const deleteCronjobTool = tool(
    "delete_cronjob",
    "Cancel a scheduled reminder/cronjob by its ID.",
    {
      job_id: z.string().min(1).describe("The ID of the cronjob to cancel"),
    },
    async (args) => {
      try {
        const deleted = await handlers.delete(args.job_id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: deleted }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  const updateCronjobTool = tool(
    "update_cronjob",
    `Update the content of a scheduled reminder without changing its schedule.
Currently only the "message" field can be updated. To change the schedule time,
delete the existing job and create a new one.`,
    {
      job_id: z.string().min(1).describe("The ID of the cronjob to update"),
      message: z.string().min(1).optional().describe("New message content for the reminder"),
    },
    async (args) => {
      try {
        const updated = await handlers.update(args.job_id, { message: args.message });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: updated }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }],
        };
      }
    }
  );

  return createSdkMcpServer({
    name: "cronjob",
    version: "1.0.0",
    tools: [createCronjobTool, listCronjobsTool, deleteCronjobTool, updateCronjobTool],
  });
}
