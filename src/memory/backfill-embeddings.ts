/**
 * Backfill script for generating embeddings on existing memories.
 *
 * Run once after enabling MEMORY_EMBEDDING_ENABLED to populate
 * the `embedding` field on all existing memory records.
 *
 * Usage:
 *   MEMORY_EMBEDDING_PROVIDER=openai OPENAI_API_KEY=sk-... npx tsx src/memory/backfill-embeddings.ts
 */

import 'dotenv/config';
import { initMemoryDb, getMemoryDb, closeMemoryDb, rid } from '../db/memory.js';
import { generateEmbedding } from './embeddings.js';
import { MEMORY_DB_PATH } from '../core/constants.js';
import { SEARCHABLE_FIELDS, buildEmbeddingText } from './operations.js';

const MEMORY_TABLES = ['preference', 'fact', 'routine', 'persona'] as const;

async function main() {
  const connectionString = `surrealkv://${MEMORY_DB_PATH}`;
  console.log(`Connecting to ${connectionString}...`);
  await initMemoryDb(connectionString);
  const db = getMemoryDb();

  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const table of MEMORY_TABLES) {
    // Find records with no embedding
    const records = await db.query<[Array<Record<string, unknown>>]>(
      `SELECT * FROM ${table} WHERE embedding = NONE`,
    );
    const items = records[0] ?? [];
    console.log(`\n${table}: ${items.length} records without embeddings`);

    for (const record of items) {
      totalProcessed++;
      const id = String(record.id);
      const text = buildEmbeddingText(table, record);

      if (text.length === 0) {
        console.log(`  [skip] ${id} — no text content`);
        totalSkipped++;
        continue;
      }

      try {
        const embedding = await generateEmbedding(text);
        if (embedding) {
          await db.query(`UPDATE $id SET embedding = $embedding`, {
            id: rid(id),
            embedding,
          });
          console.log(`  [ok] ${id}`);
          totalUpdated++;
        } else {
          console.log(`  [skip] ${id} — embedding provider returned null`);
          totalSkipped++;
        }
      } catch (err) {
        console.error(`  [error] ${id}:`, err);
        totalErrors++;
      }
    }
  }

  console.log(`\nDone.`);
  console.log(`  Processed: ${totalProcessed}`);
  console.log(`  Updated:   ${totalUpdated}`);
  console.log(`  Skipped:   ${totalSkipped}`);
  console.log(`  Errors:    ${totalErrors}`);

  await closeMemoryDb();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
