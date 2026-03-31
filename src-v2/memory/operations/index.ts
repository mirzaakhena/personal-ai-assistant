// Barrel re-export — all consumers import from 'memory/operations' as before
export { SEARCHABLE_FIELDS, type MemoryTable } from './shared.js';
export { bumpAccess } from './shared.js';
export {
  getOrCreateSelfPerson,
  upsertContact,
  buildEmbeddingText,
  saveMemory,
  updateMemory,
  deleteMemory,
  supersedeMemory,
} from './crud.js';
export {
  type FundamentalMemories,
  getFundamentalMemories,
  recallMemories,
  getAllMemories,
  recallConversations,
} from './query.js';
export {
  getRelationships,
  type RelationshipQueryType,
  queryRelationships,
} from './graph.js';
export {
  type ImportanceSuggestion,
  getImportanceSuggestions,
} from './lifecycle.js';
