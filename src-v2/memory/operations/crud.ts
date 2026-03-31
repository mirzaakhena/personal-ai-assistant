import { getMemoryDb, rid } from '../../db/memory.js';
import { generateEmbedding } from '../embeddings.js';
import {
  EDGE_TABLE_MAP,
  ALL_EDGE_TABLES,
  SEARCHABLE_FIELDS,
  type MemoryTable,
  toRecordIdStr,
} from './shared.js';

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
    if (notes !== undefined) {
      await db.query(`UPDATE $contactId SET notes = $notes`, {
        contactId: rid(contactId),
        notes,
      });
    }
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
    const created = await db.query<[Array<{ id: unknown }>]>(
      `CREATE person SET name = $name, type = 'contact', notes = $notes`,
      { name: contactName, notes: notes ?? 'NONE' },
    );
    contactId = toRecordIdStr(created[0]![0]);

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

// --- Memory CRUD ---

/**
 * Build a text string from memory data for embedding generation.
 */
export function buildEmbeddingText(
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

  let embedding: number[] | null = null;
  if (process.env.MEMORY_EMBEDDING_ENABLED === 'true') {
    const text = buildEmbeddingText(table, data);
    if (text.length > 0) {
      embedding = await generateEmbedding(text);
    }
  }

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

  for (const edgeTable of ALL_EDGE_TABLES) {
    await db.query(`DELETE FROM ${edgeTable} WHERE out = $recordId`, {
      recordId: rid(recordId),
    });
  }
  await db.query(`DELETE FROM knows WHERE out = $recordId`, {
    recordId: rid(recordId),
  });

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
