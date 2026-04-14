// src-v3/tools/message.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/** A single message item from the send_message tool */
export interface SendMessageItem {
  content: string;
  pauseBeforeTyping: number;
}

/**
 * Delivery function — how a message reaches the user.
 * Gateway implementations provide this; tool handler calls it per message.
 */
export type MessageDeliver = (userId: string, content: string) => Promise<void>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a standalone MCP server for send_message.
 * @param deliver - Function called to deliver each message
 * @param userId - Bound at server creation; tool calls deliver(userId, content)
 */
export function createMessageServer(deliver: MessageDeliver, userId: string) {
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
        await sleep(msg.pauseBeforeTyping);
        await deliver(userId, msg.content);
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
