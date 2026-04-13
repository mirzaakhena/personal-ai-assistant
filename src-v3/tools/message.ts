// src-v3/tools/message.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/** A single message from the send_message tool */
export interface SendMessageItem {
  content: string;
  pauseBeforeTyping: number;
}

/** Handler for send_message tool invocations */
export type SendMessageHandler = (messages: SendMessageItem[]) => Promise<void> | void;

/**
 * Create a standalone MCP server for the send_message tool.
 * @param handler - Optional delivery handler. Falls back to console.log.
 */
export function createMessageServer(handler?: SendMessageHandler) {
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
      if (handler) {
        await handler(args.messages);
      } else {
        for (const msg of args.messages) {
          console.log(`[assistant]: ${msg.content}`);
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true, message_count: args.messages.length }) }]
      };
    }
  );

  return createSdkMcpServer({
    name: "message",
    version: "1.0.0",
    tools: [sendMessageTool],
  });
}
