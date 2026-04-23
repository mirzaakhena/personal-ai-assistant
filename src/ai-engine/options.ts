// src/ai-engine/options.ts

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { EffortLevel } from "./types.js";

/**
 * Built-in Claude Code tools that we explicitly BLOCK from the runtime AI.
 *
 * Rationale: keep AI focused on user-facing conversation + our MCP tools.
 *
 * What's ENABLED (not in this list):
 *   Code/filesystem: Bash, Glob, Grep, Read, Edit, Write, NotebookEdit,
 *                    BashOutput, KillShell
 *   Web:             WebFetch, WebSearch
 *   Dev utilities:   executeCode, getDiagnostics, TodoWrite
 *
 * What's BLOCKED (listed below):
 *   - Task/Agent spawning — runtime is single-agent; no nested delegation
 *   - Plan mode — not a user-facing assistant concern
 *   - Worktree ops — git internals, not for end-user chat
 *   - SlashCommand — Claude Code UI surface, not our runtime (Skill is ALLOWED for per-user skill discovery)
 *   - Claude Code's Task* tracking — conflicts with our tasks MCP
 *   - ToolSearch — Claude Code internal
 *   - Cron/trigger built-ins — superseded by our MCP cronjob tools
 *   - AskUserQuestion — our gateway handles user turns directly
 */
const allBuiltInTools = [
  // Agent / task spawning
  'Task', 'Agent', 'AgentOutputTool', 'AskUserQuestion',
  // Planning UI (Claude Code meta)
  'ExitPlanMode', 'EnterPlanMode',
  // Worktree (git internals)
  'EnterWorktree', 'ExitWorktree',
  // Slash (Claude Code UI surface — we don't want AI invoking slash commands)
  'SlashCommand',
  // Claude Code's own task tracker (conflicts with our tasks MCP)
  'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TaskOutput', 'TaskStop',
  'ToolSearch',
  // Cron / scheduling (superseded by our MCP cronjob tools)
  'CronCreate', 'CronDelete', 'CronList',
  'RemoteTrigger', 'Monitor', 'ScheduleWakeup',
];

/** Fully resolved config — all fields required, merged by query.ts before calling this */
export interface ResolvedConfig {
  model: string;
  systemPrompt: string;
  maxTurns: number;
  effort: EffortLevel;
  sessionId?: string;
  mcpServers: Record<string, any>;
  cwd: string;
}

/**
 * Build the Options object for the SDK query() call.
 * Receives a fully resolved config — no defaults logic here.
 */
export function createQueryOptions(config: ResolvedConfig): Options {
  const options: Options = {
    model: config.model,
    maxTurns: config.maxTurns,
    effort: config.effort,
    permissionMode: 'bypassPermissions' as const,
    allowDangerouslySkipPermissions: true,
    disallowedTools: allBuiltInTools,
    // Per-user cwd + settingSources enable SDK-native skill discovery from
    // <cwd>/.claude/skills/ (see docs/superpowers/specs/2026-04-21-src-v4-design.md §5).
    settingSources: ['user', 'project'],
    cwd: config.cwd,
    systemPrompt: config.systemPrompt,
    mcpServers: config.mcpServers,
  };

  if (config.sessionId) {
    options.resume = config.sessionId;
  }

  return options;
}
