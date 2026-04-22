// src-v4/core/summarize.ts

import { randomUUID } from 'node:crypto';
import { createAIEngine } from '../ai-engine/index.js';
import type { MessageStore, MessageRecord } from '../db/message.js';
import type { SessionStore } from '../db/sessions.js';
import type { SummarizeResult, SessionEndReason } from './types.js';
import { log } from '../utils/logger.js';

const SUMMARIZER_SYSTEM_PROMPT = `You are summarizing a conversation between a personal AI assistant and its user,
for the assistant's future self to remember context after a restart or session reset.

Be concise but information-dense. Preserve nuance, not verbatim text. Your
future self can fetch any referenced message if more detail is needed.

Output in English regardless of the conversation language.

Output format — produce exactly this XML structure, no other text:

<narrative>
One or two natural sentences summarizing what happened this session — what the user worked on, where the conversation was heading, and their mental/emotional state at the close.
</narrative>
<key_points>
<key_point msg_ref="MESSAGE_ID">One sentence describing a salient moment.</key_point>
<key_point msg_ref="MESSAGE_ID">Another salient moment.</key_point>
(3 to 7 total; each msg_ref is the id of the most relevant message to that point)
</key_points>
<mood>Short phrase describing the user's emotional/energetic state at session end.</mood>`;

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

  const sessionMessages = messages.getMessagesForSession(sessionId, { limit: messageFetchCap });

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

    // Clear the active session row so the next boot / next user message
    // starts a fresh session that picks up the just-saved summary via
    // <last_session_summary> in the wake-up briefing. Without this, the
    // SDK keeps resuming the old session and the summary never surfaces.
    sessions.delete();

    return result;
  } catch (err) {
    log.error(`summarizeSession failed for session ${sessionId}`, err);
    return null;
  }
}
