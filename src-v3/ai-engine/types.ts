// src-v3/ai-engine/types.ts

/**
 * Callbacks for consumers to react to query events.
 * All callbacks are optional — provide only what you need.
 */
export interface QueryCallbacks {
  /** Called for each assistant text response */
  onMessage?: (text: string) => void;
  /** Called when a tool is invoked (tool name provided) */
  onToolUse?: (name: string) => void;
  /** Called once when the session ID becomes available */
  onSessionId?: (id: string) => void;
}

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
