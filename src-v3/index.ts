// src-v3/index.ts

import { createAIEngine } from './ai-engine/index.js';

const engine = createAIEngine({
  model: 'haiku',
  onSendMessage: async (messages) => {
    for (const msg of messages) {
      console.log(`[send_message]: ${msg.content}`);
    }
  },
});

const prompt = '[user]: Hello, who are you?';

console.log(prompt);
console.log('---');

const result = await engine.query(prompt, {
  callbacks: {
    onInit: (info) => console.log(`[init]: model=${info.model} tools=${info.tools.length}`),
    onThinking: (text) => console.log(`[thinking]: ${text.slice(0, 100)}...`),
    onMessage: (text) => console.log(`[message]: ${text.slice(0, 100)}...`),
    onToolUse: (name) => console.log(`[tool]: ${name}`),
    onSessionId: (id) => console.log(`[session]: ${id}`),
    onRateLimit: (info) => console.log(`[rate_limit]: resets=${info.resetsAt}`),
    onError: (err) => console.error(`[error]: [${err.level}] ${err.reason}: ${err.messages.join(', ')}`),
  },
});

console.log('---');
console.log(`Session: ${result.sessionId}`);
console.log(`Cost: $${result.costUsd.toFixed(4)}`);
console.log(`Duration: ${result.durationMs}ms`);
console.log(`Turns: ${result.numTurns}`);
if (result.error) {
  console.error(`Error: [${result.error.level}] ${result.error.reason}`);
}
