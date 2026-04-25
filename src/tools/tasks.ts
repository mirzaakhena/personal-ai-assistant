// src/tools/tasks.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TaskStore, TaskRecord, TaskStatus, TaskTriggerType } from '../db/tasks.js';
import { TASK_STATUSES } from '../db/tasks.js';
import { toIsoJakarta } from '../utils/time.js';

export interface TaskResult {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  due_date: string | null;
  source_msg_id: string | null;
  trigger_type: TaskTriggerType | null;
  trigger_pattern: string | null;
  created_at: string;
  updated_at: string;
}

function sanitize(r: TaskRecord): TaskResult {
  return {
    id: r.id, title: r.title, notes: r.notes, status: r.status,
    due_date: r.due_date, source_msg_id: r.source_msg_id,
    trigger_type: r.trigger_type, trigger_pattern: r.trigger_pattern,
    created_at: toIsoJakarta(r.created_at),
    updated_at: toIsoJakarta(r.updated_at),
  };
}

export interface TaskHandlers {
  createTask(rec: { title: string; notes?: string; due_date?: string; source_msg_id?: string }): TaskResult;
  updateTask(id: string, patch: { status?: TaskStatus; title?: string; notes?: string; due_date?: string | null }): { updated: boolean; task?: TaskResult };
  listTasks(filter?: { status?: TaskStatus }): TaskResult[];
  deleteTask(id: string): { deleted: boolean };
}

export function createTaskHandlers(store: TaskStore): TaskHandlers {
  return {
    createTask: (rec) => sanitize(store.create(rec)),
    updateTask: (id, patch) => {
      const res = store.update(id, patch);
      return { updated: res.updated, task: res.task ? sanitize(res.task) : undefined };
    },
    listTasks: (filter) => store.listPending({ status: filter?.status, cap: 500 }).map(sanitize),
    deleteTask: (id) => ({ deleted: store.delete(id) }),
  };
}

export function createTaskMcpServer(h: TaskHandlers) {
  return createSdkMcpServer({
    name: "tasks",
    version: "1.0.0",
    tools: [
      tool(
        "create_task",
        "Create a new pending task. due_date is YYYY-MM-DD in the user's timezone.",
        {
          title: z.string().min(1),
          notes: z.string().optional(),
          due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          source_msg_id: z.string().optional(),
        },
        async (rec) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.createTask(rec)) }],
        })
      ),
      tool(
        "update_task",
        "Update a task — change status (pending/done/cancelled) and/or edit title/notes/due_date.",
        {
          id: z.string().min(1),
          status: z.enum(TASK_STATUSES).optional(),
          title: z.string().min(1).optional(),
          notes: z.string().optional(),
          due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        },
        async ({ id, ...patch }) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.updateTask(id, patch)) }],
        })
      ),
      tool(
        "list_tasks",
        "List tasks, optionally filtered by status. Default: all statuses.",
        {
          status: z.enum(TASK_STATUSES).optional(),
        },
        async ({ status }) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.listTasks({ status }), null, 2) }],
        })
      ),
      tool(
        "delete_task",
        "Hard-delete a task by id. Use for typos / accidental saves; for completion use update_task.",
        {
          id: z.string().min(1),
        },
        async ({ id }) => ({
          content: [{ type: "text" as const, text: JSON.stringify(h.deleteTask(id)) }],
        })
      ),
    ],
  });
}
