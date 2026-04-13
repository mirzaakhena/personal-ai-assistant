// src-v3/ai-engine/types.ts

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

// ── Error types ──────────────────────────────────────────

/** Error reason from SDK result */
export type QueryErrorReason =
  | 'error_during_execution'
  | 'error_max_turns'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries';

/** Error from assistant message (API-level) */
export type AssistantError =
  | 'authentication_failed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens';

/** Error info passed to onError callback and included in QueryResult */
export interface QueryErrorInfo {
  /** Which level: result-level or assistant-level */
  level: 'result' | 'assistant';
  /** Error reason/type */
  reason: QueryErrorReason | AssistantError;
  /** Human-readable error messages (from SDK errors[] array, or single message) */
  messages: string[];
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
  /** Called on errors (result-level or assistant-level) */
  onError?: (error: QueryErrorInfo) => void;
  /** Called when query completes without send_message ever being invoked. Receives responseText if any. */
  onFallback?: (responseText: string) => void;
}

// ── Config & Options ─────────────────────────────────────

/** Effort level for the model */
export type EffortLevel = 'low' | 'medium' | 'high';

/** Engine-level configuration (factory defaults) */
export interface EngineConfig {
  /** Default model — overridable per-query */
  model?: string;
  /** Default system prompt — overridable per-query */
  systemPrompt?: string;
  /** Default max turns — overridable per-query */
  maxTurns?: number;
  /** Default effort level — overridable per-query. Defaults to 'low' */
  effort?: EffortLevel;
  /** MCP servers to register with the engine. Keys are server names. */
  mcpServers?: Record<string, any>;
}

/** Per-query options (override engine defaults) */
export interface QueryOptions {
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  effort?: EffortLevel;
  sessionId?: string;
  callbacks?: QueryCallbacks;
  /** Additional MCP servers for this query (merged with engine defaults) */
  mcpServers?: Record<string, any>;
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
  /** Whether send_message tool was called at least once */
  sendMessageCalled: boolean;
  /** Present if the query ended with an error */
  error?: QueryErrorInfo;
}
