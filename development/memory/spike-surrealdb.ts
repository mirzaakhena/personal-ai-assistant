/**
 * Spike Test: Validate SurrealDB Embedded Features
 *
 * Tests all SurrealDB features the Memory PRD depends on:
 * 1. SCHEMAFULL tables
 * 2. TYPE RELATION tables
 * 3. ASSERT constraints
 * 4. DEFAULT values (time::now())
 * 5. Nullable vector fields (option<array<float>>)
 * 6. Graph traversal (->edge->node)
 * 7. String search functions
 * 8. Full-text search (DEFINE ANALYZER + DEFINE INDEX ... SEARCH ANALYZER)
 *
 * Run: npx tsx development/memory/spike-surrealdb.ts
 */

import { Surreal } from "surrealdb";
import { createNodeEngines } from "@surrealdb/node";
import { createRemoteEngines } from "surrealdb";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const SPIKE_DB_DIR = join(
  import.meta.dirname ?? ".",
  ".spike-test-data"
);

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  notes?: string;
}

const results: TestResult[] = [];

function pass(name: string, notes?: string) {
  results.push({ name, passed: true, notes });
  console.log(`  ✓ ${name}${notes ? ` — ${notes}` : ""}`);
}

function fail(name: string, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  results.push({ name, passed: false, error: msg });
  console.log(`  ✗ ${name} — ${msg}`);
}

