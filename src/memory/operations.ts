import { StringRecordId } from 'surrealdb';
import { getMemoryDb } from '../db/memory.js';
import {
  MEMORY_FUNDAMENTAL_LIMIT,
  MEMORY_DECAY_HALF_LIFE_DAYS,
  MEMORY_VECTOR_WEIGHT,
  MEMORY_KEYWORD_WEIGHT,
  MEMORY_RECENCY_WEIGHT,
  MEMORY_PROMOTION_ACCESS_THRESHOLD,
  MEMORY_DEMOTION_INACTIVE_DAYS,
} from '../core/constants.js';
import { generateEmbedding, cosineSimilarity } from './embeddings.js';

// Maps memory table to its edge table
const EDGE_TABLE_MAP: Record<string, string> = {
  preference: 'has_preference',
  fact: 'has_fact',
  routine: 'has_routine',
  persona: 'prefers_persona',
};

// All edge tables for cleanup
const ALL_EDGE_TABLES = [
  'has_preference',
  'has_fact',
  'has_routine',
  'prefers_persona',
];

// Searchable fields per table
const SEARCHABLE_FIELDS: Record<string, string[]> = {
  preference: ['value', 'category', 'context'],
  fact: ['content', 'category'],
  routine: ['activity', 'schedule', 'details'],
  persona: ['name', 'personality_traits', 'communication_style'],
};

type MemoryTable = 'preference' | 'fact' | 'routine' | 'persona';

// Recency scoring constants
const DECAY_LAMBDA = Math.log(2) / MEMORY_DECAY_HALF_LIFE_DAYS;
// Keyword-only mode weights (when embeddings disabled)
const KEYWORD_ONLY_KEYWORD_WEIGHT = 0.7;
const KEYWORD_ONLY_RECENCY_WEIGHT = 0.3;

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
  if (!createdAt) return 0.5; // default for missing timestamps
  // SurrealDB may return a Datetime object, a JS Date, or a string
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
    // Convert string or SurrealDB Datetime (which has .toISOString()) to Date
    const str =
      typeof createdAt === 'string'
        ? createdAt
        : String(createdAt);
    ms = new Date(str).getTime();
  }
  if (isNaN(ms)) return 0.5; // fallback for unparseable dates
  const daysSinceCreation = (Date.now() - ms) / (1000 * 60 * 60 * 24);
  return Math.exp(-DECAY_LAMBDA * Math.max(0, daysSinceCreation));
}

/**
 * Convert a record result to a string record ID.
 */
function toRecordIdStr(result: unknown): string {
  if (result && typeof result === 'object' && 'id' in result) {
    return String((result as { id: unknown }).id);
  }
  throw new Error('Could not extract record ID from result');
}

/**
 * Wrap a string record ID (e.g. "person:abc") into a StringRecordId
 * so SurrealDB treats it as a record reference, not a plain string.
 */
function rid(id: string): StringRecordId {
  return new StringRecordId(id);
}

// --- Person operations ---

