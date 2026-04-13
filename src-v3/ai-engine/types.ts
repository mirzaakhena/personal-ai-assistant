// src-v3/ai-engine/types.ts

// ── send_message tool types ──────────────────────────────

/** A single message from the send_message tool */
export interface SendMessageItem {
  content: string;
  pauseBeforeTyping: number;
}

/** Handler for send_message tool invocations */
export type SendMessageHandler = (messages: SendMessageItem[]) => Promise<void> | void;

// ── Callback info types ──────────────────────────────────

/** Info from system.init message */
export interface InitInfo {
  model: string;
  cwd: string;
  tools: string[];
  mcpServers: Array<{ name: string; status: string }>;
  sessionId: string;
}

/** Info from rate_limit_event message */
export interface RateLimitInfo {
  resetsAt: string;
  remaining: number;
}

// ── Callbacks ────────────────────────────────────────────

/**
 * Callbacks for consumers to react to query events.
 * All callbacks are optional — provide only what you need.
 */
export interface QueryCallbacks {
  /** Called when session initializes — provides model, tools, mcp server info */
  onInit?: (info: InitInfo) => void;
  /** Called for each assistant thinking block */
  onThinking?: (text: string) => void;
  /** Called for each assistant text response */
  onMessage?: (text: string) => void;
  /** Called when a tool is invoked (tool name provided) */
  onToolUse?: (name: string) => void;
  /** Called once when the session ID becomes available */
  onSessionId?: (id: string) => void;
  /** Called on rate limit events */
  onRateLimit?: (info: RateLimitInfo) => void;
}

// ── Config & Options ─────────────────────────────────────

/** Engine-level configuration (factory defaults) */
export interface EngineConfig {
  /** Default model — overridable per-query */
  model?: string;
  /** Default system prompt — overridable per-query */
  systemPrompt?: string;
  /** Default max turns — overridable per-query */
  maxTurns?: number;
  /** Handler called when send_message tool is invoked. Falls back to console.log */
  onSendMessage?: SendMessageHandler;
}

/** Per-query options (override engine defaults) */
export interface QueryOptions {
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  sessionId?: string;
  callbacks?: QueryCallbacks;
}

// ── Engine interface ─────────────────────────────────────

/** The engine instance returned by createAIEngine */
export interface AIEngine {
  query: (prompt: string, options?: QueryOptions) => Promise<QueryResult>;
}

// ── Result ───────────────────────────────────────────────

/**
 * Result returned after a query completes.
 */
export interface QueryResult {
  sessionId: string;
  responseText: string;
  costUsd: number;
  durationMs: number;
  numTurns: number;
}
