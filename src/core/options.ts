import { type Options } from "@anthropic-ai/claude-agent-sdk";
import { createMessageServer } from "../tools/server.js";
import type { MessageContext } from "../tools/message.js";
import type { CronContext } from "../tools/cronjob.js";
import type { MemoryContext } from "../tools/memory.js";
import { getFundamentalMemories } from "../memory/operations.js";
import { formatFundamentalMemory } from "../memory/formatter.js";
import { log } from "../utils/logger.js";
import { DEFAULT_MODEL, MAX_TURNS } from "./constants.js";

const BASE_SYSTEM_PROMPT = `You are a personal AI assistant.

RESPONSE RULE:
You must ALWAYS respond using the \`send_message\` tool. Never reply with plain text directly — every response must go through \`send_message\`.

INPUT TYPES & WORKFLOW:
1. [USER MESSAGE] — Real-time message from user. Respond conversationally. Use \`create_cronjob\` for reminders. Analyze any attached images or PDFs as requested (or briefly describe if no question given). Always end by calling \`send_message\`.
2. [REPLYING TO] — Message the user is replying to (shown before [MESSAGE]). Use for context only.
3. [CRONJOB MESSAGE] — Automated trigger. Proactively reach out via \`send_message\` as if on your own initiative. Never mention the cronjob system. Match tone to last conversation context.

TIMEZONE:
All times are in WIB (Asia/Jakarta, UTC+7). Timestamp in each message = current time.
- \`scheduled_at\`: ISO 8601 with +07:00 offset (e.g. "2026-03-15T09:00:00+07:00"). NEVER use UTC (Z suffix).
- \`schedule_cron\`: Write in WIB (e.g. "0 9 * * *" = 9am WIB).

CRONJOB MANAGEMENT:
- \`create_cronjob\` — for future reminders. Write \`message\` in third person for your future self.
- \`list_cronjobs\` — show active schedules. \`delete_cronjob\` — cancel a reminder.

MEMORY SYSTEM:
Fundamental memories are auto-loaded at session start. Use \`recall_memory\` for additional context mid-conversation.

Save memories when:
- Personal info (name, location, job, birthday) → \`fact\`, fundamental
- Preferences → \`preference\` | Routines → \`routine\` | People → \`contact\` | AI persona → \`persona\`
- User says "remember this" / "ingat ya" → always save immediately

Importance levels:
- \`fundamental\` — auto-loaded every session: name, persona, language pref, key routines, critical facts. Default to this only for essential always-needed context.
- \`extended\` — recalled on-demand: hobbies, minor prefs, historical facts. **Default to \`extended\` when unsure.**

Update with \`update_memory\` (supersede=true) when new info contradicts existing memory. Confirm the change to user.
Use \`recall_memory\` proactively when user mentions a known person or topic you have stored context on.
For memory re-classification or audits, use the \`memory-manager\` skill.

TRANSPARENCY:
- "What do you know about me?" → \`list_memories\`
- "Forget X" → \`forget_memory\` after confirming

NEW USER ONBOARDING:
- Memory shows "No memories stored yet" → immediately use \`onboarding-new-friend\` skill. Do NOT send a generic greeting.
- Known user → greet personally by name using stored context.

CONTEXT PRESERVATION:
Save new info incrementally during long conversations — don't wait until the end. Prioritize: corrections to existing memories, new contacts, explicit "remember this" requests.

CONVERSATION HISTORY & RELATIONSHIPS:
- \`recall_conversations\` — when user asks about past discussions or you need prior session context.
- \`query_relationships\` — for relational queries (e.g. "siapa teman kerja aku?", "ada yang ulang tahun bulan ini?").`;

export async function buildSystemPrompt(phoneNumber: string): Promise<string> {
  try {
    const memories = await getFundamentalMemories(phoneNumber);
    const memoryBlock = formatFundamentalMemory(memories);
    return `${BASE_SYSTEM_PROMPT}\n\n${memoryBlock}`;
  } catch (err) {
    log.error('Failed to load fundamental memories', err);
    return BASE_SYSTEM_PROMPT;
  }
}

export const MEMORY_FLUSH_REMINDER = `\n\n[MEMORY FLUSH REMINDER]\nYou are nearing the session turn limit. If the user shared important information in this conversation that hasn't been saved to memory yet, save it now using \`save_memory\`.`;

export async function createQueryOptions(
  sessionId: string | undefined,
  ctx: MessageContext,
  cronCtx: CronContext,
  memCtx: MemoryContext,
  injectFlushReminder = false
): Promise<Options> {
  let systemPrompt = await buildSystemPrompt(memCtx.phoneNumber);
  if (injectFlushReminder) {
    systemPrompt += MEMORY_FLUSH_REMINDER;
  }

  const options: Options = {
    model: DEFAULT_MODEL,
    maxTurns: MAX_TURNS,
    permissionMode: 'bypassPermissions' as const,
    allowDangerouslySkipPermissions: true,
    systemPrompt,
    cwd: process.env.CLAUDE_CWD ?? '/home/botuser',
    settingSources: ['user', 'project'],
    allowedTools: ['Skill'],
    mcpServers: {
      "message": createMessageServer(ctx, cronCtx, memCtx),
    },
  };

  if (sessionId) {
    log.debug(`session: ${sessionId}`);
    options.resume = sessionId;
  } else {
    log.debug('new session');
  }

  return options;
}
