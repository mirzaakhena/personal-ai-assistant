// src-v3/tools/tasks.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  TaskStore, TaskRecord, TaskType, TaskStatus, TaskPriority,
} from '../db/tasks.js';
import { toIsoJakarta } from '../utils/time.js';

export interface TaskResult {
  id: string;
  type: TaskType;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  trigger_keywords: string[] | null;
  due_date: string | null;
  related_ids: string[] | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskHandlers {
  saveTask(rec: {
    type: TaskType;
    title: string;
    notes?: string;
    priority?: TaskPriority;
    trigger_keywords?: string[];
    due_date?: string;
  }): TaskResult;
  updateTask(id: string, patch: {
    status?: TaskStatus;
    priority?: TaskPriority;
    notes?: string;
    trigger_keywords?: string[];
  }): { updated: boolean; task?: TaskResult };
  completeTask(id: string): { completed: boolean; task?: TaskResult };
  cancelTask(id: string): { cancelled: boolean; task?: TaskResult };
  listTasks(filter?: {
    status?: TaskStatus;
    type?: TaskType;
    priority?: TaskPriority;
    due_before?: string;
    cap?: number;
    order?: 'priority' | 'recency' | 'due';
  }): TaskResult[];
  searchTasks(filter: { query: string; status?: TaskStatus; cap?: number }): TaskResult[];
  deleteTask(id: string): { deleted: boolean };
}

function sanitize(r: TaskRecord): TaskResult {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    notes: r.notes,
    status: r.status,
    priority: r.priority,
    trigger_keywords: r.trigger_keywords,
    due_date: r.due_date,
    related_ids: r.related_ids,
    created_at: toIsoJakarta(r.created_at),
    updated_at: toIsoJakarta(r.updated_at),
    completed_at: r.completed_at !== null ? toIsoJakarta(r.completed_at) : null,
  };
}

export function buildTaskHandlers(store: TaskStore): TaskHandlers {
  return {
    saveTask(rec) {
      return sanitize(store.insert({
        type: rec.type,
        title: rec.title,
        notes: rec.notes ?? null,
        status: 'pending',
        priority: rec.priority ?? null,
        trigger_keywords: rec.trigger_keywords ?? null,
        due_date: rec.due_date ?? null,
        related_ids: null,
      }));
    },
    updateTask(id, patch) {
      const updated = store.update(id, patch);
      return updated ? { updated: true, task: sanitize(updated) } : { updated: false };
    },
    completeTask(id) {
      const updated = store.update(id, { status: 'done' });
      return updated ? { completed: true, task: sanitize(updated) } : { completed: false };
    },
    cancelTask(id) {
      const updated = store.update(id, { status: 'cancelled' });
      return updated ? { cancelled: true, task: sanitize(updated) } : { cancelled: false };
    },
    listTasks(filter) {
      return store.list({
        status: filter?.status,
        type: filter?.type,
        priority: filter?.priority,
        dueBefore: filter?.due_before,
        cap: filter?.cap,
        order: filter?.order,
      }).map(sanitize);
    },
    searchTasks(filter) {
      return store.search({ query: filter.query, status: filter.status, cap: filter.cap }).map(sanitize);
    },
    deleteTask(id) {
      return { deleted: store.delete(id) };
    },
  };
}

const taskTypeEnum = z.enum(['errand', 'grocery', 'routine_item', 'generic']);
const taskStatusEnum = z.enum(['pending', 'in_progress', 'done', 'cancelled']);
const taskPriorityEnum = z.enum(['high', 'medium', 'low']);
const taskOrderEnum = z.enum(['priority', 'recency', 'due']);

function ok(payload: object): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, ...payload }) }] };
}
function fail(err: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: String(err) }) }] };
}
function listOk(results: object[]): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ count: results.length, results }) }] };
}

