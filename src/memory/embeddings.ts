/**
 * Vector embedding generation for memory semantic search.
 *
 * Provider is configured via MEMORY_EMBEDDING_PROVIDER env var.
 * Currently supports: "openai" (text-embedding-3-small, 1536 dims).
 * Returns null when no provider is configured or on error.
 */

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 means identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Generate a vector embedding for the given text.
 * Returns null if no provider is configured, API key is missing, or on error.
 */
export async function generateEmbedding(
  text: string,
): Promise<number[] | null> {
  const provider = process.env.MEMORY_EMBEDDING_PROVIDER;
  if (!provider) return null;

  switch (provider) {
    case 'openai':
      return generateOpenAIEmbedding(text);
    default:
      return null;
  }
}

async function generateOpenAIEmbedding(
  text: string,
): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) return null;

    const json = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return json.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}
