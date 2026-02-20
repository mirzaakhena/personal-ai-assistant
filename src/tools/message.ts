import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Client } from "whatsapp-web.js";
import { log } from "../utils/logger.js";
import {
  JID_SUFFIX_REGEX,
  TYPING_MS_PER_CHAR,
  MIN_TYPING_DURATION_MS,
  MAX_TYPING_DURATION_MS,
  MIN_PAUSE_BEFORE_TYPING_MS,
  MAX_PAUSE_BEFORE_TYPING_MS,
} from "../core/constants.js";

export type MessageContext = {
  client: Client;
  chatId: string;
};

function calcTypingDuration(content: string): number {
  return Math.min(Math.max(content.length * TYPING_MS_PER_CHAR, MIN_TYPING_DURATION_MS), MAX_TYPING_DURATION_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMessageTools(ctx: MessageContext) {
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
        pauseBeforeTyping: z.number().min(MIN_PAUSE_BEFORE_TYPING_MS).max(MAX_PAUSE_BEFORE_TYPING_MS).describe("Delay in ms before typing indicator appears"),
      })).min(1).describe("Array of messages to send sequentially"),
    },
    async (args) => {
      const phone = ctx.chatId.replace(JID_SUFFIX_REGEX, '');
      const chat = await ctx.client.getChatById(ctx.chatId);
      for (const msg of args.messages) {
        await sleep(msg.pauseBeforeTyping);
        await chat.sendStateTyping();
        await sleep(calcTypingDuration(msg.content));
        await chat.clearState();
        await ctx.client.sendMessage(ctx.chatId, msg.content);
        log.chat(`${phone} ← ${msg.content}`);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message_count: args.messages.length }) }]
      };
    }
  );

  return [sendMessageTool];
}
