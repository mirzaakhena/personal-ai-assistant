import { getMemoryDb, rid, extractItems } from '../db/memory.js';
import {
  MEMORY_FUNDAMENTAL_LIMIT,
  MEMORY_PROMOTION_ACCESS_THRESHOLD,
  MEMORY_DEMOTION_INACTIVE_DAYS,
} from '../core/constants.js';
import { generateEmbedding } from './embeddings.js';
import { scoredSearch } from './search.js';

// Re-export for backward compatibility (tests import from operations.ts)
export { calculateRecencyScore } from './search.js';

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

/**
 * Convert a record result to a string record ID.
 */
function toRecordIdStr(result: unknown): string {
  if (result && typeof result === 'object' && 'id' in result) {
    return String((result as { id: unknown }).id);
  }
  throw new Error('Could not extract record ID from result');
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

  const allPrefs = extractItems(prefResult)
    .filter((p) => p.importance === 'fundamental')
    .slice(0, MEMORY_FUNDAMENTAL_LIMIT);

  const allFacts = extractItems(factResult)
    .filter((f) => f.importance === 'fundamental' && !f.superseded_by)
    .slice(0, MEMORY_FUNDAMENTAL_LIMIT);

  const allRoutines = extractItems(routineResult)
    .filter((r) => r.importance === 'fundamental')
    .slice(0, MEMORY_FUNDAMENTAL_LIMIT);

  const personas = extractItems(personaResult);

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

  // Collect all non-superseded items across memory tables
  const allItems: Record<string, unknown>[] = [];

  for (const [table] of Object.entries(SEARCHABLE_FIELDS)) {
    const edgeTable = EDGE_TABLE_MAP[table]!;
    const queryResult = await db.query<[Array<Record<string, unknown>>]>(
      `SELECT ->${edgeTable}->${table}.* AS items FROM $selfId`,
      { selfId: rid(selfId) },
    );
    const items = extractItems(queryResult);

    for (const item of items) {
      if (item.superseded_by) continue;
      allItems.push(item);
    }
  }

  const results = await scoredSearch(
    allItems,
    query,
    (item) => {
      const table = String(item.id).split(':')[0];
      const fields = SEARCHABLE_FIELDS[table!] ?? [];
      return fields.map((f) => String(item[f] ?? '')).join(' ');
    },
    {
      getCreatedAt: (item) => item.created_at as Date | string | undefined,
      getImportance: (item) => item.importance as string | undefined,
      getEmbedding: (item) => item.embedding as number[] | undefined,
    },
  );

  // Bump access counts
  const ids = results.map((r) => String(r.id));
  await bumpAccess(ids);

  return results;
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
    preferences: extractItems(prefResult),
    facts: extractItems(factResult),
    routines: extractItems(routineResult),
    personas: extractItems(personaResult),
    contacts: extractItems(contactResult),
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

// --- Conversation recall ---

export async function recallConversations(
  phoneNumber: string,
  query: string,
  limit: number = 5,
): Promise<Record<string, unknown>[]> {
  const db = getMemoryDb();

  // Find self person
  const selfResult = await db.query<[Array<{ id: unknown }>]>(
    `SELECT id FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );
  if (!selfResult[0] || selfResult[0].length === 0) return [];

  const selfId = String(selfResult[0][0]!.id);

  const queryResult = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT ->had_conversation->conversation_summary.* AS items FROM $selfId`,
    { selfId: rid(selfId) },
  );
  const items = extractItems(queryResult);

  const results = await scoredSearch(
    items,
    query,
    (item) => {
      const summaryText = String(item.summary ?? '');
      const topicsText = ((item.topics as string[]) ?? []).join(' ');
      const decisionsText = ((item.key_decisions as string[]) ?? []).join(' ');
      return `${summaryText} ${topicsText} ${decisionsText}`;
    },
    {
      getCreatedAt: (item) => item.created_at as Date | string | undefined,
      getEmbedding: (item) => item.embedding as number[] | undefined,
      limit,
    },
  );

  // Bump access counts
  const ids = results.map((r) => String(r.id));
  await bumpAccess(ids);

  return results;
}

// --- Graph-powered relational queries ---

export type RelationshipQueryType =
  | 'contacts_by_attribute'
  | 'mutual_connections'
  | 'upcoming_birthdays'
  | 'related_memories';

export async function queryRelationships(
  phoneNumber: string,
  queryType: RelationshipQueryType,
  filters: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const db = getMemoryDb();

  // Find self person
  const selfResult = await db.query<[Array<{ id: unknown }>]>(
    `SELECT id FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );
  if (!selfResult[0] || selfResult[0].length === 0) return [];

  const selfId = String(selfResult[0][0]!.id);

  switch (queryType) {
    case 'contacts_by_attribute': {
      // Get all contacts via graph traversal, then filter by attributes
      const contactResult = await db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->knows->person.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      );
      const contacts = extractItems(contactResult);

      // Also get the edge data for relationship info
      const edgeResult = await db.query<[Array<Record<string, unknown>>]>(
        `SELECT out.id AS contact_id, out.name AS name, relationship_type FROM knows WHERE in = $selfId`,
        { selfId: rid(selfId) },
      );
      const edges = edgeResult[0] ?? [];
      const edgeMap = new Map(
        edges.map((e) => [String(e.contact_id), e]),
      );

      // Filter contacts by provided attribute filters
      return contacts.filter((c) => {
        const edge = edgeMap.get(String(c.id));
        for (const [key, value] of Object.entries(filters)) {
          // Check edge attributes (like relationship_type)
          if (key === 'relationship_type') {
            if (
              !edge ||
              !String(edge.relationship_type ?? '')
                .toLowerCase()
                .includes(String(value).toLowerCase())
            )
              return false;
          } else {
            const fieldValue = c[key];
            if (fieldValue === undefined || fieldValue === null) return false;
            if (
              !String(fieldValue)
                .toLowerCase()
                .includes(String(value).toLowerCase())
            )
              return false;
          }
        }
        return true;
      }).map((c) => {
        const edge = edgeMap.get(String(c.id));
        return {
          ...c,
          relationship_type: edge?.relationship_type ?? undefined,
        };
      });
    }

    case 'upcoming_birthdays': {
      const daysAhead = (filters.days_ahead as number) ?? 30;

      // Get all contacts with birthday info
      const contactResult = await db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->knows->person.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      );
      const contacts = extractItems(contactResult);

      const now = new Date();
      const results: Record<string, unknown>[] = [];

      for (const contact of contacts) {
        if (!contact.birthday) continue;
        const birthday = new Date(String(contact.birthday));
        if (isNaN(birthday.getTime())) continue;

        // Check if birthday falls within the next N days (this year or next)
        const thisYearBirthday = new Date(
          now.getFullYear(),
          birthday.getMonth(),
          birthday.getDate(),
        );
        let daysUntil =
          (thisYearBirthday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        if (daysUntil < 0) {
          // Birthday already passed this year, check next year
          const nextYearBirthday = new Date(
            now.getFullYear() + 1,
            birthday.getMonth(),
            birthday.getDate(),
          );
          daysUntil =
            (nextYearBirthday.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24);
        }
        if (daysUntil <= daysAhead) {
          results.push({ ...contact, days_until_birthday: Math.ceil(daysUntil) });
        }
      }

      // Sort by nearest birthday first
      results.sort(
        (a, b) =>
          (a.days_until_birthday as number) -
          (b.days_until_birthday as number),
      );
      return results;
    }

    case 'related_memories': {
      const personName = filters.person_name as string;
      if (!personName) return [];

      // Find the contact by name
      const contactResult = await db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->knows->person.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      );
      const contacts = extractItems(contactResult);

      const contact = contacts.find(
        (c) =>
          String(c.name ?? '')
            .toLowerCase()
            .includes(personName.toLowerCase()),
      );
      if (!contact) return [];

      // Search all memory types for mentions of this person's name
      const memories: Record<string, unknown>[] = [];
      for (const [table, fields] of Object.entries(SEARCHABLE_FIELDS)) {
        const edgeTable = EDGE_TABLE_MAP[table]!;
        const queryResult = await db.query<[Array<Record<string, unknown>>]>(
          `SELECT ->${edgeTable}->${table}.* AS items FROM $selfId`,
          { selfId: rid(selfId) },
        );
        const items = extractItems(queryResult);

        for (const item of items) {
          if (item.superseded_by) continue;
          const searchText = fields
            .map((f) => String(item[f] ?? ''))
            .join(' ')
            .toLowerCase();
          if (searchText.includes(personName.toLowerCase())) {
            memories.push(item);
          }
        }
      }

      // Also get the edge info for this contact
      const edgeResult = await db.query<[Array<Record<string, unknown>>]>(
        `SELECT relationship_type, notes FROM knows WHERE in = $selfId AND out = $contactId`,
        { selfId: rid(selfId), contactId: rid(String(contact.id)) },
      );
      const edge = edgeResult[0]?.[0];

      return [
        {
          ...contact,
          type: 'contact_info',
          relationship_type: edge?.relationship_type,
          relationship_notes: edge?.notes,
        },
        ...memories.map((m) => ({
          ...m,
          type: 'related_memory',
        })),
      ];
    }

    case 'mutual_connections': {
      // For now, return all contacts (mutual connections require multi-user contacts, which is future work)
      const contactResult = await db.query<[Array<Record<string, unknown>>]>(
        `SELECT out.id AS contact_id, out.name AS name, relationship_type, notes FROM knows WHERE in = $selfId`,
        { selfId: rid(selfId) },
      );
      return contactResult[0] ?? [];
    }

    default:
      return [];
  }
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
    const items = extractItems(queryResult);

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
