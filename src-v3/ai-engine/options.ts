// src-v3/ai-engine/options.ts

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { createMessageServer } from "./tools.js";

/** All built-in Claude Code tools — blocked to keep the AI focused on our MCP tools only */
const allBuiltInTools = [
  'Task',            'Bash',
  'Glob',            'Grep',
  'ExitPlanMode',    'Read',
  'Edit',            'Write',
  'NotebookEdit',    'WebFetch',
  'TodoWrite',       'WebSearch',
  'BashOutput',      'KillShell',
  'Skill',           'SlashCommand',
  'EnterPlanMode',   'getDiagnostics',
  'executeCode',     'AgentOutputTool',
  'TaskOutput',      'TaskStop',
  'AskUserQuestion', 'ToolSearch',
];

/**
 * Build the Options object for the SDK query() call.
 *
 * @param sessionId - Optional session ID to resume a previous conversation
 */
export function createQueryOptions(sessionId?: string): Options {
  const options: Options = {
    model: 'haiku', // TODO: read from env (CLAUDE_MODEL)
    maxTurns: 3,
    permissionMode: 'bypassPermissions' as const,
    allowDangerouslySkipPermissions: true,
    disallowedTools: allBuiltInTools,
    systemPrompt: 'You are a helpful assistant. Answer concisely.',
    mcpServers: {
      message: createMessageServer(),
    },
  };

  if (sessionId) {
    options.resume = sessionId;
  }

  return options;
}
