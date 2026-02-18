import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Client, Message } from "whatsapp-web.js";
import { getSessionId, saveSessionId } from "../db/sessions.js";
import { type MessageContext } from "../tools/message.js";
import { createQueryOptions } from "../core/options.js";
import { buildUserPrompt } from "../utils/prompt.js";

export async function processMessage(client: Client, message: Message): Promise<void> {
  const chatId = message.from;
  const phoneNumber = chatId.replace(/@.*$/, '');

  console.log(`[${phoneNumber}] Received: ${message.body}`);

  const sessionId = getSessionId(phoneNumber);
  const ctx: MessageContext = { client, chatId };
  const prompt = buildUserPrompt(message.body);
  const options = await createQueryOptions(sessionId, ctx);
  const responses = query({ prompt, options });

  let finalSessionId: string | undefined;
  for await (const msg of responses) {
    if (msg.type === 'result') {
      finalSessionId = msg.session_id;
      console.log(`[${phoneNumber}] Cost: $${msg.total_cost_usd.toFixed(6)} | Session: ${msg.session_id}`);
    }
  }

  if (finalSessionId) {
    saveSessionId(phoneNumber, finalSessionId);
  }
}
