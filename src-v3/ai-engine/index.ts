// src-v3/ai-engine/index.ts

export { createAIEngine } from './query.js';
export type {
  AIEngine,
  EngineConfig,
  QueryOptions,
  QueryCallbacks,
  QueryResult,
  InitInfo,
  RateLimitInfo,
  QueryErrorInfo,
  QueryErrorReason,
  AssistantError,
  EffortLevel,
  ContentBlock,
  TextContentBlock,
  MediaContentBlock,
  ImageContentBlock,
  DocumentContentBlock,
} from './types.js';
