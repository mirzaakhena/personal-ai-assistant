import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createMessageTools, type MessageContext } from "./message.js";
import { createCronjobTools, type CronContext } from "./cronjob.js";

export function createMessageServer(ctx: MessageContext, cronCtx: CronContext) {
  return createSdkMcpServer({
    name: "message",
    version: "1.0.0",
    tools: [...createMessageTools(ctx), ...createCronjobTools(cronCtx)],
  });
}
