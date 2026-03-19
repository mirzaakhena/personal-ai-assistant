import { generateEmbedding, cosineSimilarity } from './embeddings.js';
import {
  MEMORY_DECAY_HALF_LIFE_DAYS,
  MEMORY_VECTOR_WEIGHT,
  MEMORY_KEYWORD_WEIGHT,
  MEMORY_RECENCY_WEIGHT,
} from '../core/constants.js';

// Recency scoring constants
const DECAY_LAMBDA = Math.log(2) / MEMORY_DECAY_HALF_LIFE_DAYS;

// Keyword-only mode weights (when embeddings disabled)
const KEYWORD_ONLY_KEYWORD_WEIGHT = 0.7;
const KEYWORD_ONLY_RECENCY_WEIGHT = 0.3;

export type SearchableItem = Record<string, unknown>;

export interface ScoredSearchOptions {
  /** Extract the created_at value for recency scoring. If omitted, recency score defaults to 0.5. */
  getCreatedAt?: (item: SearchableItem) => unknown;
  /** Extract the importance level for recency scoring (fundamental items get recency=1.0). */
  getImportance?: (item: SearchableItem) => string | undefined;
  /** Extract the embedding vector for hybrid search. */
  getEmbedding?: (item: SearchableItem) => number[] | undefined;
  /** Max results to return. If omitted, returns all matches. */
  limit?: number;
}

/**
 * Calculate recency score using exponential decay.
 * Returns a value between 0 and 1, where 1 means "just created".
 * Fundamental memories always return 1.0 (skip decay).
 */
export function calculateRecencyScore(
  createdAt: unknown,
  importance?: string,
): number {
  if (importance === 'fundamental') return 1.0;
  if (!createdAt) return 0.5;
  let ms: number;
  if (createdAt instanceof Date) {
    ms = createdAt.getTime();
  } else if (
    typeof createdAt === 'object' &&
    createdAt !== null &&
    'getTime' in createdAt &&
    typeof (createdAt as { getTime: unknown }).getTime === 'function'
  ) {
    ms = (createdAt as { getTime(): number }).getTime();
  } else {
    const str =
      typeof createdAt === 'string'
        ? createdAt
        : String(createdAt);
    ms = new Date(str).getTime();
  }
  if (isNaN(ms)) return 0.5;
  const daysSinceCreation = (Date.now() - ms) / (1000 * 60 * 60 * 24);
  return Math.exp(-DECAY_LAMBDA * Math.max(0, daysSinceCreation));
}

/**
 * Generic scored search over items using keyword matching + optional vector similarity + recency decay.
 *
 * @param items - Array of items to search
 * @param query - Search query string (tokenized by whitespace)
 * @param getSearchText - Function to extract searchable text from each item
 * @param options - Optional configuration for recency, importance, embeddings, and limit
 * @returns Matched items sorted by score descending (internal _score removed)
 */
export async function scoredSearch<T extends SearchableItem>(
  items: T[],
  query: string,
  getSearchText: (item: T) => string,
  options: ScoredSearchOptions = {},
): Promise<T[]> {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  const totalTokens = tokens.length;

  // Check if embeddings are enabled and generate query embedding
  const embeddingsEnabled = process.env.MEMORY_EMBEDDING_ENABLED === 'true';
  let queryEmbedding: number[] | null = null;
  if (embeddingsEnabled) {
    queryEmbedding = await generateEmbedding(query);
  }
  const useHybrid = queryEmbedding !== null;

  // Determine weights based on whether hybrid mode is active
  const keywordWeight = useHybrid ? MEMORY_KEYWORD_WEIGHT : KEYWORD_ONLY_KEYWORD_WEIGHT;
  const recencyWeight = useHybrid ? MEMORY_RECENCY_WEIGHT : KEYWORD_ONLY_RECENCY_WEIGHT;
  const vectorWeight = useHybrid ? MEMORY_VECTOR_WEIGHT : 0;

  const results: Array<T & { _score: number }> = [];

  for (const item of items) {
    const searchText = getSearchText(item).toLowerCase();

    let matchedTokens = 0;
    for (const token of tokens) {
      if (searchText.includes(token)) {
        matchedTokens++;
      }
    }

    let vectorScore = 0;
    if (useHybrid && queryEmbedding) {
      const itemEmbedding = options.getEmbedding?.(item);
      if (itemEmbedding && Array.isArray(itemEmbedding) && itemEmbedding.length > 0) {
        vectorScore = (cosineSimilarity(queryEmbedding, itemEmbedding) + 1) / 2;
      }
    }

    const hasKeywordMatch = matchedTokens > 0;
    const hasVectorMatch = vectorScore > 0.5;

    if (hasKeywordMatch || (useHybrid && hasVectorMatch)) {
      const keywordScore = matchedTokens / totalTokens;
      const createdAt = options.getCreatedAt?.(item);
      const importance = options.getImportance?.(item);
      const recencyScore = calculateRecencyScore(createdAt, importance);
      const finalScore =
        vectorWeight * vectorScore +
        keywordWeight * keywordScore +
        recencyWeight * recencyScore;
      results.push({ ...item, _score: finalScore });
    }
  }

  results.sort((a, b) => b._score - a._score);

  const limited = options.limit ? results.slice(0, options.limit) : results;

  return limited.map(({ _score, ...rest }) => rest) as T[];
}
