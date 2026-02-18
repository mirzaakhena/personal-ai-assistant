import { createSdkMcpServer, tool, Options, query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const TIMEZONE = "Asia/Jakarta";

function buildUserPrompt(message: string): string {
  const now = new Date();

  const dateStr = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  const timeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(now);

  return `[USER MESSAGE]

Timestamp: ${dateStr}, ${timeStr}

[MESSAGE]
${message}`;
}

/**
 * Create Message Tools
 * Simplified version that logs messages to console instead of sending via service
 */
function createMessageTools() {
  const sendMessageTool = tool(
    "send_message",
    `Send one or multiple messages to user with realistic human-like timing.

TIMING MODEL:
- pauseBeforeTyping: Delay BEFORE typing indicator shows (thinking/emotional pause)
- typingDuration: AUTO-CALCULATED based on character count (DO NOT specify)

EXAMPLES:
Single message (quick response):
  {"messages": [{"content": "Halo!", "pauseBeforeTyping": 1000}]}

Multiple messages (thinking → typing):
  {"messages": [
    {"content": "Hmm...", "pauseBeforeTyping": 2000},
    {"content": "Sebenernya nih...", "pauseBeforeTyping": 1500},
    {"content": "aku bingung deh.", "pauseBeforeTyping": 1000}
  ]}

Minimum pauseBeforeTyping is 1000ms for natural, realistic feel.`,
    {
      messages: z.array(z.object({
        content: z.string().min(1).describe("Message content to send to user"),
        pauseBeforeTyping: z.number().min(1000).max(10000000).describe("Delay in ms before typing indicator appears"),
      })).min(1).describe("Array of messages to send sequentially"),
    },
    async (args) => {
      for (const msg of args.messages) {
        console.log(`[assistant]: ${msg.content}`);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message_count: args.messages.length }) }]
      };
    }
  );

  return [sendMessageTool];
}

/**
 * Create Message Server
 * Factory function that creates an MCP server for message sending
 */
export function createMessageServer() {
  return createSdkMcpServer({
    name: "message",
    version: "1.0.0",
    tools: createMessageTools()
  });
}

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

async function createQueryOptions(sessionId?: string) : Promise<Options> {

  const options : Options = {
    model: 'haiku' as const,
    maxTurns: 3,
    permissionMode: 'bypassPermissions' as const,
    disallowedTools: allBuiltInTools,
    systemPrompt: `You are a personal AI assistant.

RESPONSE RULE:
You must ALWAYS respond using the \`send_message\` tool. Never reply with plain text directly — every response must go through \`send_message\`.

WORKFLOW:
1. Read and analyze the user's message carefully.
2. Formulate a helpful, concise response.
3. Call \`send_message\` with your response.`,
    mcpServers: {
      "message": createMessageServer(),
    },

  }

  if (sessionId) {
    console.log('=🔄 Resuming session:', sessionId);
    options.resume = sessionId;
  } else {
    console.log('<🆕 Starting new session');
  }

  return options
}

const userMessage = "Hello, who are you?";
const prompt = buildUserPrompt(userMessage);

console.log(`[user]: ${userMessage}`);;

const options = await createQueryOptions()

const responses = query({ prompt, options })

for await (const message of responses) {
  console.log(JSON.stringify(message, null, 2));
}