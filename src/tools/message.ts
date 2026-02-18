import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Client } from "whatsapp-web.js";

export type MessageContext = {
  client: Client;
  chatId: string;
};

function calcTypingDuration(content: string): number {
  return Math.min(Math.max(content.length * 30, 1000), 8000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMessageTools(ctx: MessageContext) {
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
      const chat = await ctx.client.getChatById(ctx.chatId);
      for (const msg of args.messages) {
        await sleep(msg.pauseBeforeTyping);
        await chat.sendStateTyping();
        await sleep(calcTypingDuration(msg.content));
        await chat.clearState();
        await ctx.client.sendMessage(ctx.chatId, msg.content);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message_count: args.messages.length }) }]
      };
    }
  );

  return [sendMessageTool];
}

export function createMessageServer(ctx: MessageContext) {
  return createSdkMcpServer({
    name: "message",
    version: "1.0.0",
    tools: createMessageTools(ctx)
  });
}
