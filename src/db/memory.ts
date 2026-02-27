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
  DEFINE TABLE IF NOT EXISTS person SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS name ON person TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS nickname ON person TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS phone ON person TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS location ON person TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS occupation ON person TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS birthday ON person TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS type ON person TYPE option<string> ASSERT $value == NONE OR $value IN ['self', 'contact'];
  DEFINE FIELD IF NOT EXISTS notes ON person TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS created_at ON person TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS last_accessed ON person TYPE option<datetime>;
  DEFINE FIELD IF NOT EXISTS access_count ON person TYPE int DEFAULT 0;

  DEFINE TABLE IF NOT EXISTS preference SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS category ON preference TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS value ON preference TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS context ON preference TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS importance ON preference TYPE option<string> ASSERT $value == NONE OR $value IN ['fundamental', 'extended'];
  DEFINE FIELD IF NOT EXISTS created_at ON preference TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS last_accessed ON preference TYPE option<datetime>;
  DEFINE FIELD IF NOT EXISTS access_count ON preference TYPE int DEFAULT 0;
  DEFINE FIELD IF NOT EXISTS embedding ON preference TYPE option<array<float>>;

  DEFINE TABLE IF NOT EXISTS fact SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS content ON fact TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS category ON fact TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS importance ON fact TYPE option<string> ASSERT $value == NONE OR $value IN ['fundamental', 'extended'];
  DEFINE FIELD IF NOT EXISTS superseded_by ON fact TYPE option<record>;
  DEFINE FIELD IF NOT EXISTS created_at ON fact TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS last_accessed ON fact TYPE option<datetime>;
  DEFINE FIELD IF NOT EXISTS access_count ON fact TYPE int DEFAULT 0;
  DEFINE FIELD IF NOT EXISTS embedding ON fact TYPE option<array<float>>;

  DEFINE TABLE IF NOT EXISTS routine SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS activity ON routine TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS schedule ON routine TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS details ON routine TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS importance ON routine TYPE option<string> ASSERT $value == NONE OR $value IN ['fundamental', 'extended'];
  DEFINE FIELD IF NOT EXISTS created_at ON routine TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS last_accessed ON routine TYPE option<datetime>;
  DEFINE FIELD IF NOT EXISTS access_count ON routine TYPE int DEFAULT 0;
  DEFINE FIELD IF NOT EXISTS embedding ON routine TYPE option<array<float>>;

  DEFINE TABLE IF NOT EXISTS persona SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS name ON persona TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS personality_traits ON persona TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS communication_style ON persona TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS language_preference ON persona TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS created_at ON persona TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS last_accessed ON persona TYPE option<datetime>;
  DEFINE FIELD IF NOT EXISTS access_count ON persona TYPE int DEFAULT 0;
  DEFINE FIELD IF NOT EXISTS embedding ON persona TYPE option<array<float>>;

  DEFINE TABLE IF NOT EXISTS conversation_summary SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS date ON conversation_summary TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS summary ON conversation_summary TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS topics ON conversation_summary TYPE option<array<string>>;
  DEFINE FIELD IF NOT EXISTS key_decisions ON conversation_summary TYPE option<array<string>>;
  DEFINE FIELD IF NOT EXISTS created_at ON conversation_summary TYPE option<datetime> DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS last_accessed ON conversation_summary TYPE option<datetime>;
  DEFINE FIELD IF NOT EXISTS access_count ON conversation_summary TYPE int DEFAULT 0;
  DEFINE FIELD IF NOT EXISTS embedding ON conversation_summary TYPE option<array<float>>;

  -- Edge (relation) tables
  DEFINE TABLE IF NOT EXISTS has_preference TYPE RELATION FROM person TO preference SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS created_at ON has_preference TYPE option<datetime> DEFAULT time::now();

  DEFINE TABLE IF NOT EXISTS has_fact TYPE RELATION FROM person TO fact SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS created_at ON has_fact TYPE option<datetime> DEFAULT time::now();

  DEFINE TABLE IF NOT EXISTS has_routine TYPE RELATION FROM person TO routine SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS created_at ON has_routine TYPE option<datetime> DEFAULT time::now();

  DEFINE TABLE IF NOT EXISTS prefers_persona TYPE RELATION FROM person TO persona SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS created_at ON prefers_persona TYPE option<datetime> DEFAULT time::now();

  DEFINE TABLE IF NOT EXISTS had_conversation TYPE RELATION FROM person TO conversation_summary SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS created_at ON had_conversation TYPE option<datetime> DEFAULT time::now();

  DEFINE TABLE IF NOT EXISTS knows TYPE RELATION FROM person TO person SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS relationship_type ON knows TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS notes ON knows TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS created_at ON knows TYPE option<datetime> DEFAULT time::now();
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
