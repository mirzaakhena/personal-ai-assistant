import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { log } from "../utils/logger.js";

export type MessageContext = {
  sendMessage: (content: string) => Promise<void>;
};

export function createMessageTools(ctx: MessageContext) {
  const sendMessageTool = tool(
    "send_message",
    `Send one or multiple messages to user.

EXAMPLES:
Single message:
  {"messages": [{"content": "Halo!"}]}

Multiple messages:
  {"messages": [
    {"content": "Hmm..."},
    {"content": "Sebenernya nih..."},
    {"content": "aku bingung deh."}
  ]}`,
    {
      messages: z.array(z.object({
        content: z.string().min(1).describe("Message content to send to user"),
      })).min(1).describe("Array of messages to send sequentially"),
    },
    async (args) => {
      for (const msg of args.messages) {
        await ctx.sendMessage(msg.content);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message_count: args.messages.length }) }]
      };
    }
  );

  return [sendMessageTool];
}