export async function getOrCreateSelfPerson(
  phoneNumber: string,
): Promise<string> {
  const db = getMemoryDb();
  const result = await db.query<[Array<{ id: unknown }>]>(
    `SELECT id FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );

  if (result[0] && result[0].length > 0) {
    return String(result[0][0]!.id);
  }

  const created = await db.query<[Array<{ id: unknown }>]>(
    `CREATE person SET name = NONE, phone = $phone, type = 'self'`,
    { phone: phoneNumber },
  );
  return toRecordIdStr(created[0]![0]);
}

export async function upsertContact(
  phoneNumber: string,
  contactName: string,
  relationship: string,
  notes?: string,
): Promise<string> {
  const db = getMemoryDb();
  const selfId = await getOrCreateSelfPerson(phoneNumber);

  // Check if contact already exists (by name, scoped to this user's knows edges)
  const existing = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT ->knows->person.* AS contacts FROM $selfId`,
    { selfId: rid(selfId) },
  );
  const contacts =
    ((existing[0]?.[0] as { contacts?: Array<{ id: unknown; name: string }> })
      ?.contacts ?? []);
  const existingContact = contacts.find((c) => c.name === contactName);

  let contactId: string;
  if (existingContact) {
    contactId = String(existingContact.id);
    // Update existing contact notes
    if (notes !== undefined) {
      await db.query(`UPDATE $contactId SET notes = $notes`, {
        contactId: rid(contactId),
        notes,
      });
    }
    // Update the knows edge relationship_type
    await db.query(
      `UPDATE knows SET relationship_type = $rel, notes = $notes WHERE in = $selfId AND out = $contactId`,
      {
        rel: relationship,
        notes: notes ?? 'NONE',
        selfId: rid(selfId),
        contactId: rid(contactId),
      },
    );
  } else {
    // Create new contact
    const created = await db.query<[Array<{ id: unknown }>]>(
      `CREATE person SET name = $name, type = 'contact', notes = $notes`,
      { name: contactName, notes: notes ?? 'NONE' },
    );
    contactId = toRecordIdStr(created[0]![0]);

    // Create knows edge
    await db.query(
      `RELATE $selfId->knows->$contactId SET relationship_type = $rel, notes = $notes`,
      {
        selfId: rid(selfId),
        contactId: rid(contactId),
        rel: relationship,
        notes: notes ?? 'NONE',
      },
    );
  }

  return contactId;
}

// --- Memory save/update/delete ---

/**
 * Build a text string from memory data for embedding generation.
 * Concatenates all string values from the data record.
 */
function buildEmbeddingText(
  table: MemoryTable,
  data: Record<string, unknown>,
): string {
  const fields = SEARCHABLE_FIELDS[table] ?? [];
  return fields
    .map((f) => String(data[f] ?? ''))
    .filter((s) => s.length > 0)
    .join(' ');
}

export async function saveMemory(
  phoneNumber: string,
  table: MemoryTable,
  data: Record<string, unknown>,
): Promise<string> {
  const db = getMemoryDb();
  const selfId = await getOrCreateSelfPerson(phoneNumber);
  const edgeTable = EDGE_TABLE_MAP[table];

  // Generate embedding if enabled (check env var at runtime for togglability)
  let embedding: number[] | null = null;
  if (process.env.MEMORY_EMBEDDING_ENABLED === 'true') {
    const text = buildEmbeddingText(table, data);
    if (text.length > 0) {
      embedding = await generateEmbedding(text);
    }
  }

  // Build SET clause from data
  const fields = Object.entries(data)
    .map(([key]) => `${key} = $${key}`)
    .join(', ');

  const embeddingClause = embedding
    ? `, embedding = $embedding`
    : `, embedding = NONE`;

  const created = await db.query<[Array<{ id: unknown }>]>(
    `CREATE ${table} SET ${fields}, access_count = 0${embeddingClause}`,
    embedding ? { ...data, embedding } : data,
  );
  const recordId = toRecordIdStr(created[0]![0]);

  // Create edge from self to new memory
  await db.query(`RELATE $selfId->${edgeTable}->$recordId`, {
    selfId: rid(selfId),
    recordId: rid(recordId),
  });

  return recordId;
}

export async function updateMemory(
  recordId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = getMemoryDb();
  const fields = Object.entries(data)
    .map(([key]) => `${key} = $${key}`)
    .join(', ');

  await db.query(`UPDATE $recordId SET ${fields}`, {
    recordId: rid(recordId),
    ...data,
  });
}

export async function deleteMemory(recordId: string): Promise<void> {
  const db = getMemoryDb();

  // Delete all edges pointing to this record
  for (const edgeTable of ALL_EDGE_TABLES) {
    await db.query(`DELETE FROM ${edgeTable} WHERE out = $recordId`, {
      recordId: rid(recordId),
    });
  }
  // Also delete knows edges if it's a person
  await db.query(`DELETE FROM knows WHERE out = $recordId`, {
    recordId: rid(recordId),
  });

  // Delete the node itself
  await db.query(`DELETE $recordId`, { recordId: rid(recordId) });
}

