import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export type MessageContext = {
  sendMessage: (content: string) => Promise<void>;
  /** Optional callback to track assistant messages for conversation summary */
  onAssistantMessage?: (content: string) => void;
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
        ctx.onAssistantMessage?.(msg.content);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message_count: args.messages.length }) }]
      };
    }
  );

  return [sendMessageTool];
}
