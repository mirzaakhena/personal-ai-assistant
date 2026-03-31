import { getMemoryDb, rid, extractItems } from '../../db/memory.js';
import { EDGE_TABLE_MAP, SEARCHABLE_FIELDS } from './shared.js';

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

  const result = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT out.name AS name, out.id AS contact_id, relationship_type, notes FROM knows WHERE in = $selfId`,
    { selfId: rid(selfId) },
  );

  return result[0] ?? [];
}

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

  const selfResult = await db.query<[Array<{ id: unknown }>]>(
    `SELECT id FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );
  if (!selfResult[0] || selfResult[0].length === 0) return [];

  const selfId = String(selfResult[0][0]!.id);

  switch (queryType) {
    case 'contacts_by_attribute': {
      const contactResult = await db.query<[Array<Record<string, unknown>>]>(
        `SELECT ->knows->person.* AS items FROM $selfId`,
        { selfId: rid(selfId) },
      );
      const contacts = extractItems(contactResult);

      const edgeResult = await db.query<[Array<Record<string, unknown>>]>(
        `SELECT out.id AS contact_id, out.name AS name, relationship_type FROM knows WHERE in = $selfId`,
        { selfId: rid(selfId) },
      );
      const edges = edgeResult[0] ?? [];
      const edgeMap = new Map(
        edges.map((e) => [String(e.contact_id), e]),
      );

      return contacts.filter((c) => {
        const edge = edgeMap.get(String(c.id));
        for (const [key, value] of Object.entries(filters)) {
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

        const thisYearBirthday = new Date(
          now.getFullYear(),
          birthday.getMonth(),
          birthday.getDate(),
        );
        let daysUntil =
          (thisYearBirthday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        if (daysUntil < 0) {
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