export async function supersedeMemory(
  oldRecordId: string,
  phoneNumber: string,
  table: string,
  newData: Record<string, unknown>,
): Promise<string> {
  const newId = await saveMemory(phoneNumber, table as MemoryTable, newData);

  const db = getMemoryDb();
  await db.query(`UPDATE $oldId SET superseded_by = $newId`, {
    oldId: rid(oldRecordId),
    newId: rid(newId),
  });

  return newId;
}

// --- Query operations ---

async function bumpAccess(recordIds: string[]): Promise<void> {
  if (recordIds.length === 0) return;
  const db = getMemoryDb();
  for (const id of recordIds) {
    await db.query(
      `UPDATE $id SET access_count = access_count + 1, last_accessed = time::now()`,
      { id: rid(id) },
    );
  }
}

export interface FundamentalMemories {
  profile: Record<string, unknown> | null;
  persona: Record<string, unknown> | null;
  preferences: Record<string, unknown>[];
  facts: Record<string, unknown>[];
  routines: Record<string, unknown>[];
}

export async function getFundamentalMemories(
  phoneNumber: string,
): Promise<FundamentalMemories> {
  const db = getMemoryDb();
  const empty: FundamentalMemories = {
    profile: null,
    persona: null,
    preferences: [],
    facts: [],
    routines: [],
  };

  // Find self person
  const selfResult = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );
  if (!selfResult[0] || selfResult[0].length === 0) return empty;

  const selfPerson = selfResult[0][0]!;
  const selfId = String(selfPerson.id);

  // Traverse edges for fundamental memories
  const [prefResult, factResult, routineResult, personaResult] =
    await Promise.all([
      db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->has_preference->preference.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      ),
      db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->has_fact->fact.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      ),
      db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->has_routine->routine.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      ),
      db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->prefers_persona->persona.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      ),
    ]);

  const allPrefs = (
    (prefResult[0]?.[0] as { items?: Record<string, unknown>[] })?.items ?? []
  )
    .filter((p) => p.importance === 'fundamental')
    .slice(0, MEMORY_FUNDAMENTAL_LIMIT);

  const allFacts = (
    (factResult[0]?.[0] as { items?: Record<string, unknown>[] })?.items ?? []
  )
    .filter((f) => f.importance === 'fundamental' && !f.superseded_by)
    .slice(0, MEMORY_FUNDAMENTAL_LIMIT);

  const allRoutines = (
    (routineResult[0]?.[0] as { items?: Record<string, unknown>[] })?.items ??
    []
  )
    .filter((r) => r.importance === 'fundamental')
    .slice(0, MEMORY_FUNDAMENTAL_LIMIT);

  const personas =
    (personaResult[0]?.[0] as { items?: Record<string, unknown>[] })?.items ??
    [];

  // Bump access counts
  const allIds = [
    ...allPrefs.map((p) => String(p.id)),
    ...allFacts.map((f) => String(f.id)),
    ...allRoutines.map((r) => String(r.id)),
    ...personas.map((p) => String(p.id)),
  ];
  await bumpAccess(allIds);

  return {
    profile: selfPerson,
    persona: personas.length > 0 ? personas[0]! : null,
    preferences: allPrefs,
    facts: allFacts,
    routines: allRoutines,
  };
}

