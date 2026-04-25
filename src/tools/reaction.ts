// src/tools/reaction.ts

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/**
 * Reaction function — how an emoji reaction reaches a user's message.
 * Gateway implementations provide this; tool handler calls it per reaction.
 *
 * Passing an empty `emoji` clears any existing reaction on the message.
 */
export type MessageReactor = (
  userId: string,
  messageId: number,
  emoji: string
) => Promise<void>;

/**
 * Create a standalone MCP server for react_to_message.
 * @param reactor - Function called to apply the reaction
 * @param userId - Bound at server creation; tool calls reactor(userId, message_id, emoji)
 */
export function createReactionServer(reactor: MessageReactor, userId: string) {
  const reactTool = tool(
    "react_to_message",
    `Add an emoji reaction to a Telegram message.

Pass the value of the message_id attribute from an incoming <user_message> to target that specific message.

Telegram only permits emojis from its standard reaction set (examples: 👍 👎 ❤️ 🔥 🥰 👏 😁 🤔 🤯 🎉 🙏 👌 💯 👀 🤝). Unsupported emojis will fail at the API level.

Pass an empty string for emoji to clear an existing reaction.`,
    {
      message_id: z
        .number()
        .int()
        .describe("Telegram message_id to react to (from <user_message message_id=...>)"),
      emoji: z
        .string()
        .describe("Single emoji from Telegram's standard reaction set, or empty string to clear"),
    },
    async (args) => {
      await reactor(userId, args.message_id, args.emoji);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ success: true }) },
        ],
      };
    }
  );

  return createSdkMcpServer({
    name: "reaction",
    version: "1.0.0",
    tools: [reactTool],
  });
}
