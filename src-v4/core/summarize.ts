// src-v4/core/summarize.ts

import { randomUUID } from 'node:crypto';
import { createAIEngine } from '../ai-engine/index.js';
import type { MessageStore, MessageRecord } from '../db/message.js';
import type { SessionStore } from '../db/sessions.js';
import type { SummarizeResult, SessionEndReason } from './types.js';
import { log } from '../utils/logger.js';

const SUMMARIZER_SYSTEM_PROMPT = `You are summarizing a conversation between a personal AI assistant and its user,
for the assistant's future self to remember context after a restart or session reset.

Output structure:
1. One paragraph narrative: what the user was working on, where the conversation
   was heading, their current emotional/mental state.
2. 3-7 bulleted key points. Each key point ends with <msg_ref id="MSG_ID"/>
   pointing to the message where the point was established.
3. A closing short note on the user's mood or energy.

Be concise but information-dense. Preserve nuance, not verbatim text. Your
future self can fetch any referenced message if more detail is needed.

Output in English regardless of the conversation language. Respond with the
summary text only — no preamble, no closing remarks about the summary itself.`;

function formatMessagesForSummarizer(msgs: MessageRecord[]): string {
  const parts = msgs.map((m) => {
    const body = (m.body ?? '')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<msg id="${m.id}" from="${m.sender}">${body}</msg>`;
  });
  return `<conversation>\n${parts.join('\n')}\n</conversation>`;
}

/**
 * Summarize the messages in a session and persist the result.
 *
 * - Loads messages belonging to sessionId from the per-user MessageStore.
 * - Calls the summarizer LLM (default: Haiku) with no MCP tools.
 * - Races against a configurable timeout — returns null on timeout or error.
 * - Stores the result in session_summaries on success.
 *
 * Returns null if the session has no messages, the timeout fires, or the
 * LLM call throws. Callers should either accept cold-start for the next
 * session or fall back to recent messages in the briefing.
 */
export async function summarizeSession(opts: {
  sessionId: string;
  userId: string;
  reason: SessionEndReason;
  messages: MessageStore;
  sessions: SessionStore;
  model: string;
  cwd: string;
  timeoutMs?: number;
  messageFetchCap?: number;
}): Promise<SummarizeResult | null> {
  const {
    sessionId,
    userId,
    reason,
    messages,
    sessions,
    model,
    cwd,
    timeoutMs = 30_000,
    messageFetchCap = 100,
  } = opts;

  const sessionMessages = messages
    .search({ limit: messageFetchCap, order: 'oldest' })
    .filter((m) => m.session_id === sessionId);

  if (sessionMessages.length === 0) {
    log.debug(`summarizeSession: no messages for session ${sessionId}, skipping`);
    return null;
  }

  const engine = createAIEngine({
    model,
    systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
    cwd,
    mcpServers: {},
    maxTurns: 1,
  });

  const prompt = formatMessagesForSummarizer(sessionMessages);

  try {
    const queryPromise = engine.query(prompt);
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    );
    const raced = await Promise.race([queryPromise, timeoutPromise]);

    if (raced === null) {
      log.debug(`summarizeSession: timeout for session ${sessionId}`);
      return null;
    }

    const endedAt = new Date();
    const result: SummarizeResult = {
      sessionId,
      userId,
      summary: raced.responseText,
      turns: sessionMessages.length,
      endedAt,
      endedReason: reason,
    };

    sessions.saveSummary({
      id: randomUUID(),
      session_id: sessionId,
      user_id: userId,
      summary: result.summary,
      turns: result.turns,
      ended_at: endedAt.toISOString(),
      ended_reason: reason,
      created_at: new Date().toISOString(),
    });

    return result;
  } catch (err) {
    log.error(`summarizeSession failed for session ${sessionId}`, err);
    return null;
  }
}
