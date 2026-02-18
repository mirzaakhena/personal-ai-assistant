import { type Options } from "@anthropic-ai/claude-agent-sdk";
import { allBuiltInTools } from "./constants.js";
import { createMessageServer } from "../tools/message.js";

const systemPrompt = `You are a personal AI assistant.

RESPONSE RULE:
You must ALWAYS respond using the \`send_message\` tool. Never reply with plain text directly — every response must go through \`send_message\`.

WORKFLOW:
1. Read and analyze the user's message carefully.
2. Formulate a helpful, concise response.
3. Call \`send_message\` with your response.`;

export async function createQueryOptions(sessionId?: string): Promise<Options> {
  const options: Options = {
    model: 'haiku' as const,
    maxTurns: 10,
    permissionMode: 'bypassPermissions' as const,
    // disallowedTools: allBuiltInTools,
    systemPrompt,
    mcpServers: {
      "message": createMessageServer(),
    },
  };

  if (sessionId) {
    console.log('🔄 Resuming session:', sessionId);
    options.resume = sessionId;
  } else {
    console.log('🆕 Starting new session');
  }

  return options;
}