async function runTests(engine: "mem" | "surrealkv") {
  const db = new Surreal({
    engines: { ...createRemoteEngines(), ...createNodeEngines() },
  });

  const connStr =
    engine === "mem" ? "mem://" : `surrealkv://${SPIKE_DB_DIR}`;

  console.log(`\n=== Testing engine: ${engine} (${connStr}) ===\n`);

  try {
    await db.connect(connStr);
    await db.use({ namespace: "spike_test", database: "spike_test" });
    pass(`[${engine}] Connect`);
  } catch (e) {
    fail(`[${engine}] Connect`, e);
    return; // can't proceed without connection
  }

  // Test 1: SCHEMAFULL
  try {
    await db.query(`DEFINE TABLE person SCHEMAFULL`);
    await db.query(
      `DEFINE FIELD name ON person TYPE option<string>`
    );
    await db.query(
      `DEFINE FIELD phone ON person TYPE option<string>`
    );
    await db.query(
      `DEFINE FIELD type ON person TYPE option<string> ASSERT $value == NONE OR $value IN ['self', 'contact']`
    );
    await db.query(
      `DEFINE FIELD nickname ON person TYPE option<string>`
    );
    await db.query(
      `DEFINE FIELD location ON person TYPE option<string>`
    );
    await db.query(
      `DEFINE FIELD occupation ON person TYPE option<string>`
    );
    await db.query(
      `DEFINE FIELD birthday ON person TYPE option<string>`
    );
    await db.query(
      `DEFINE FIELD notes ON person TYPE option<string>`
    );
    await db.query(
      `DEFINE FIELD created_at ON person TYPE option<datetime> DEFAULT time::now()`
    );
    await db.query(
      `DEFINE FIELD last_accessed ON person TYPE option<datetime>`
    );
    await db.query(
      `DEFINE FIELD access_count ON person TYPE int DEFAULT 0`
    );
    pass(`[${engine}] SCHEMAFULL table`);
  } catch (e) {
    fail(`[${engine}] SCHEMAFULL table`, e);
  }

  // Test 2: ASSERT constraint (already defined with ASSERT in Test 1)
  try {
    // Try valid value
    await db.query(
      `CREATE person:test_assert SET name = 'Test', type = 'self', phone = '+1'`
    );
    pass(`[${engine}] ASSERT valid value accepted`);

    // Try invalid value
    try {
      await db.query(
        `CREATE person:test_assert_bad SET name = 'Bad', type = 'invalid', phone = '+2'`
      );
      fail(
        `[${engine}] ASSERT invalid value rejected`,
        "Expected assertion error but insert succeeded"
      );
    } catch {
      pass(`[${engine}] ASSERT invalid value rejected`);
    }
  } catch (e) {
    fail(`[${engine}] ASSERT constraint`, e);
  }

  // Test 3: DEFAULT time::now()
  try {
    const result = await db.query<[Array<{ created_at: unknown }>]>(
      `SELECT created_at FROM person:test_assert`
    );
    const createdAt = result[0]?.[0]?.created_at;
    if (createdAt) {
      pass(`[${engine}] DEFAULT time::now()`, `got: ${createdAt}`);
    } else {
      fail(
        `[${engine}] DEFAULT time::now()`,
        `created_at is null/undefined: ${JSON.stringify(result)}`
      );
    }
  } catch (e) {
    fail(`[${engine}] DEFAULT time::now()`, e);
  }

  // Test 4: TYPE RELATION
  try {
    await db.query(
      `DEFINE TABLE knows TYPE RELATION FROM person TO person SCHEMAFULL`
    );
    await db.query(
      `DEFINE FIELD relationship_type ON knows TYPE option<string>`
    );
    await db.query(
      `DEFINE FIELD notes ON knows TYPE option<string>`
    );
    await db.query(
      `DEFINE FIELD created_at ON knows TYPE option<datetime> DEFAULT time::now()`
    );
    pass(`[${engine}] TYPE RELATION table`);
  } catch (e) {
    fail(`[${engine}] TYPE RELATION table`, e);
  }

  // Test 5: Nullable vector field (option<array<float>>)
  try {
    await db.query(`DEFINE TABLE fact SCHEMAFULL`);
    await db.query(
      `DEFINE FIELD content ON fact TYPE option<string>`
    );
    await db.query(
      `DEFINE FIELD category ON fact TYPE option<string>`
    );
    await db.query(
      `DEFINE FIELD importance ON fact TYPE option<string> ASSERT $value == NONE OR $value IN ['fundamental', 'extended']`
    );
    await db.query(
      `DEFINE FIELD embedding ON fact TYPE option<array<float>>`
    );
    await db.query(
      `DEFINE FIELD created_at ON fact TYPE option<datetime> DEFAULT time::now()`
    );
    await db.query(
      `DEFINE FIELD last_accessed ON fact TYPE option<datetime>`
    );
    await db.query(
      `DEFINE FIELD access_count ON fact TYPE int DEFAULT 0`
    );
    await db.query(
      `DEFINE FIELD superseded_by ON fact TYPE option<record>`
    );

    // Create with null embedding
    await db.query(
      `CREATE fact:f1 SET content = 'test fact', importance = 'fundamental', embedding = NONE`
    );

    // Create with actual embedding
    await db.query(
      `CREATE fact:f2 SET content = 'vector fact', importance = 'extended', embedding = [0.1, 0.2, 0.3]`
    );

    const facts = await db.query<[Array<{ embedding: unknown }>]>(
      `SELECT embedding FROM fact`
    );
    pass(
      `[${engine}] option<array<float>>`,
      `null: ${facts[0]?.[0]?.embedding}, vector: ${JSON.stringify(facts[0]?.[1]?.embedding)}`
    );
  } catch (e) {
    fail(`[${engine}] option<array<float>>`, e);
  }

  // Test 6: Create graph nodes and edges, then traverse
  try {
    await db.query(
      `CREATE person:self SET name = 'Mirza', type = 'self', phone = '+628111'`
    );
    await db.query(
      `CREATE person:friend1 SET name = 'Budi', type = 'contact', phone = '+628222'`
    );
    await db.query(
      `RELATE person:self->knows->person:friend1 SET relationship_type = 'friend', notes = 'teman kerja'`
    );

    // Graph traversal
    const traversal = await db.query<[unknown[]]>(
      `SELECT ->knows->person.* AS friends FROM person:self`
    );
    const friends = (traversal[0]?.[0] as { friends?: unknown[] })?.friends;

    if (friends && Array.isArray(friends) && friends.length > 0) {
      pass(
        `[${engine}] Graph traversal`,
        `found ${friends.length} friend(s): ${JSON.stringify(friends)}`
      );
    } else {
      fail(
        `[${engine}] Graph traversal`,
        `expected friends but got: ${JSON.stringify(traversal)}`
      );
    }
  } catch (e) {
    fail(`[${engine}] Graph traversal`, e);
  }

  // Test 7: Edge table with has_fact relation
  try {
    await db.query(
      `DEFINE TABLE has_fact TYPE RELATION FROM person TO fact SCHEMAFULL`
    );
    await db.query(
      `DEFINE FIELD created_at ON has_fact TYPE option<datetime> DEFAULT time::now()`
    );
    await db.query(`RELATE person:self->has_fact->fact:f1`);

    // Traverse person -> has_fact -> fact
    const factTraversal = await db.query<[unknown[]]>(
      `SELECT ->has_fact->fact.* AS facts FROM person:self`
    );
    const facts = (factTraversal[0]?.[0] as { facts?: unknown[] })?.facts;

    if (facts && Array.isArray(facts) && facts.length > 0) {
      pass(
        `[${engine}] has_fact edge traversal`,
        `found ${facts.length} fact(s)`
      );
    } else {
      fail(
        `[${engine}] has_fact edge traversal`,
        `got: ${JSON.stringify(factTraversal)}`
      );
    }
  } catch (e) {
    fail(`[${engine}] has_fact edge traversal`, e);
  }

  // Test 8: String search functions
  try {
    await db.query(
      `CREATE fact:search1 SET content = 'Suka ngopi hitam setiap pagi', importance = 'extended'`
    );
    await db.query(
      `CREATE fact:search2 SET content = 'Jogging pagi hari di taman', importance = 'extended'`
    );

    // Single keyword search
    const singleResult = await db.query<[unknown[]]>(
      `SELECT * FROM fact WHERE string::contains(string::lowercase(content), 'pagi')`
    );
    const singleCount = (singleResult[0] as unknown[])?.length ?? 0;

    // Multi-keyword tokenized search (both keywords)
    const multiResult = await db.query<[unknown[]]>(
      `SELECT * FROM fact WHERE string::contains(string::lowercase(content), 'ngopi') OR string::contains(string::lowercase(content), 'pagi')`
    );
    const multiCount = (multiResult[0] as unknown[])?.length ?? 0;

    pass(
      `[${engine}] String search`,
      `single('pagi')=${singleCount} results, multi('ngopi' OR 'pagi')=${multiCount} results`
    );
  } catch (e) {
    fail(`[${engine}] String search`, e);
  }

  // Test 9: Full-text search (DEFINE ANALYZER + DEFINE INDEX)
  // SurrealDB v3+ uses FULLTEXT ANALYZER, v2 uses SEARCH ANALYZER
  try {
    await db.query(
      `DEFINE ANALYZER memory_analyzer TOKENIZERS blank, class FILTERS lowercase, ascii`
    );

    // Try v3 syntax first (FULLTEXT ANALYZER)
    let ftsWorked = false;
    try {
      await db.query(
        `DEFINE INDEX fact_content_search ON fact FIELDS content FULLTEXT ANALYZER memory_analyzer BM25`
      );
      ftsWorked = true;
      pass(`[${engine}] FTS index (FULLTEXT ANALYZER syntax)`);
    } catch {
      // Try v2 syntax (SEARCH ANALYZER)
      try {
        await db.query(
          `DEFINE INDEX fact_content_search ON fact FIELDS content SEARCH ANALYZER memory_analyzer BM25`
        );
        ftsWorked = true;
        pass(`[${engine}] FTS index (SEARCH ANALYZER syntax)`);
      } catch (e2) {
        fail(`[${engine}] FTS index (both syntaxes failed)`, e2);
      }
    }

    if (ftsWorked) {
      const ftsResult = await db.query<[unknown[]]>(
        `SELECT *, search::score(0) AS score FROM fact WHERE content @0@ 'pagi' ORDER BY score DESC`
      );
      const ftsCount = (ftsResult[0] as unknown[])?.length ?? 0;
      pass(
        `[${engine}] Full-text search query`,
        `found ${ftsCount} results for 'pagi': ${JSON.stringify(ftsResult[0])}`
      );
    }
  } catch (e) {
    fail(`[${engine}] Full-text search`, e);
  }

  // Test 10: INFO FOR DB (verify all tables exist)
  try {
    const info = await db.query(`INFO FOR DB`);
    pass(
      `[${engine}] INFO FOR DB`,
      `tables: ${JSON.stringify(info)}`
    );
  } catch (e) {
    fail(`[${engine}] INFO FOR DB`, e);
  }

  // Test 11: Delete edge before node (cleanup pattern)
  try {
    // Delete edges first
    await db.query(`DELETE FROM has_fact WHERE out = fact:f1`);
    // Then delete node
    await db.query(`DELETE fact:f1`);

    // Verify node gone
    const gone = await db.query<[unknown[]]>(
      `SELECT * FROM fact:f1`
    );
    const isGone = (gone[0] as unknown[])?.length === 0;
    pass(
      `[${engine}] Delete edge then node`,
      `node deleted: ${isGone}`
    );
  } catch (e) {
    fail(`[${engine}] Delete edge then node`, e);
  }

  // Test 12: Parameterized queries (for multi-user isolation)
  try {
    const paramResult = await db.query<[unknown[]]>(
      `SELECT * FROM person WHERE phone = $phone AND type = 'self'`,
      { phone: "+628111" }
    );
    const found = (paramResult[0] as unknown[])?.length ?? 0;

    const paramResult2 = await db.query<[unknown[]]>(
      `SELECT * FROM person WHERE phone = $phone AND type = 'self'`,
      { phone: "+999999" }
    );
    const notFound = (paramResult2[0] as unknown[])?.length ?? 0;

    pass(
      `[${engine}] Parameterized queries`,
      `existing phone: ${found} results, non-existing: ${notFound} results`
    );
  } catch (e) {
    fail(`[${engine}] Parameterized queries`, e);
  }

  await db.close();
  pass(`[${engine}] Close connection`);
}

