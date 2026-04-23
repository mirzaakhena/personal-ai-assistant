// src/gateway/types.ts

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
}
