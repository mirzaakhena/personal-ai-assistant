import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { MessageGateway } from '../gateway/types.js';
import { v4 as uuidv4 } from "uuid";
import cron from "node-cron";
import {
  CronjobStatuses,
  TERMINAL_CRONJOB_STATUSES,
} from "../core/constants.js";
import {
  insertCronjob,
  getCronjobById,
  getCronjobsByPhone,
  updateCronjobStatus,
  type CronjobStatus,
} from "../db/cronjobs.js";
import {
  unregisterCronTask,
  type CronRegistry,
} from "../cron/registry.js";
import {
  scheduleOnceJob,
  scheduleRecurringJob,
} from "../cron/scheduler.js";

export type CronContext = {
  registry: CronRegistry;
  phoneNumber: string;
  gateway: MessageGateway;
};

export function createCronjobTools(cronCtx: CronContext) {
  const createCronjobTool = tool(
    "create_cronjob",
    `Schedule a future action for yourself. Use this when the user asks you to remind them or follow up at a later time.

The "message" field is instructions written to your future self (third person), e.g.:
  "The user asked you to follow up on their job application. Ask how it went."

For "once" jobs: provide scheduled_at as an ISO 8601 datetime string (must be in the future).
For "recurring" jobs: provide schedule_cron as a standard 5-field cron expression (e.g. "0 9 * * *" for daily at 9am).
Both types require schedule_human: a plain-language description (e.g. "Every day at 9am", "Tomorrow at 3pm").

You can also create memory-triggered reminders, e.g., birthday reminders for contacts. Include relevant memory context in the message field so your future self knows the context.`,
    {
      type: z.enum(["once", "recurring"]).describe("Job type: 'once' fires one time, 'recurring' fires repeatedly"),
      message: z.string().min(1).describe("Instructions for your future self (third-person) about what to tell/ask the user"),
      schedule_human: z.string().min(1).describe("Human-readable description of the schedule"),
      schedule_cron: z.string().optional().describe("5-field cron expression (required for recurring)"),
      scheduled_at: z.string().optional().describe("ISO 8601 datetime for one-time job (required for once)"),
      end_date: z.string().optional().describe("ISO 8601 datetime when recurring job should stop (optional)"),
    },
    async (args) => {
      if (args.type === "recurring") {
        if (!args.schedule_cron) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "schedule_cron is required for recurring jobs" }) }] };
        }
        if (!cron.validate(args.schedule_cron)) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Invalid cron expression: ${args.schedule_cron}` }) }] };
        }
      }

      if (args.type === "once") {
        if (!args.scheduled_at) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "scheduled_at is required for once jobs" }) }] };
        }
        const scheduledMs = new Date(args.scheduled_at).getTime();
        if (isNaN(scheduledMs)) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Invalid scheduled_at datetime" }) }] };
        }
        if (scheduledMs <= Date.now()) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "scheduled_at must be in the future" }) }] };
        }
      }

      const now = Date.now();
      const jobId = uuidv4();
      const status: CronjobStatus = args.type === "once" ? CronjobStatuses.PENDING : CronjobStatuses.ACTIVE;

      const scheduledAtMs = args.scheduled_at ? new Date(args.scheduled_at).getTime() : null;
      const endDateMs = args.end_date ? new Date(args.end_date).getTime() : null;

      const job = {
        id: jobId,
        phone_number: cronCtx.phoneNumber,
        message: args.message,
        type: args.type as "once" | "recurring",
        schedule_cron: args.schedule_cron ?? null,
        schedule_human: args.schedule_human,
        scheduled_at: scheduledAtMs,
        end_date: endDateMs,
        status,
        created_at: now,
        updated_at: now,
      };

      insertCronjob(job);

      if (args.type === "once") {
        scheduleOnceJob(cronCtx.registry, cronCtx.gateway, job);
      } else {
        scheduleRecurringJob(cronCtx.registry, cronCtx.gateway, job);
      }

      console.log(`[CRON] Created ${args.type} job ${jobId}: ${args.schedule_human}`);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, job_id: jobId, schedule_human: args.schedule_human }),
        }],
      };
    }
  );

  const listCronjobsTool = tool(
    "list_cronjobs",
    "List scheduled reminders/cronjobs for the current user. By default shows only active/pending ones.",
    {
      show_all: z.boolean().optional().describe("If true, include completed and cancelled jobs too (default: false)"),
    },
    async (args) => {
      const jobs = getCronjobsByPhone(cronCtx.phoneNumber, !(args.show_all ?? false));
      return {
        content: [{ type: "text", text: JSON.stringify({ jobs }) }],
      };
    }
  );

  const deleteCronjobTool = tool(
    "delete_cronjob",
    "Cancel and remove a scheduled reminder/cronjob by its ID.",
    {
      job_id: z.string().min(1).describe("The ID of the cronjob to cancel"),
    },
    async (args) => {
      const job = getCronjobById(args.job_id);

      if (!job) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Job not found" }) }] };
      }

      if (job.phone_number !== cronCtx.phoneNumber) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Job not found" }) }] };
      }

      const terminalStatuses: readonly string[] = TERMINAL_CRONJOB_STATUSES;
      if (terminalStatuses.includes(job.status)) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `Job is already in terminal status: ${job.status}` }) }] };
      }

      updateCronjobStatus(args.job_id, CronjobStatuses.CANCELLED);
      unregisterCronTask(cronCtx.registry, args.job_id);

      console.log(`[CRON] Cancelled job ${args.job_id}`);

      return {
        content: [{ type: "text", text: JSON.stringify({ success: true }) }],
      };
    }
  );

  return [createCronjobTool, listCronjobsTool, deleteCronjobTool];
}
