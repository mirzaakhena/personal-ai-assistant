// src-v3/gateway/types.ts

/**
 * Common gateway interface.
 * All gateway implementations (console, whatsapp, webchat) implement this.
 */
export interface Gateway {
  /** Start the gateway (enter input loop, listen for connections, etc.) */
  start(): Promise<void>;
  /** Stop the gateway (cleanup resources, close connections) */
  stop(): Promise<void>;
}
