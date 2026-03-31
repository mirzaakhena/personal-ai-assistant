import { getMemoryDb, rid } from '../db/memory.js';
import { getOrCreateSelfPerson } from './operations.js';
import { generateEmbedding } from './embeddings.js';
import { log } from '../utils/logger.js';

// --- In-memory message tracking per phone number ---

export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const sessionMessages = new Map<string, ConversationMessage[]>();

export function trackMessage(
  phoneNumber: string,
  role: 'user' | 'assistant',
  content: string,
): void {
  const messages = sessionMessages.get(phoneNumber) ?? [];
  messages.push({ role, content });
  sessionMessages.set(phoneNumber, messages);
}

export function getTrackedMessages(
  phoneNumber: string,
): ConversationMessage[] {
  return sessionMessages.get(phoneNumber) ?? [];
}

export function clearTrackedMessages(phoneNumber: string): void {
  sessionMessages.delete(phoneNumber);
}

// --- Conversation summary generation ---

export interface ConversationSummaryResult {
  summary: string;
  topics: string[];
  key_decisions: string[];
}

const SUMMARY_PROMPT = `You are a conversation summarizer. Given a list of messages from a WhatsApp conversation between a user and an AI assistant, produce a JSON object with exactly these fields:

- "summary": A concise 1-3 sentence summary of what was discussed.
- "topics": An array of topic keywords/phrases discussed (max 5).
- "key_decisions": An array of decisions, action items, or important outcomes from the conversation (empty array if none).

Respond ONLY with the JSON object, no markdown fences or extra text.`;

/**
 * Generate a conversation summary using the Anthropic API.
 * Returns null if messages are empty, API key is missing, or on error.
 */
export async function generateConversationSummary(
  messages: ConversationMessage[],
): Promise<ConversationSummaryResult | null> {
  if (messages.length === 0) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.error('[SUMMARIZER] ANTHROPIC_API_KEY not set, skipping summary');
    return null;
  }

  // Format messages for the prompt
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SUMMARY_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Here is the conversation:\n\n${transcript}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      log.error(`[SUMMARIZER] API error: ${response.status}`);
      return null;
    }

    const json = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const text = json.content?.[0]?.text;
    if (!text) return null;

    const parsed = JSON.parse(text) as ConversationSummaryResult;

    // Validate shape
    if (
      typeof parsed.summary !== 'string' ||
      !Array.isArray(parsed.topics) ||
      !Array.isArray(parsed.key_decisions)
    ) {
      log.error('[SUMMARIZER] Invalid response shape from API');
      return null;
    }

    return parsed;
  } catch (err) {
    log.error('[SUMMARIZER] Failed to generate summary', err);
    return null;
  }
}

// --- Save conversation summary to SurrealDB ---

/**
 * Save a conversation summary to the graph database.
 * Creates a conversation_summary node and a had_conversation edge from the user's person node.
 * Optionally generates an embedding for semantic search.
 * Returns the record ID of the created conversation_summary.
 */
export async function saveConversationSummary(
  phoneNumber: string,
  data: ConversationSummaryResult,
): Promise<string> {
  const db = getMemoryDb();
  const selfId = await getOrCreateSelfPerson(phoneNumber);

  // Generate embedding if enabled
  let embedding: number[] | null = null;
  if (process.env.MEMORY_EMBEDDING_ENABLED === 'true') {
    const text = `${data.summary} ${data.topics.join(' ')} ${data.key_decisions.join(' ')}`;
    if (text.trim().length > 0) {
      embedding = await generateEmbedding(text);
    }
  }

  const embeddingClause = embedding
    ? `, embedding = $embedding`
    : `, embedding = NONE`;

  const created = await db.query<[Array<{ id: unknown }>]>(
    `CREATE conversation_summary SET summary = $summary, topics = $topics, key_decisions = $key_decisions, access_count = 0${embeddingClause}`,
    embedding
      ? {
          summary: data.summary,
          topics: data.topics,
          key_decisions: data.key_decisions,
          embedding,
        }
      : {
          summary: data.summary,
          topics: data.topics,
          key_decisions: data.key_decisions,
        },
  );

  const recordId = String(
    (created[0]![0] as { id: unknown }).id,
  );

  // Create had_conversation edge from person to summary
  await db.query(`RELATE $selfId->had_conversation->$summaryId`, {
    selfId: rid(selfId),
    summaryId: rid(recordId),
  });

  return recordId;
}

/**
 * Generate and save a conversation summary for the current session.
 * Called before clearing a session (e.g., on /new command).
 * Silently returns if there are no messages or summary generation fails.
 */
export async function summarizeAndSave(
  phoneNumber: string,
): Promise<string | null> {
  const messages = getTrackedMessages(phoneNumber);
  if (messages.length === 0) return null;

  const result = await generateConversationSummary(messages);
  if (!result) return null;

  try {
    const recordId = await saveConversationSummary(phoneNumber, result);
    log.debug(
      `[SUMMARIZER] ${phoneNumber} | saved summary ${recordId} (${messages.length} messages, ${result.topics.length} topics)`,
    );
    return recordId;
  } catch (err) {
    log.error('[SUMMARIZER] Failed to save summary', err);
    return null;
  }
}
