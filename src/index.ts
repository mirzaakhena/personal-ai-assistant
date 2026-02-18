import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildUserPrompt } from "./utils/prompt.js";
import { createQueryOptions } from "./core/options.js";

const userMessage = "Hello, who are you?";
const prompt = buildUserPrompt(userMessage);

console.log(`[user]: ${userMessage}`);

const options = await createQueryOptions();
const responses = query({ prompt, options });

for await (const message of responses) {
  if (message.type === "system" && message.subtype === "init") {
    // session started
  } else if (message.type === "result") {
    console.log(`\n💰 Cost: $${message.total_cost_usd.toFixed(6)}`);
    console.log(`📍 Session: ${message.session_id}`);
  }
}
