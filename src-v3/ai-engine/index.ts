// src-v3/ai-engine/index.ts

export { createAIEngine } from './query.js';
export type {
  AIEngine,
  EngineConfig,
  QueryOptions,
  QueryCallbacks,
  QueryResult,
  SendMessageHandler,
  SendMessageItem,
  InitInfo,
  RateLimitInfo,
  QueryErrorInfo,
  QueryErrorReason,
  AssistantError,
  EffortLevel,
} from './types.js';
