# Memory Feature — Progress Log

## Phase 0: Spike Test — Validate SurrealDB Embedded

### 0.1 Create spike test script ✅
- **Date**: 2026-02-28
- **Script**: `development/memory/spike-surrealdb.ts`
- **Result**: ALL 32 TESTS PASSED on both `mem://` and `surrealkv://` engines
- **Key findings**:
  - SCHEMAFULL works correctly
  - TYPE RELATION works correctly
  - ASSERT constraints work (rejects invalid values)
  - DEFAULT time::now() works
  - option<array<float>> works for nullable vector fields
  - Graph traversal (->edge->node) works
  - String search (string::contains + string::lowercase) works
  - Full-text search works with `FULLTEXT ANALYZER` syntax (SurrealDB v3+ via @surrealdb/node 3.0.1)
  - Parameterized queries work for multi-user isolation
  - Delete edge then node pattern works
- **Decision gate**: Proceed with Phase 1 as-is — no fallbacks needed
- **Note**: SurrealDB v3 uses `FULLTEXT ANALYZER` instead of `SEARCH ANALYZER` (v2 syntax)
- **Packages installed**: `surrealdb@2.0.0`, `@surrealdb/node@3.0.1`

## Phase 1: Infrastructure — SurrealDB Setup

### 1.1 Install SurrealDB dependencies ✅
- **Date**: 2026-02-28
- **Result**: Packages `surrealdb@2.0.0` and `@surrealdb/node@3.0.1` were already in `dependencies` from Phase 0 spike test
- **Changes**: Added `@surrealdb/node` to `pnpm.onlyBuiltDependencies` array in `package.json` (alongside `esbuild`, `better-sqlite3`, `puppeteer`) to ensure native addon is rebuilt on deploy
- **Verification**: `pnpm install` succeeded, both imports verified working via Node.js

### 1.2 Add memory constants ✅
- **Date**: 2026-02-28
- **File**: `src/core/constants.ts`
- **Constants added**:
  - `MEMORY_DB_PATH` — `join(DATA_DIR, 'memory.db')` for SurrealKV storage
  - `MEMORY_DB_NAMESPACE` — `'assistant'`
  - `MEMORY_DB_DATABASE` — `'memory'`
  - `MEMORY_FUNDAMENTAL_LIMIT` — `5` (max per category at conversation start)
  - `MEMORY_DECAY_HALF_LIFE_DAYS` — `30` (for Phase 8 temporal decay)
  - `MEMORY_EMBEDDING_ENABLED` — `false` (feature flag for Phase 8)
- **Verification**: `pnpm run type-check` passed

### 1.3 Create `src/db/memory.ts` — SurrealDB connection and schema initialization ✅
- **Date**: 2026-02-28
- **Files created**:
  - `src/db/memory.ts` — SurrealDB connection module with schema initialization
  - `src/__tests__/db/memory.test.ts` — 13 unit tests covering connection, schema, and validation
- **Exports**: `initMemoryDb(connectionString?)`, `getMemoryDb()`, `closeMemoryDb()`
- **Schema**: All 5 node tables (person, preference, fact, routine, persona) and 5 edge tables (has_preference, has_fact, has_routine, prefers_persona, knows) defined as SCHEMAFULL with TYPE RELATION
- **Key details**:
  - Accepts optional `connectionString` parameter for testability (`mem://` for tests, `surrealkv://` for production)
  - All ASSERT constraints enforced at DB level (person.type, importance fields)
  - DEFAULT `time::now()` on all `created_at` fields
  - Nullable `embedding` field (`option<array<float>>`) on preference, fact, routine, persona — schema-ready for Phase 8
  - `superseded_by` field on fact table for memory conflict resolution
- **Testing note**: SurrealDB returns `undefined` (not `null`) for NONE values in query results
- **Verification**: 89 tests pass (all 10 test files), `pnpm run type-check` passes
