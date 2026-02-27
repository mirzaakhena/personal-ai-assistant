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

### 1.4 Initialize memory DB in `src/index.ts` ✅
- **Date**: 2026-02-28
- **File modified**: `src/index.ts`
- **Changes**:
  - Imported `initMemoryDb` and `closeMemoryDb` from `src/db/memory.ts`
  - Added `await initMemoryDb()` before `await client.initialize()` — ensures memory DB is ready before any messages are processed
  - Added `await closeMemoryDb()` in `shutdown()` before `client.destroy()` — ensures clean DB shutdown on SIGINT/SIGTERM
- **No new tests needed**: Pure wiring task with no logic; existing 89 tests all pass
- **Verification**: `pnpm run type-check` passes, `pnpm test` passes (89 tests, 10 files)

## Phase 2: Core Memory Operations — Database Layer

### 2.1 Create `src/memory/operations.ts` — CRUD operations ✅
- **Date**: 2026-02-28
- **Files created**:
  - `src/memory/operations.ts` — All CRUD operations for memory graph
  - `src/__tests__/memory/operations.test.ts` — 27 unit tests
- **Exports**: `getOrCreateSelfPerson`, `upsertContact`, `saveMemory`, `updateMemory`, `deleteMemory`, `supersedeMemory`, `getFundamentalMemories`, `recallMemories`, `getAllMemories`, `getRelationships`
- **Key details**:
  - All functions take `phoneNumber` as first arg for multi-user isolation
  - Uses `StringRecordId` from surrealdb SDK to pass record IDs as proper record references (not plain strings) in parameterized queries — required for RELATE and graph traversal
  - `recallMemories` implements multi-keyword tokenized matching: splits query into words, scores by `matched_tokens / total_tokens`, sorts descending
  - `getFundamentalMemories` returns profile, persona, preferences, facts, routines — filters by `importance = 'fundamental'`, respects `MEMORY_FUNDAMENTAL_LIMIT`
  - `bumpAccess` increments `access_count` and sets `last_accessed` on all returned memory nodes (temporal data for Phase 8)
  - `deleteMemory` cleans up edges before deleting node to prevent orphaned edges
  - `supersedeMemory` creates new memory and sets `superseded_by` on old record
  - Multi-user isolation verified with dedicated tests (memories for phone A not visible to phone B)
- **SurrealDB learnings**:
  - `StringRecordId` is required when passing record IDs as query parameters (plain strings cause "Cannot execute RELATE" errors)
  - Graph traversal with `.* AS items` returns flattened arrays of objects
  - SurrealDB `option<string>` fields reject JavaScript `null` — use `'NONE'` string or omit the field
- **Verification**: 116 tests pass (11 test files), `pnpm run type-check` passes

### 2.2 Create `src/memory/formatter.ts` — Format memories for prompt injection ✅
- **Date**: 2026-02-28
- **Files created**:
  - `src/memory/formatter.ts` — Formats memory data into readable text for prompt injection
  - `src/__tests__/memory/formatter.test.ts` — 8 unit tests covering all formatters
- **Exports**: `formatFundamentalMemory`, `formatRecalledMemories`, `formatAllMemories`
- **Key details**:
  - `formatFundamentalMemory` — Takes `FundamentalMemories` and produces `[MEMORY CONTEXT]` block with sections: About the user, AI Persona, Key preferences, Key routines, Key facts. Returns new-user message when profile is null. Omits empty sections.
  - `formatRecalledMemories` — Takes array of recalled memory records, formats with record IDs and table-specific descriptions (e.g., preference shows value+context, routine shows activity+schedule). Returns "No matching memories found." for empty results.
  - `formatAllMemories` — Detailed format with all memory types including record IDs, importance levels, superseded markers, and contacts. Used for `list_memories` tool to give users full transparency.
  - Internal `describeMemory` helper renders table-specific human-readable descriptions
- **Verification**: 124 tests pass (12 test files), `pnpm run type-check` passes

## Phase 3: MCP Tools — Memory Tools for AI

### 3.1 Create `src/tools/memory.ts` — Memory MCP tools ✅
- **Date**: 2026-02-28
- **Files created**:
  - `src/tools/memory.ts` — 5 MCP tools for memory operations
  - `src/__tests__/tools/memory.test.ts` — 13 unit tests with real in-memory SurrealDB
- **Exports**: `createMemoryTools(ctx: MemoryContext)`, `MemoryContext` type
- **Tools implemented**:
  - `save_memory` — Save new memory (preference, fact, routine, persona, contact). Validates contact requires name+relationship. Routes contacts through `upsertContact`, others through `saveMemory`.
  - `update_memory` — Update or supersede existing memory. Validates table prefix for supersede operations.
  - `recall_memory` — Search memories by keyword with optional `type_filter` to narrow results by memory type.
  - `list_memories` — List all stored memories with record IDs for transparency.
  - `forget_memory` — Delete memory by record ID (removes node and edges).
