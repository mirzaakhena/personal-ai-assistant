// src-v3/index.ts

import { executeQuery } from './ai-engine/index.js';

const prompt = '[user]: Hello, who are you?';

console.log(prompt);
console.log('---');

const result = await executeQuery(prompt, {
  onMessage: (text) => console.log(`[message]: ${text}`),
  onToolUse: (name) => console.log(`[tool]: ${name}`),
  onSessionId: (id) => console.log(`[session]: ${id}`),
});

console.log('---');
console.log(`Session: ${result.sessionId}`);
console.log(`Cost: $${result.costUsd.toFixed(4)}`);
console.log(`Duration: ${result.durationMs}ms`);
console.log(`Turns: ${result.numTurns}`);
