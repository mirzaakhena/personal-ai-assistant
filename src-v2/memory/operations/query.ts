import { getMemoryDb, rid, extractItems } from '../../db/memory.js';
import { MEMORY_FUNDAMENTAL_LIMIT } from '../../core/constants.js';
import { scoredSearch } from '../search.js';
import { EDGE_TABLE_MAP, SEARCHABLE_FIELDS, bumpAccess } from './shared.js';

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

  const selfResult = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );
  if (!selfResult[0] || selfResult[0].length === 0) return empty;

  const selfPerson = selfResult[0][0]!;
  const selfId = String(selfPerson.id);

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

  const selfResult = await db.query<[Array<{ id: unknown }>]>(
    `SELECT id FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );
  if (!selfResult[0] || selfResult[0].length === 0) return [];

  const selfId = String(selfResult[0][0]!.id);

  const allItems: Array<Record<string, unknown> & { _searchText: string }> = [];

  const tableEntries = Object.entries(SEARCHABLE_FIELDS);
  const queryResults = await Promise.all(
    tableEntries.map(([table]) => {
      const edgeTable = EDGE_TABLE_MAP[table]!;
      return db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->${edgeTable}->${table}.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      );
    }),
  );

  for (let i = 0; i < tableEntries.length; i++) {
    const [, fields] = tableEntries[i]!;
    const items = extractItems(queryResults[i]!);
    for (const item of items) {
      if (item.superseded_by) continue;
      const _searchText = fields
        .map((f) => String(item[f] ?? ''))
        .join(' ');
      allItems.push({ ...item, _searchText });
    }
  }

  const results = await scoredSearch(
    allItems,
    query,
    (item) => item._searchText as string,
    {
      getCreatedAt: (item) => item.created_at as Date | string | undefined,
      getImportance: (item) => item.importance as string | undefined,
      getEmbedding: (item) => item.embedding as number[] | undefined,
    },
  );

  const ids = results.map((r) => String(r.id));
  await bumpAccess(ids);

  return results.map(({ _searchText, ...rest }) => rest);
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

export async function recallConversations(
  phoneNumber: string,
  query: string,
  limit: number = 5,
): Promise<Record<string, unknown>[]> {
  const db = getMemoryDb();

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

  const ids = results.map((r) => String(r.id));
  await bumpAccess(ids);

  return results;
}
