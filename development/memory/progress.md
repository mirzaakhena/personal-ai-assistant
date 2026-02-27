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

## Phase 5: Testing & Verification

### 5.1 Write integration test for full memory flow ✅
- **Date**: 2026-02-28
- **File created**: `src/__tests__/memory/integration.test.ts` — 12 integration tests
- **Test coverage**:
  1. Save fundamental fact (user name) → verify saved and retrieved
  2. Save preference → verify saved and retrieved
  3. Save contact with relationship → verify saved and retrieved via getRelationships
  4. getFundamentalMemories returns correct data structure (profile, persona, preferences, facts, routines)
  5. recallMemories multi-keyword tokenized search ("pagi hari" matches record with "pagi hari")
  6. supersedeMemory marks old record, creates new with correct content
  7. deleteMemory removes node AND edges (no orphaned edges)
  8. getAllMemories returns grouped output by type
  9. formatFundamentalMemory formats empty state (new user message)
  10. formatFundamentalMemory formats populated state with correct sections
  11. Multi-user isolation: memories for phone A not visible to phone B (getFundamentalMemories, recallMemories, getAllMemories, getRelationships all return empty)
  12. Multi-user isolation: creating memories for phone B does not affect phone A's memories
- **Verification**: 157 tests pass (15 test files), no regressions

### 5.2 Run full test suite and fix any issues ✅
- **Date**: 2026-02-28
- **Result**: All 157 tests pass across 15 test files, no failures or regressions
- **Type-check**: `pnpm run type-check` (tsc --noEmit) passes with no errors
- **No fixes needed**: All tests green, no TypeScript errors

## Phase 6: Cron-Memory Integration

### 6.1 Enhance cronjob tool description for memory-aware scheduling ✅
- **Date**: 2026-02-28
- **File modified**: `src/tools/cronjob.ts`
- **Changes**: Added memory-triggered reminder guidance to `create_cronjob` tool description: "You can also create memory-triggered reminders, e.g., birthday reminders for contacts. Include relevant memory context in the message field so your future self knows the context."
- **Key details**: Description-only change — no logic, no new tests needed. Teaches the AI it can use the existing cron system for memory-related reminders (e.g., birthday reminders for contacts stored in memory).
- **Verification**: All 157 tests pass (15 test files), no regressions

## Phase 7: Documentation

### 7.1 Add memory section to project documentation ✅
- **Date**: 2026-02-28
- **File created**: `docs/memory.md`
- **Sections documented**:
  - Architecture overview (SurrealDB embedded, key files)
  - Graph schema (nodes and edges with field descriptions)
  - Fundamental vs extended memory classification
  - All 5 MCP tools with parameters and behavior
  - Scheduler integration (memory-aware cronjob prompts)
  - User transparency and memory management
  - New user onboarding flow
- **No tests needed**: Documentation-only task

## Phase 8: Semantic Search & Temporal Relevance

### 8.1 Add recency-weighted scoring to `recallMemories()` ✅
- **Date**: 2026-02-28
- **Files modified**:
  - `src/memory/operations.ts` — Added `calculateRecencyScore()` function and recency-weighted scoring to `recallMemories()`
  - `src/__tests__/memory/operations.test.ts` — Added 8 new tests (6 for `calculateRecencyScore` unit tests, 2 for recency-weighted recall integration)
