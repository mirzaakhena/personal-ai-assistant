import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createMessageTools, type MessageContext } from "./message.js";
import { createCronjobTools, type CronContext } from "./cronjob.js";
import { createMemoryTools, type MemoryContext } from "./memory.js";

export function createToolServer(ctx: MessageContext, cronCtx: CronContext, memCtx: MemoryContext) {
  return createSdkMcpServer({
    name: "tools",
    version: "1.0.0",
    tools: [...createMessageTools(ctx), ...createCronjobTools(cronCtx), ...createMemoryTools(memCtx)],
  });
}