export async function recallMemories(
  phoneNumber: string,
  query: string,
): Promise<Record<string, unknown>[]> {
  const db = getMemoryDb();

  // Find self person
  const selfResult = await db.query<[Array<{ id: unknown }>]>(
    `SELECT id FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );
  if (!selfResult[0] || selfResult[0].length === 0) return [];

  const selfId = String(selfResult[0][0]!.id);

  // Tokenize query
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  const totalTokens = tokens.length;

  // Check if embeddings are enabled and generate query embedding
  const embeddingsEnabled =
    process.env.MEMORY_EMBEDDING_ENABLED === 'true';
  let queryEmbedding: number[] | null = null;
  if (embeddingsEnabled) {
    queryEmbedding = await generateEmbedding(query);
  }
  const useHybrid = queryEmbedding !== null;

  // Determine weights based on whether hybrid mode is active
  const keywordWeight = useHybrid
    ? MEMORY_KEYWORD_WEIGHT
    : KEYWORD_ONLY_KEYWORD_WEIGHT;
  const recencyWeight = useHybrid
    ? MEMORY_RECENCY_WEIGHT
    : KEYWORD_ONLY_RECENCY_WEIGHT;
  const vectorWeight = useHybrid ? MEMORY_VECTOR_WEIGHT : 0;

  // Search across all memory tables
  const results: Array<Record<string, unknown> & { _score: number }> = [];

  for (const [table, fields] of Object.entries(SEARCHABLE_FIELDS)) {
    const edgeTable = EDGE_TABLE_MAP[table]!;

    // Get all memories for this user in this table
    const queryResult = await db.query<[Array<Record<string, unknown>>]>(
      `SELECT ->${edgeTable}->${table}.* AS items FROM $selfId`,
      { selfId: rid(selfId) },
    );
    const items =
      (queryResult[0]?.[0] as { items?: Record<string, unknown>[] })?.items ??
      [];

    for (const item of items) {
      // Skip superseded facts
      if (item.superseded_by) continue;

      // Concatenate all searchable fields
      const searchText = fields
        .map((f) => String(item[f] ?? ''))
        .join(' ')
        .toLowerCase();

      // Count matched tokens
      let matchedTokens = 0;
      for (const token of tokens) {
        if (searchText.includes(token)) {
          matchedTokens++;
        }
      }

      // Calculate vector similarity score if hybrid mode
      let vectorScore = 0;
      if (useHybrid && queryEmbedding) {
        const itemEmbedding = item.embedding as number[] | undefined;
        if (itemEmbedding && Array.isArray(itemEmbedding) && itemEmbedding.length > 0) {
          // Cosine similarity is in [-1, 1], normalize to [0, 1]
          vectorScore = (cosineSimilarity(queryEmbedding, itemEmbedding) + 1) / 2;
        }
      }

      // In hybrid mode, include results that match via keyword OR vector similarity
      const hasKeywordMatch = matchedTokens > 0;
      const hasVectorMatch = vectorScore > 0.5; // Normalized threshold (cosine > 0 in original space)

      if (hasKeywordMatch || (useHybrid && hasVectorMatch)) {
        const keywordScore = matchedTokens / totalTokens;
        const recencyScore = calculateRecencyScore(
          item.created_at as Date | string | undefined,
          item.importance as string | undefined,
        );
        const finalScore =
          vectorWeight * vectorScore +
          keywordWeight * keywordScore +
          recencyWeight * recencyScore;
        results.push({
          ...item,
          _score: finalScore,
        });
      }
    }
  }

  // Sort by score descending
  results.sort((a, b) => b._score - a._score);

  // Bump access counts
  const ids = results.map((r) => String(r.id));
  await bumpAccess(ids);

  // Remove internal _score from results
  return results.map(({ _score, ...rest }) => rest);
}

export async function getAllMemories(phoneNumber: string): Promise<{
  profile: Record<string, unknown> | null;
  preferences: Record<string, unknown>[];
  facts: Record<string, unknown>[];
  routines: Record<string, unknown>[];
  personas: Record<string, unknown>[];
  contacts: Record<string, unknown>[];
}> {
  const db = getMemoryDb();
  const empty = {
    profile: null,
    preferences: [],
    facts: [],
    routines: [],
    personas: [],
    contacts: [],
  };

  const selfResult = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );
  if (!selfResult[0] || selfResult[0].length === 0) return empty;

  const selfPerson = selfResult[0][0]!;
  const selfId = String(selfPerson.id);

  const [prefResult, factResult, routineResult, personaResult, contactResult] =
    await Promise.all([
      db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->has_preference->preference.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      ),
      db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->has_fact->fact.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      ),
      db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->has_routine->routine.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      ),
      db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->prefers_persona->persona.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      ),
      db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->knows->person.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      ),
    ]);

  return {
    profile: selfPerson,
    preferences:
      (prefResult[0]?.[0] as { items?: Record<string, unknown>[] })?.items ??
      [],
    facts:
      (factResult[0]?.[0] as { items?: Record<string, unknown>[] })?.items ??
      [],
    routines:
      (routineResult[0]?.[0] as { items?: Record<string, unknown>[] })?.items ??
      [],
    personas:
      (personaResult[0]?.[0] as { items?: Record<string, unknown>[] })?.items ??
      [],
    contacts:
      (contactResult[0]?.[0] as { items?: Record<string, unknown>[] })?.items ??
      [],
  };
}

export async function getRelationships(
  phoneNumber: string,
): Promise<Record<string, unknown>[]> {
  const db = getMemoryDb();

  const selfResult = await db.query<[Array<{ id: unknown }>]>(
    `SELECT id FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );
  if (!selfResult[0] || selfResult[0].length === 0) return [];

  const selfId = String(selfResult[0][0]!.id);

  // Get knows edges with contact details
  const result = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT out.name AS name, out.id AS contact_id, relationship_type, notes FROM knows WHERE in = $selfId`,
    { selfId: rid(selfId) },
  );

  return result[0] ?? [];
}

// --- Importance auto-promotion/demotion ---

export interface ImportanceSuggestion {
  record_id: string;
  table: string;
  current_importance: string;
  suggested_importance: string;
  reason: string;
}

/**
 * Get suggestions for promoting or demoting memory importance levels.
 * - Extended memories with access_count >= threshold → suggest promotion to fundamental
 * - Fundamental memories not accessed in 30+ days → suggest demotion to extended
 */
export async function getImportanceSuggestions(
  phoneNumber: string,
): Promise<ImportanceSuggestion[]> {
  const db = getMemoryDb();
  const suggestions: ImportanceSuggestion[] = [];

  // Find self person
  const selfResult = await db.query<[Array<{ id: unknown }>]>(
    `SELECT id FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );
  if (!selfResult[0] || selfResult[0].length === 0) return [];

  const selfId = String(selfResult[0][0]!.id);

  const memoryTables: MemoryTable[] = ['preference', 'fact', 'routine'];

  for (const table of memoryTables) {
    const edgeTable = EDGE_TABLE_MAP[table]!;

    const queryResult = await db.query<[Array<Record<string, unknown>>]>(
      `SELECT ->${edgeTable}->${table}.* AS items FROM $selfId`,
      { selfId: rid(selfId) },
    );
    const items =
      (queryResult[0]?.[0] as { items?: Record<string, unknown>[] })?.items ??
      [];

    for (const item of items) {
      // Skip superseded facts
      if (item.superseded_by) continue;

      const recordId = String(item.id);
      const importance = item.importance as string | undefined;
      const accessCount = (item.access_count as number) ?? 0;

      // Promotion: extended with high access count
      if (
        importance === 'extended' &&
        accessCount >= MEMORY_PROMOTION_ACCESS_THRESHOLD
      ) {
        suggestions.push({
          record_id: recordId,
          table,
          current_importance: 'extended',
          suggested_importance: 'fundamental',
          reason: `Accessed ${accessCount} times (threshold: ${MEMORY_PROMOTION_ACCESS_THRESHOLD})`,
        });
      }

      // Demotion: fundamental not accessed recently
      if (importance === 'fundamental') {
        const lastAccessed = item.last_accessed as
          | Date
          | string
          | undefined;
        if (lastAccessed) {
          let lastMs: number;
          if (lastAccessed instanceof Date) {
            lastMs = lastAccessed.getTime();
          } else if (
            typeof lastAccessed === 'object' &&
            lastAccessed !== null &&
            'getTime' in lastAccessed &&
            typeof (lastAccessed as { getTime: unknown }).getTime === 'function'
          ) {
            lastMs = (lastAccessed as { getTime(): number }).getTime();
          } else {
            lastMs = new Date(String(lastAccessed)).getTime();
          }

          if (!isNaN(lastMs)) {
            const daysSinceAccess =
              (Date.now() - lastMs) / (1000 * 60 * 60 * 24);
            if (daysSinceAccess >= MEMORY_DEMOTION_INACTIVE_DAYS) {
              suggestions.push({
                record_id: recordId,
                table,
                current_importance: 'fundamental',
                suggested_importance: 'extended',
                reason: `Not accessed for ${Math.floor(daysSinceAccess)} days (threshold: ${MEMORY_DEMOTION_INACTIVE_DAYS})`,
              });
            }
          }
        }
      }
    }
  }

  return suggestions;
}
