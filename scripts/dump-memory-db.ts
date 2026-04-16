import { writeFileSync } from 'node:fs';
import { initMemoryDb, closeMemoryDb } from '../src-v2/db/memory.ts';

const db = await initMemoryDb('surrealkv:///Users/mirza/Workspace/personal-ai-assistant6/memory.db');
const info = (await db.query('INFO FOR DB;'))[0] as any;
const tables = Object.keys(info?.tables ?? {});

const dump: Record<string, unknown> = {};
for (const t of tables) {
  dump[t] = (await db.query(`SELECT * FROM ${t};`))[0];
}

const out = '/Users/mirza/Workspace/personal-ai-assistant6/memory.db.json';
writeFileSync(out, JSON.stringify(dump, null, 2));
console.log(`Wrote ${out} (${tables.length} tables: ${tables.join(', ')})`);
await closeMemoryDb();