export function createTasksServer(handlers: TaskHandlers) {
  const saveTaskTool = tool(
    "save_task",
    `Create a new task (action item) for the user.
type guides intent: 'errand' for one-shot actions, 'grocery' for shopping items,
'routine_item' for items in a routine checklist, 'generic' as fallback.

trigger_keywords: array of keywords that should surface this task when user mentions them.
Examples:
  save_task({ type: "errand", title: "Beli sabun", trigger_keywords: ["pasar", "belanja"] })
  save_task({ type: "errand", title: "Titip kunci ke teman", priority: "high", due_date: "2026-04-15" })
  save_task({ type: "grocery", title: "Beli centong nasi", trigger_keywords: ["pasar", "rumah tangga"] })`,
    {
      type: taskTypeEnum.describe("Task type"),
      title: z.string().min(1).describe("What the task is"),
      notes: z.string().optional().describe("Additional details"),
      priority: taskPriorityEnum.optional().describe("high = urgent/today, medium = default, low = someday"),
      trigger_keywords: z.array(z.string()).optional().describe("Keywords that should surface this task"),
      due_date: z.string().optional().describe("ISO date YYYY-MM-DD"),
    },
    async (args) => {
      try { return ok(handlers.saveTask(args)); } catch (err) { return fail(err); }
    }
  );

  const updateTaskTool = tool(
    "update_task",
    `Modify an existing task's status, priority, notes, or trigger_keywords.

Examples:
  update_task({ id: "uuid", status: "in_progress" })
  update_task({ id: "uuid", priority: "high", notes: "user emphasized urgency" })`,
    {
      id: z.string().min(1),
      status: taskStatusEnum.optional(),
      priority: taskPriorityEnum.optional(),
      notes: z.string().optional(),
      trigger_keywords: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        const { id, ...patch } = args;
        return ok(handlers.updateTask(id, patch));
      } catch (err) { return fail(err); }
    }
  );

  const completeTaskTool = tool(
    "complete_task",
    `Mark a task as done. Sets status='done' + completed_at=now.
Use this when user indicates they finished the task.

Examples:
  complete_task({ id: "uuid" })`,
    {
      id: z.string().min(1),
    },
    async (args) => {
      try { return ok(handlers.completeTask(args.id)); } catch (err) { return fail(err); }
    }
  );

  const cancelTaskTool = tool(
    "cancel_task",
    `Mark a task as cancelled. Use when user explicitly drops the task.

Examples:
  cancel_task({ id: "uuid" })`,
    {
      id: z.string().min(1),
    },
    async (args) => {
      try { return ok(handlers.cancelTask(args.id)); } catch (err) { return fail(err); }
    }
  );

  const listTasksTool = tool(
    "list_tasks",
    `List tasks with optional filters.

Examples:
  list_tasks() → all tasks (default cap 20, by recency)
  list_tasks({ status: "pending", order: "priority" }) → pending sorted by priority
  list_tasks({ status: "pending", due_before: "2026-04-20" }) → pending due by Apr 20`,
    {
      status: taskStatusEnum.optional(),
      type: taskTypeEnum.optional(),
      priority: taskPriorityEnum.optional(),
      due_before: z.string().optional().describe("ISO date YYYY-MM-DD"),
      cap: z.number().int().min(1).max(100).optional().describe("Max results"),
      order: taskOrderEnum.optional().describe("Sort order"),
    },
    async (args) => {
      try { return listOk(handlers.listTasks(args)); } catch (err) { return fail(err); }
    }
  );

  const searchTasksTool = tool(
    "search_tasks",
    `Search tasks by FTS5 keyword match in title, notes, or trigger_keywords.

Use this proactively when user mentions a context word (e.g., "aku mau ke pasar" → search_tasks(query: "pasar")).

Examples:
  search_tasks({ query: "pasar" }) → tasks with "pasar" in title/notes/keywords
  search_tasks({ query: "kunci", status: "pending" }) → only pending`,
    {
      query: z.string().min(1).describe("FTS5 query"),
      status: taskStatusEnum.optional(),
      cap: z.number().int().min(1).max(100).optional(),
    },
    async (args) => {
      try { return listOk(handlers.searchTasks(args)); } catch (err) { return fail(err); }
    }
  );

  const deleteTaskTool = tool(
    "delete_task",
    `Hard delete a task. Use only for accidental creates — for normal completion use complete_task or cancel_task.

Examples:
  delete_task({ id: "uuid" })`,
    {
      id: z.string().min(1),
    },
    async (args) => {
      try { return ok(handlers.deleteTask(args.id)); } catch (err) { return fail(err); }
    }
  );

  return createSdkMcpServer({
    name: "tasks",
    version: "1.0.0",
    tools: [
      saveTaskTool, updateTaskTool, completeTaskTool, cancelTaskTool,
      listTasksTool, searchTasksTool, deleteTaskTool,
    ],
  });
}
