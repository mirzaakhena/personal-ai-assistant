// src-v4/gateway/types.ts

import type { MessageStore } from '../db/message.js';
import type { SessionStore } from '../db/sessions.js';

/**
 * Gateway is the conversation adapter — owns the input loop,
 * AI query flow, and output delivery. Each gateway is self-contained.
 *
 * By design, only one gateway is active per runtime.
 * Implementations: console (testing), telegram.
 */
export interface Gateway {
  /** Start the gateway (enter input loop, listen for connections, etc.) */
  start(): Promise<void>;
  /** Stop the gateway (cleanup resources, close connections) */
  stop(): Promise<void>;
  /**
   * Return currently-active user sessions, for the orchestrator to summarize
   * on graceful shutdown. Returns an empty array when no users are active.
   */
  getActiveSessions(): ActiveSessionInfo[];
}

export interface ActiveSessionInfo {
  sessionId: string;
  userId: string;
  cwd: string;
  messages: MessageStore;
  sessions: SessionStore;
}