- **Key details**:
  - Follows `createCronjobTools` pattern — exports a function that takes context and returns tool array
  - All tools return JSON `{ success, ... }` or formatted text for read operations
  - Error handling wraps all operations in try/catch, returns `{ success: false, error }` on failure
  - Uses Zod v4 `z.record(z.string(), z.unknown())` for flexible data objects (v4 requires two args)
- **Verification**: 137 tests pass (13 test files), `pnpm run type-check` passes

### 3.2 Register memory tools in `src/tools/server.ts` ✅
- **Date**: 2026-02-28
- **Files modified**:
  - `src/tools/server.ts` — Added `MemoryContext` import and spread `createMemoryTools(memCtx)` into tools array
  - `src/core/options.ts` — Added `MemoryContext` import and `memCtx` parameter to `createQueryOptions`
  - `src/handlers/message.ts` — Added `MemoryContext` import, created `memCtx` from `phoneNumber`, passed to `createQueryOptions`
  - `src/cron/executor.ts` — Added `MemoryContext` import, created `memCtx` from `phoneNumber`, passed to `createQueryOptions`
- **Key details**:
  - Pure wiring task — no new logic, just passing `MemoryContext` through the call chain
  - Memory tools (save_memory, update_memory, recall_memory, list_memories, forget_memory) now available alongside message and cronjob tools in the MCP server
  - Both message handler and cron executor create `memCtx` from the user's phone number for proper multi-user isolation
- **No new tests needed**: Pure wiring with no logic; all 137 existing tests pass
- **Verification**: `pnpm run type-check` passes, `pnpm test` passes (137 tests, 13 files)

### 3.3 Update `src/core/options.ts` — Memory-aware system prompt and query options ✅
- **Date**: 2026-02-28
- **Files modified**:
  - `src/core/options.ts` — Added memory-aware system prompt with MEMORY SYSTEM instructions, exported `buildSystemPrompt`
- **Files created**:
  - `src/__tests__/core/options.test.ts` — 6 unit tests covering prompt building, memory injection, and error handling
- **Key changes**:
  - Renamed `systemPrompt` const to `BASE_SYSTEM_PROMPT` (no longer exported directly)
  - Added full MEMORY SYSTEM instructions to the base prompt: MEMORY LOADING, WHEN TO SAVE MEMORIES, IMPORTANCE CLASSIFICATION, WHEN TO UPDATE/RECALL, TRANSPARENCY, NEW USER ONBOARDING, CONTEXT PRESERVATION
  - Exported `buildSystemPrompt(phoneNumber)` that loads `getFundamentalMemories()`, formats via `formatFundamentalMemory()`, and appends the memory block to the end of the system prompt
  - `createQueryOptions` now calls `buildSystemPrompt(memCtx.phoneNumber)` to build a memory-aware system prompt per request
  - Error handling: if memory loading fails, falls back to base prompt without memory block (logged as error)
- **Verification**: 143 tests pass (14 test files), `pnpm run type-check` passes

## Phase 4: Message Handler Integration

### 4.1 Update `src/handlers/message.ts` — Wire memory into message processing ✅
- **Date**: 2026-02-28
- **Result**: Already completed as part of Phase 3.2 wiring — `MemoryContext` import, `memCtx` creation, and `createQueryOptions` call were all wired in that phase
- **No additional changes needed**

### 4.2 Update `src/cron/executor.ts` — Wire memory into cronjob execution ✅
- **Date**: 2026-02-28
- **Result**: Already completed as part of Phase 3.2 wiring — `MemoryContext` import, `memCtx` creation, and `createQueryOptions` call were all wired in that phase
- **No additional changes needed**

### 4.3 Update `src/utils/prompt.ts` — Add memory context to cronjob prompts ✅
- **Date**: 2026-02-28
- **Files modified**:
  - `src/utils/prompt.ts` — Updated `buildCronjobPrompt` to accept optional `memoryContext?: string`, prepends it before `[CRONJOB MESSAGE]` when provided
  - `src/cron/executor.ts` — Added `getFundamentalMemories` and `formatFundamentalMemory` imports, loads and formats memory context before building cronjob prompt, with error handling (logs and continues without memory on failure)
  - `src/__tests__/utils/prompt.test.ts` — Added 2 tests: verifies memory context is prepended before `[CRONJOB MESSAGE]`, and verifies no memory block when `memoryContext` is undefined
- **Key details**:
  - Cronjob prompts now include user's fundamental memory context, giving AI user awareness in fresh cronjob sessions
  - Error handling: if memory loading fails, cronjob still fires without memory context (graceful degradation)
  - Memory context is also available via system prompt (Phase 3.3), but including it in the user prompt provides redundancy for fresh sessions
- **Verification**: 145 tests pass (14 test files), `pnpm run type-check` passes
