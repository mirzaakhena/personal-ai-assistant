// TODO [ENHANCE]: Rename createMessageServer → createToolServer (it serves all tools, not just message)
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createMessageTools, type MessageContext } from "./message.js";
import { createCronjobTools, type CronContext } from "./cronjob.js";
import { createMemoryTools, type MemoryContext } from "./memory.js";

export function createMessageServer(ctx: MessageContext, cronCtx: CronContext, memCtx: MemoryContext) {
  return createSdkMcpServer({
    name: "message",
    version: "1.0.0",
    tools: [...createMessageTools(ctx), ...createCronjobTools(cronCtx), ...createMemoryTools(memCtx)],
  });
}
