// src-v4/tools/message.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/** A single message item from the send_message tool */
export interface SendMessageItem {
  content: string;
  pauseBeforeTyping?: number;
}

/**
 * Delivery function — how a message reaches the user.
 * Gateway implementations provide this; tool handler calls it per message.
 *
 * `options.pauseBeforeTyping` is the silent pause (no typing indicator) before
 * the typing animation starts for this message. Gateway may ignore it
 * (e.g., console) or respect it (e.g., telegram).
 */
export type MessageDeliver = (
  userId: string,
  content: string,
  options?: { pauseBeforeTyping?: number }
) => Promise<void>;

/**
 * Create a standalone MCP server for send_message.
 * @param deliver - Function called to deliver each message
 * @param userId - Bound at server creation; tool calls deliver(userId, content, options)
 */
export function createMessageServer(deliver: MessageDeliver, userId: string) {
  const sendMessageTool = tool(
    "send_message",
    `Send one or multiple messages to user with realistic human-like timing.

TIMING MODEL:
- pauseBeforeTyping: Silent pause (no typing indicator) BEFORE typing animation starts.
  Use this for dramatic/emotional pauses between messages (e.g., "Hmm..." [pause 2s] "sebenernya...").
- typingDuration: AUTO-CALCULATED by gateway based on character count (DO NOT specify).

IMPORTANT: pauseBeforeTyping is IGNORED for the FIRST message in each tool call.
The natural API latency before Claude's response already serves as the initial silence —
no need to add more pause before the first message appears.
For messages 2, 3, ... the pauseBeforeTyping is respected to create dramatic pauses.

EXAMPLES:
Single message (quick response — pauseBeforeTyping ignored since it's the first):
  {"messages": [{"content": "Halo!", "pauseBeforeTyping": 1000}]}

Multiple messages (first pause ignored, subsequent pauses respected):
  {"messages": [
    {"content": "Hmm...", "pauseBeforeTyping": 2000},
    {"content": "Sebenernya nih...", "pauseBeforeTyping": 1500},
    {"content": "aku bingung deh.", "pauseBeforeTyping": 1000}
  ]}

Minimum pauseBeforeTyping is 1000ms for natural, realistic feel.`,
    {
      messages: z.array(z.object({
        content: z.string().min(1).describe("Message content to send to user"),
        pauseBeforeTyping: z.number().min(1000).max(10000000).optional().describe("Silent pause in ms before typing indicator appears. Ignored for first message; defaults to 1000ms when omitted on subsequent messages."),
      })).min(1).describe("Array of messages to send sequentially"),
    },
    async (args) => {
      for (let i = 0; i < args.messages.length; i++) {
        const msg = args.messages[i];
        const pause = i === 0 ? 0 : (msg.pauseBeforeTyping ?? 1000);
        await deliver(userId, msg.content, { pauseBeforeTyping: pause });
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