- **Key details**:
  - Exponential decay formula: `score = e^(-λ * days_since_creation)` where `λ = ln(2) / 30` (30-day half-life)
  - Combined scoring: `final_score = 0.7 * keyword_match + 0.3 * recency_score`
  - Fundamental memories always get recency score of 1.0 (skip decay — equivalent to OpenClaw's "evergreen files")
  - Missing timestamps default to 0.5 recency score
  - Handles SurrealDB Datetime objects, JS Date, and string dates robustly
  - `calculateRecencyScore` exported for direct unit testing
- **Test coverage**:
  - `calculateRecencyScore`: fundamental always 1.0, just-created ~1.0, 30-day half-life ~0.5, 60-day ~0.25, missing timestamps, string dates
  - Recall integration: recent memories rank higher than old with same keyword match; fundamental memories not penalized by age
- **Verification**: 165 tests pass (15 test files), `pnpm run type-check` passes, no regressions

### 8.2 Add vector embedding generation ✅
- **Date**: 2026-02-28
- **Files created**:
  - `src/memory/embeddings.ts` — Vector embedding generation module with OpenAI provider support
  - `src/__tests__/memory/embeddings.test.ts` — 12 unit tests for cosineSimilarity and generateEmbedding
  - `src/memory/backfill-embeddings.ts` — Standalone backfill script for populating embeddings on existing records
- **Files modified**:
  - `src/memory/operations.ts` — Updated `saveMemory()` to generate and store embeddings when `MEMORY_EMBEDDING_ENABLED` env var is `true`
  - `src/__tests__/memory/operations.test.ts` — Added 3 tests for saveMemory embedding integration
- **Exports**: `generateEmbedding(text): Promise<number[] | null>`, `cosineSimilarity(a, b): number`
- **Key details**:
  - `cosineSimilarity` — Pure function computing cosine similarity between two vectors, returns value in [-1, 1]
  - `generateEmbedding` — Async function that calls embedding provider API. Returns null when no provider configured, API key missing, or on error. Currently supports OpenAI `text-embedding-3-small` (1536 dims)
  - Provider configured via `MEMORY_EMBEDDING_PROVIDER` env var (supports: `openai`). API key via `OPENAI_API_KEY` env var
  - `saveMemory()` checks `MEMORY_EMBEDDING_ENABLED` env var at runtime (not module-level constant) for runtime togglability without restart
  - Embedding text is built from searchable fields per table (same fields used by keyword search)
  - Backfill script: `MEMORY_EMBEDDING_PROVIDER=openai OPENAI_API_KEY=sk-... npx tsx src/memory/backfill-embeddings.ts` — iterates all records with `embedding = NONE` and generates embeddings
  - `MEMORY_EMBEDDING_ENABLED` constant in `constants.ts` kept as `false` for documentation; actual feature check is via env var in `saveMemory`
- **Verification**: 180 tests pass (16 test files), `pnpm run type-check` passes, no regressions

### 8.3 Implement hybrid search in `recallMemories()` ✅
- **Date**: 2026-02-28
- **Files modified**:
  - `src/core/constants.ts` — Added `MEMORY_VECTOR_WEIGHT` (0.5), `MEMORY_KEYWORD_WEIGHT` (0.3), `MEMORY_RECENCY_WEIGHT` (0.2) constants for hybrid search
  - `src/memory/operations.ts` — Updated `recallMemories()` to support hybrid keyword+vector+recency search
  - `src/__tests__/memory/operations.test.ts` — Added 5 unit tests for hybrid search modes
- **Key details**:
  - When embeddings enabled (`MEMORY_EMBEDDING_ENABLED=true` env var) and query embedding succeeds: uses hybrid weights `vector(0.5) + keyword(0.3) + recency(0.2)`
  - When embeddings disabled or query embedding fails: gracefully falls back to keyword-only weights `keyword(0.7) + recency(0.3)` (existing behavior preserved)
  - Vector similarity uses cosine similarity normalized from [-1,1] to [0,1]: `(cosine + 1) / 2`
  - Results with no keyword match but high vector similarity (>0.5 normalized, i.e., cosine>0 original) are included in hybrid mode — enables semantic-only matches
  - Results with keyword+vector match rank higher than keyword-only matches
  - Items without stored embeddings get `vectorScore = 0` (graceful degradation for old records)
- **Test coverage**:
  - Keyword-only mode when embeddings disabled
  - Hybrid mode with embeddings enabled and query embedding succeeds
  - Graceful fallback when embeddings enabled but query embedding fails
  - Vector-only matches (no keyword match) included in hybrid mode
  - Keyword+vector matches rank higher than keyword-only matches
- **Verification**: 185 tests pass (16 test files), `pnpm run type-check` passes, no regressions

### 8.4 Auto-promotion/demotion of importance level ✅
- **Date**: 2026-02-28
- **Files modified**:
  - `src/core/constants.ts` — Added `MEMORY_PROMOTION_ACCESS_THRESHOLD` (5) and `MEMORY_DEMOTION_INACTIVE_DAYS` (30) constants
  - `src/memory/operations.ts` — Added `getImportanceSuggestions()` function and `ImportanceSuggestion` interface
  - `src/core/options.ts` — Added IMPORTANCE RE-CLASSIFICATION section to system prompt
  - `src/__tests__/memory/operations.test.ts` — Added 6 unit tests for promotion/demotion logic
- **Exports**: `getImportanceSuggestions(phoneNumber): Promise<ImportanceSuggestion[]>`, `ImportanceSuggestion` interface
- **Key details**:
  - Promotion: extended memories with `access_count >= 5` are suggested for promotion to fundamental
  - Demotion: fundamental memories with `last_accessed` older than 30 days are suggested for demotion to extended
  - Skips superseded facts and persona table (personas don't have importance levels)
  - System prompt instructs AI to periodically review access patterns and suggest re-classification with user confirmation
  - Handles SurrealDB Datetime objects, JS Date, and string dates robustly (same pattern as `calculateRecencyScore`)
- **Test coverage**:
  - Suggests promotion for extended memories with access_count >= 5
  - Suggests demotion for fundamental memories not accessed in 30+ days
  - Does not suggest demotion for recently accessed fundamental memories
  - Does not suggest promotion for low access count extended memories
  - Returns empty for unknown users
  - Skips superseded facts
- **Verification**: 191 tests pass (16 test files), `pnpm run type-check` passes, no regressions

## Phase 9: Heuristic Auto Memory Flush

### 9.1 Implement turn-based memory flush heuristic ✅
- **Date**: 2026-02-28
- **Files created**:
  - `src/core/turns.ts` — In-memory turn counter per phone number with flush reminder logic
  - `src/__tests__/core/turns.test.ts` — 11 unit tests covering increment, clear, isolation, and threshold detection
- **Files modified**:
  - `src/core/constants.ts` — Added `MEMORY_FLUSH_TURN_THRESHOLD = 7` (~70% of MAX_TURNS)
  - `src/handlers/message.ts` — Imported turn tracker; increments turn count per message, clears on `/new`, passes `flushReminder` flag to `createQueryOptions`
  - `src/core/options.ts` — Added `MEMORY_FLUSH_REMINDER` constant with save-reminder text; `createQueryOptions` accepts optional `injectFlushReminder` param and appends reminder to system prompt when true
  - `src/__tests__/core/options.test.ts` — Added 1 test verifying `MEMORY_FLUSH_REMINDER` content
- **Key details**:
  - Turn-count heuristic: tracks user messages per session in-memory map, triggers at turn 7+ (of 10 max)
  - When threshold reached, appends `[MEMORY FLUSH REMINDER]` to system prompt instructing AI to save any unsaved important information
  - Cron executor unaffected — defaults to `injectFlushReminder = false` (single-turn jobs don't need flush)
  - Turn count cleared on `/new` alongside session and stats
  - Lightweight implementation — no SDK changes required, pure application-layer heuristic
- **Verification**: 203 tests pass (17 test files), `pnpm run type-check` passes, no regressions

## Phase 10: Conversation Summary Indexing

### 10.1 Add `conversation_summary` node type to graph schema ✅
- **Date**: 2026-02-28
- **Files modified**:
  - `src/db/memory.ts` — Added `conversation_summary` SCHEMAFULL table and `had_conversation` TYPE RELATION edge table to schema
  - `src/__tests__/db/memory.test.ts` — Added 4 new tests for conversation_summary schema; updated existing table enumeration test
- **Schema additions**:
  - `conversation_summary` node: `date` (datetime, DEFAULT time::now()), `summary` (string), `topics` (array\<string\>), `key_decisions` (array\<string\>), `created_at`, `last_accessed`, `access_count`, `embedding` (option\<array\<float\>\>)
  - `had_conversation` edge: person → conversation_summary, with `created_at` field
- **Test coverage**:
  - Table presence in schema (conversation_summary + had_conversation)
  - All fields stored and retrieved correctly with DEFAULT date
  - Relation edge traversal (person→had_conversation→conversation_summary)
  - Nullable embedding field support
- **Verification**: 207 tests pass (17 test files), `pnpm run type-check` passes, no regressions
