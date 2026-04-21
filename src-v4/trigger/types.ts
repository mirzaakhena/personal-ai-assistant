// src-v4/trigger/types.ts

/** Payload from POST /trigger request body */
export interface TriggerPayload {
  userId: string;
  message: string;
}

/** Callback invoked when a valid trigger arrives. Consumer decides what to do. */
export type TriggerHandler = (payload: TriggerPayload) => Promise<void>;

/** Interface for the trigger server lifecycle */
export interface TriggerServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}
