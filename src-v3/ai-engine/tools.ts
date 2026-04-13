// src-v3/ai-engine/tools.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { SendMessageHandler } from "./types.js";

/**
 * Create the send_message MCP tool.
 * If onSendMessage is provided, it handles delivery.
 * Otherwise, falls back to console.log.
 */
function createMessageTools(onSendMessage?: SendMessageHandler) {
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
      if (onSendMessage) {
        await onSendMessage(args.messages);
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

  return [sendMessageTool];
}

/**
 * Create the message MCP server containing send_message tool.
 * @param onSendMessage - Optional handler for message delivery. Falls back to console.log.
 */
export function createMessageServer(onSendMessage?: SendMessageHandler) {
  return createSdkMcpServer({
    name: "message",
    version: "1.0.0",
    tools: createMessageTools(onSendMessage),
  });
}