async function main() {
  console.log("SurrealDB Embedded Spike Test");
  console.log("=============================\n");

  // Clean up any previous spike data
  if (existsSync(SPIKE_DB_DIR)) {
    rmSync(SPIKE_DB_DIR, { recursive: true });
  }
  mkdirSync(SPIKE_DB_DIR, { recursive: true });

  // Test in-memory engine
  await runTests("mem");

  // Test file-based engine (surrealkv)
  await runTests("surrealkv");

  // Clean up spike data
  if (existsSync(SPIKE_DB_DIR)) {
    rmSync(SPIKE_DB_DIR, { recursive: true });
  }

  // Summary
  console.log("\n\n=============================");
  console.log("SUMMARY");
  console.log("=============================\n");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    console.log("FAILURES:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ✗ ${r.name}: ${r.error}`);
    }
  }

  // Decision gate
  console.log("\n--- DECISION GATE ---");
  const schemafullFailed = results.some(
    (r) => r.name.includes("SCHEMAFULL") && !r.passed
  );
  const relationFailed = results.some(
    (r) => r.name.includes("TYPE RELATION") && !r.passed
  );
  const embeddedFailed = results.some(
    (r) => r.name.includes("Connect") && !r.passed
  );

  if (embeddedFailed) {
    console.log(
      "⚠ EMBEDDED MODE BROKEN → Switch to remote SurrealDB via Docker"
    );
  } else if (schemafullFailed) {
    console.log(
      "⚠ SCHEMAFULL FAILED → Use SCHEMALESS + Zod validation in app layer"
    );
  } else if (relationFailed) {
    console.log(
      "⚠ TYPE RELATION FAILED → Use regular tables with in/out fields"
    );
  } else if (failed === 0) {
    console.log("✓ ALL TESTS PASSED → Proceed with Phase 1 as-is");
  } else {
    console.log(
      `⚠ ${failed} test(s) failed — review failures above before proceeding`
    );
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
