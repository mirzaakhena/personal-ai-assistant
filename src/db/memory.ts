import { Surreal } from 'surrealdb';
import { createNodeEngines } from '@surrealdb/node';
import { createRemoteEngines } from 'surrealdb';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  MEMORY_DB_PATH,
  MEMORY_DB_NAMESPACE,
  MEMORY_DB_DATABASE,
} from '../core/constants.js';

let db: Surreal | null = null;

const SCHEMA_STATEMENTS = `
  -- Node tables
  DEFINE TABLE person SCHEMAFULL;
  DEFINE FIELD name ON person TYPE option<string>;
  DEFINE FIELD nickname ON person TYPE option<string>;
  DEFINE FIELD phone ON person TYPE option<string>;
  DEFINE FIELD location ON person TYPE option<string>;
  DEFINE FIELD occupation ON person TYPE option<string>;
  DEFINE FIELD birthday ON person TYPE option<string>;
  DEFINE FIELD type ON person TYPE option<string> ASSERT $value == NONE OR $value IN ['self', 'contact'];
  DEFINE FIELD notes ON person TYPE option<string>;
  DEFINE FIELD created_at ON person TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD last_accessed ON person TYPE option<datetime>;
  DEFINE FIELD access_count ON person TYPE int DEFAULT 0;

  DEFINE TABLE preference SCHEMAFULL;
  DEFINE FIELD category ON preference TYPE option<string>;
  DEFINE FIELD value ON preference TYPE option<string>;
  DEFINE FIELD context ON preference TYPE option<string>;
  DEFINE FIELD importance ON preference TYPE option<string> ASSERT $value == NONE OR $value IN ['fundamental', 'extended'];
  DEFINE FIELD created_at ON preference TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD last_accessed ON preference TYPE option<datetime>;
  DEFINE FIELD access_count ON preference TYPE int DEFAULT 0;
  DEFINE FIELD embedding ON preference TYPE option<array<float>>;

  DEFINE TABLE fact SCHEMAFULL;
  DEFINE FIELD content ON fact TYPE option<string>;
  DEFINE FIELD category ON fact TYPE option<string>;
  DEFINE FIELD importance ON fact TYPE option<string> ASSERT $value == NONE OR $value IN ['fundamental', 'extended'];
  DEFINE FIELD superseded_by ON fact TYPE option<record>;
  DEFINE FIELD created_at ON fact TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD last_accessed ON fact TYPE option<datetime>;
  DEFINE FIELD access_count ON fact TYPE int DEFAULT 0;
  DEFINE FIELD embedding ON fact TYPE option<array<float>>;

  DEFINE TABLE routine SCHEMAFULL;
  DEFINE FIELD activity ON routine TYPE option<string>;
  DEFINE FIELD schedule ON routine TYPE option<string>;
  DEFINE FIELD details ON routine TYPE option<string>;
  DEFINE FIELD importance ON routine TYPE option<string> ASSERT $value == NONE OR $value IN ['fundamental', 'extended'];
  DEFINE FIELD created_at ON routine TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD last_accessed ON routine TYPE option<datetime>;
  DEFINE FIELD access_count ON routine TYPE int DEFAULT 0;
  DEFINE FIELD embedding ON routine TYPE option<array<float>>;

  DEFINE TABLE persona SCHEMAFULL;
  DEFINE FIELD name ON persona TYPE option<string>;
  DEFINE FIELD personality_traits ON persona TYPE option<string>;
  DEFINE FIELD communication_style ON persona TYPE option<string>;
  DEFINE FIELD language_preference ON persona TYPE option<string>;
  DEFINE FIELD created_at ON persona TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD last_accessed ON persona TYPE option<datetime>;
  DEFINE FIELD access_count ON persona TYPE int DEFAULT 0;
  DEFINE FIELD embedding ON persona TYPE option<array<float>>;

  DEFINE TABLE conversation_summary SCHEMAFULL;
  DEFINE FIELD date ON conversation_summary TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD summary ON conversation_summary TYPE option<string>;
  DEFINE FIELD topics ON conversation_summary TYPE option<array<string>>;
  DEFINE FIELD key_decisions ON conversation_summary TYPE option<array<string>>;
  DEFINE FIELD created_at ON conversation_summary TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD last_accessed ON conversation_summary TYPE option<datetime>;
  DEFINE FIELD access_count ON conversation_summary TYPE int DEFAULT 0;
  DEFINE FIELD embedding ON conversation_summary TYPE option<array<float>>;

  -- Edge (relation) tables
  DEFINE TABLE has_preference TYPE RELATION FROM person TO preference SCHEMAFULL;
  DEFINE FIELD created_at ON has_preference TYPE option<datetime> DEFAULT time::now();

  DEFINE TABLE has_fact TYPE RELATION FROM person TO fact SCHEMAFULL;
  DEFINE FIELD created_at ON has_fact TYPE option<datetime> DEFAULT time::now();

  DEFINE TABLE has_routine TYPE RELATION FROM person TO routine SCHEMAFULL;
  DEFINE FIELD created_at ON has_routine TYPE option<datetime> DEFAULT time::now();

  DEFINE TABLE prefers_persona TYPE RELATION FROM person TO persona SCHEMAFULL;
  DEFINE FIELD created_at ON prefers_persona TYPE option<datetime> DEFAULT time::now();

  DEFINE TABLE had_conversation TYPE RELATION FROM person TO conversation_summary SCHEMAFULL;
  DEFINE FIELD created_at ON had_conversation TYPE option<datetime> DEFAULT time::now();

  DEFINE TABLE knows TYPE RELATION FROM person TO person SCHEMAFULL;
  DEFINE FIELD relationship_type ON knows TYPE option<string>;
  DEFINE FIELD notes ON knows TYPE option<string>;
  DEFINE FIELD created_at ON knows TYPE option<datetime> DEFAULT time::now();
`;

/**
 * Initialize the memory database connection and schema.
 * @param connectionString - Override connection string (use 'mem://' for tests)
 */
export async function initMemoryDb(
  connectionString?: string,
): Promise<Surreal> {
  const connStr = connectionString ?? `surrealkv://${MEMORY_DB_PATH}`;

  // Ensure data directory exists for file-based storage
  if (connStr.startsWith('surrealkv://')) {
    const dbPath = connStr.replace('surrealkv://', '');
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const instance = new Surreal({
    engines: { ...createRemoteEngines(), ...createNodeEngines() },
  });

  await instance.connect(connStr);
  await instance.use({
    namespace: MEMORY_DB_NAMESPACE,
    database: MEMORY_DB_DATABASE,
  });

  // Run schema definitions
  await instance.query(SCHEMA_STATEMENTS);

  db = instance;
  return instance;
}

/**
 * Get the initialized memory database instance.
 * Throws if not yet initialized.
 */
export function getMemoryDb(): Surreal {
  if (!db) {
    throw new Error(
      'Memory database not initialized. Call initMemoryDb() first.',
    );
  }
  return db;
}

/**
 * Close the memory database connection.
 */
export async function closeMemoryDb(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}
