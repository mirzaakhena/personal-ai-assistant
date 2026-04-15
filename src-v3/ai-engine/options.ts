// src-v3/ai-engine/options.ts

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { EffortLevel } from "./types.js";

/** All built-in Claude Code tools — blocked to keep the AI focused on our MCP tools only */
const allBuiltInTools = [
  // Code/filesystem
  'Task',            'Bash',
  'Glob',            'Grep',
  'Read',            'Edit',
  'Write',           'NotebookEdit',
  'BashOutput',      'KillShell',
  // Web
  'WebFetch',        'WebSearch',
  // Planning
  'ExitPlanMode',    'EnterPlanMode',
  // Worktree
  'EnterWorktree',   'ExitWorktree',
  // Skills / slash / diagnostics
  'Skill',           'SlashCommand',
  'getDiagnostics',  'executeCode',
  'TodoWrite',
  // Agent / task spawning
  'Agent',
  'AgentOutputTool', 'AskUserQuestion',
  'TaskCreate',      'TaskGet',
  'TaskList',        'TaskUpdate',
  'TaskOutput',      'TaskStop',
  'ToolSearch',
  // Cron / scheduling / triggers (we use our own MCP cronjob tools)
  'CronCreate',      'CronDelete',
  'CronList',        'RemoteTrigger',
  'Monitor',         'ScheduleWakeup',
];

/** Fully resolved config — all fields required, merged by query.ts before calling this */
export interface ResolvedConfig {
  model: string;
  systemPrompt: string;
  maxTurns: number;
  effort: EffortLevel;
  sessionId?: string;
  mcpServers: Record<string, any>;
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
    systemPrompt: config.systemPrompt,
    mcpServers: config.mcpServers,
  };

  if (config.sessionId) {
    options.resume = config.sessionId;
  }

  return options;
}
