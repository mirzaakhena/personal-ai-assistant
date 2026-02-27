# Memory Feature — PRD

## Overview

Add a persistent "Memory" system to the personal AI assistant that stores user profile, preferences, routines, relationships, and AI persona in a graph database (SurrealDB embedded). Memory is loaded selectively — fundamental info at conversation start, extended info recalled on-demand mid-conversation. Users have full transparency and control over their memories.

## Comparison with OpenClaw

This system was designed with awareness of [OpenClaw's memory architecture](https://docs.openclaw.ai/concepts/memory). Key differences and trade-offs:

| Aspect | OpenClaw | This System |
|--------|----------|-------------|
| **Storage** | Flat Markdown files on disk | Graph database (SurrealDB) with typed nodes & edges |
| **Search** | Hybrid BM25 + vector embeddings (semantic) | Multi-keyword tokenized search (Phase 0–7), hybrid vector search (Phase 8) |
| **Relationships** | None — flat documents | Explicit graph edges (`knows`, `has_preference`, etc.) |
| **Conflict resolution** | Manual file overwrite | Structured `supersede_memory` with audit trail |
| **Multi-user** | Single agent per workspace | Phone number-scoped, multi-user by design |
| **Context loss prevention** | Auto memory flush before compaction | Prompt-based proactive save (Phase 3), heuristic flush (Phase 9) |
| **Session history** | Indexed session transcripts | Conversation summary indexing (Phase 10) |
| **Temporal relevance** | Exponential decay (30-day half-life) | Temporal data collected from Phase 1, scoring activated in Phase 8 |

**Why graph over flat files:** A personal assistant needs to answer relational queries like "siapa teman kerja aku yang ulang tahunnya bulan ini?" — this requires traversing person → knows → person → birthday, which flat document search cannot do efficiently. The trade-off is less human-readability (database vs. text files), but the `list_memories` tool provides equivalent transparency.

## Tech Decision

- **Database**: SurrealDB embedded via `@surrealdb/node` with `surrealkv://` persistent storage at `data/memory.db`
- **Pattern**: New MCP tools for memory operations, following the existing `src/tools/*.ts` pattern
- **No separate server process** — SurrealDB runs embedded inside the Node.js process
- **Fallback strategy**: If embedded mode (`surrealkv://`) proves unstable, SurrealDB can run as a Docker container on the server and connect via `ws://localhost:8000`. This changes only the connection string — all application code remains identical.

## Architecture Reference

Key files to understand before working:
- `src/tools/server.ts` — MCP server that aggregates all tools (add memory tools here)
- `src/tools/message.ts` — Example tool implementation using `tool()` from claude-agent-sdk
- `src/tools/cronjob.ts` — More complex tool example with validation and DB calls
- `src/core/options.ts` — System prompt and query options (inject memory context here)
- `src/core/constants.ts` — All constants and paths (add memory constants here)
- `src/handlers/message.ts` — Main message handler (load fundamental memory here)
- `src/cron/executor.ts` — Cronjob executor (load relevant memory for cronjob context here)
- `src/utils/prompt.ts` — Prompt building helpers (add memory prompt builder here)
- `src/db/sessions.ts` — Example DB module pattern (follow this for memory DB)
- `package.json` — Dependencies (add surrealdb + @surrealdb/node here)

## Graph Schema

```
COMMON FIELDS (all nodes except person):
  created_at      — datetime, DEFAULT time::now()
  last_accessed   — datetime, optional (updated on recall/query)
  access_count    — int, DEFAULT 0 (incremented on each access)
  embedding       — array<float>, optional (nullable, for future semantic search — Phase 8)

NODES:
  person     — { name, nickname, phone, location, occupation, birthday, type: "self"|"contact", notes, created_at, last_accessed, access_count }
  preference — { category, value, context, importance: "fundamental"|"extended", ...common }
  fact       — { content, category, importance: "fundamental"|"extended", superseded_by (optional record link), ...common }
  routine    — { activity, schedule, details, importance: "fundamental"|"extended", ...common }
  persona    — { name, personality_traits, communication_style, language_preference, ...common }

EDGES (relation tables):
  has_preference  — person -> preference
  has_fact        — person -> fact
  has_routine     — person -> routine
  prefers_persona — person -> persona
  knows           — person -> person { relationship_type, notes, created_at }
```

---

## Tasks

### Phase 0: Spike Test — Validate SurrealDB Embedded

> **Why this phase exists:** PRD assumes all SurrealQL features (SCHEMAFULL, TYPE RELATION, graph traversal, nullable `array<float>`, `DEFAULT time::now()`) work correctly in embedded mode via `surrealkv://`. This has not been verified. A spike test before writing production code prevents wasted effort if a feature is missing or broken.

- [x] **0.1 Create spike test script `development/memory/spike-surrealdb.ts`**
  A standalone script (not part of the app) that validates all SurrealDB features the PRD depends on. Test both `surrealkv://` (file-based) and `mem://` (in-memory) engines:
  1. Connect to embedded SurrealDB with `createNodeEngines()`
  2. `DEFINE TABLE person SCHEMAFULL` — verify SCHEMAFULL works
  3. `DEFINE TABLE knows TYPE RELATION FROM person TO person` — verify relation tables
  4. `DEFINE FIELD type ON person TYPE string ASSERT $value IN ['self', 'contact']` — verify ASSERT
  5. `DEFINE FIELD created_at ON person TYPE option<datetime> DEFAULT time::now()` — verify DEFAULT
  6. `DEFINE FIELD embedding ON fact TYPE option<array<float>>` — verify nullable vector field
  7. Create two person nodes, create a `knows` edge between them
  8. Traverse graph: `SELECT ->knows->person FROM person:self` — verify graph traversal works
  9. Test `string::contains(string::lowercase(...), ...)` — verify search function
  10. Also test SurrealDB full-text search if available: `DEFINE ANALYZER` + `DEFINE INDEX ... SEARCH ANALYZER` — results inform whether concern #5 (keyword limitations) can be solved at DB level

  **Decision gate:**
  - All tests pass → proceed with Phase 1 as-is
  - SCHEMAFULL fails → use SCHEMALESS, enforce validation via Zod in application layer
  - TYPE RELATION fails → use regular tables with `in`/`out` fields to simulate edges
  - Embedded mode fundamentally broken → switch to remote SurrealDB via Docker (change connection string only)

- [ ] **0.2 Verify native addon on production server**
  SSH into the Ubuntu server, install `@surrealdb/node` in a temp directory, run: `node -e "import('@surrealdb/node').then(m => console.log('OK', Object.keys(m)))"`. If it fails, investigate build dependencies or switch to fallback (remote SurrealDB via Docker).

### Phase 1: Infrastructure — SurrealDB Setup

- [x] **1.1 Install SurrealDB dependencies**
  Add `surrealdb` and `@surrealdb/node` packages via pnpm. Add `@surrealdb/node` to the `pnpm.onlyBuiltDependencies` array in package.json (since it's a native addon like better-sqlite3). Run `pnpm install` to verify successful installation.

  > **Cross-platform note:** `@surrealdb/node` compiles per platform (macOS vs Linux). The existing deploy flow (`/restart` → `git pull && pnpm install && pm2 restart`) already reinstalls on the server. No additional action needed — the `onlyBuiltDependencies` config ensures pnpm rebuilds native addons.

- [x] **1.2 Add memory constants to `src/core/constants.ts`**
  Add these constants:
  - `MEMORY_DB_PATH = join(DATA_DIR, 'memory.db')` — SurrealKV storage path
  - `MEMORY_DB_NAMESPACE = 'assistant'` — SurrealDB namespace
  - `MEMORY_DB_DATABASE = 'memory'` — SurrealDB database name
  - `MEMORY_FUNDAMENTAL_LIMIT = 5` — max fundamental memories per category to inject at conversation start. Kept at 5 (not 10) to limit prompt size: 5 items × 4 categories = 20 items × ~50 tokens = ~1000 tokens for memory context.
  - `MEMORY_DECAY_HALF_LIFE_DAYS = 30` — temporal decay half-life for recency scoring (Phase 8, but constant defined now)
  - `MEMORY_EMBEDDING_ENABLED = false` — feature flag for vector embeddings (Phase 8, disabled by default)

- [x] **1.3 Create `src/db/memory.ts` — SurrealDB connection and schema initialization**
  Create the memory database module following the pattern of `src/db/sessions.ts`. This module must:
  1. Import `Surreal` from `surrealdb` and `createNodeEngines` from `@surrealdb/node` and `createRemoteEngines` from `surrealdb`.
  2. Export an `initMemoryDb()` async function that:
     - Creates a new `Surreal` instance with `engines: { ...createRemoteEngines(), ...createNodeEngines() }`.
     - Connects to `surrealkv://${MEMORY_DB_PATH}`.
     - Sets namespace and database via `db.use({ namespace: MEMORY_DB_NAMESPACE, database: MEMORY_DB_DATABASE })`.
     - Runs schema definitions (DEFINE TABLE and DEFINE FIELD statements) for all nodes and edges listed in the Graph Schema section above. Use `DEFINE TABLE ... SCHEMAFULL` for nodes and `DEFINE TABLE ... TYPE RELATION` for edges. For the `person` table, define `type` field as `string` with ASSERT `$value IN ["self", "contact"]`. For `importance` fields, ASSERT `$value IN ["fundamental", "extended"]`.
     - Include temporal fields on all memory tables: `created_at` (datetime, DEFAULT `time::now()`), `last_accessed` (datetime, optional), `access_count` (int, DEFAULT 0). Also include `embedding` field (optional `array<float>`) on `preference`, `fact`, `routine`, `persona` tables — nullable, not populated yet but schema-ready for Phase 8.
     - Returns the `db` instance.
  3. Export a `getMemoryDb()` function that returns the initialized db instance (throw if not initialized).
  4. Export a `closeMemoryDb()` async function that calls `db.close()`.
  Important: SurrealDB operations are async, unlike better-sqlite3. All queries must use `await`.
  Write a unit test in `src/__tests__/db/memory.test.ts` that verifies:
  - `initMemoryDb()` connects successfully (use `mem://` for testing instead of file path — accept an optional connection string parameter to `initMemoryDb` for testability)
  - Schema tables are created (query `INFO FOR DB` and check table names exist)
  - `closeMemoryDb()` closes cleanly

  > **If spike test (Phase 0) revealed issues:** Apply the fallback decisions here — e.g., use SCHEMALESS instead of SCHEMAFULL, or use regular tables instead of TYPE RELATION.

- [x] **1.4 Initialize memory DB in `src/index.ts`**
  In the main entry point:
  1. Import `initMemoryDb` and `closeMemoryDb` from `src/db/memory.ts`.
  2. Call `await initMemoryDb()` before `await client.initialize()`.
  3. In the `shutdown` function, call `await closeMemoryDb()` before `process.exit(0)`.
  This ensures the memory database is ready before any messages are processed and cleanly shut down on exit.

### Phase 2: Core Memory Operations — Database Layer

- [x] **2.1 Create `src/memory/operations.ts` — CRUD operations for memory graph**
  Create a module with high-level async functions for memory operations. All functions take `phoneNumber` as the first argument to scope memory per user. Import `getMemoryDb` from `src/db/memory.ts`.

  > **Multi-user isolation:** All queries MUST use parameterized `$phone` — never hardcode phone numbers. This is the primary isolation mechanism. DB-level permissions (SurrealDB `PERMISSIONS` or namespace-per-user) are over-engineered for a single-process embedded app. Isolation is verified via unit tests in Phase 5.1.

  **Person operations:**
  - `getOrCreateSelfPerson(phoneNumber: string): Promise<string>` — Get or create the "self" person node. Use `phone` as identifier. Query: `SELECT * FROM person WHERE phone = $phone AND type = 'self'`. If not found, create one. Returns the record ID string.
  - `upsertContact(phoneNumber: string, contactName: string, relationship: string, notes?: string): Promise<string>` — Create or update a contact and create a `knows` edge from self to contact. Returns the contact record ID.

  **Memory save/update/delete:**
  - `saveMemory(phoneNumber: string, table: 'preference'|'fact'|'routine'|'persona', data: Record<string, unknown>): Promise<string>` — Create a node in the given table with `created_at = time::now()`, `access_count = 0`, `embedding = null`. Create the appropriate edge from the self person. Edge mapping: preference→has_preference, fact→has_fact, routine→has_routine, persona→prefers_persona. Returns new record ID.
  - `updateMemory(recordId: string, data: Record<string, unknown>): Promise<void>` — Update an existing memory node by its full record ID.
  - `deleteMemory(recordId: string): Promise<void>` — Delete a memory node and its related edges. **Must clean up edges before deleting node** to prevent orphaned/dangling edges in the graph. Implementation:
    ```sql
    -- Delete all edges pointing TO this record (out = target node)
    DELETE FROM has_preference WHERE out = $recordId;
    DELETE FROM has_fact WHERE out = $recordId;
    DELETE FROM has_routine WHERE out = $recordId;
    DELETE FROM prefers_persona WHERE out = $recordId;
    -- Then delete the node itself
    DELETE $recordId;
    ```
    Wrap in a helper `deleteNodeWithEdges(recordId)` that determines the edge table from the record's table prefix (e.g., `fact:xxx` → `has_fact`).
  - `supersedeMemory(oldRecordId: string, phoneNumber: string, table: string, newData: Record<string, unknown>): Promise<string>` — Create new memory, update old one's `superseded_by` to point to new record. Returns new record ID.

  **Query operations:**
  - `getFundamentalMemories(phoneNumber: string): Promise<object>` — Returns `{ profile: {...}, persona: {...}, preferences: [...], facts: [...], routines: [...] }`. Query self person, traverse edges to get memories where `importance = 'fundamental'`. Limit to `MEMORY_FUNDAMENTAL_LIMIT` per category. Bump `last_accessed` and increment `access_count` on all returned memory nodes.
  - `recallMemories(phoneNumber: string, query: string): Promise<object[]>` — Search memories using **multi-keyword tokenized matching**: split query into individual words, search each word independently via `string::contains(string::lowercase(...))` across `value`, `content`, `activity`, `details` fields. Score each result by `matched_tokens / total_tokens` and sort descending. This improves recall over single-substring matching (e.g., query "ngopi pagi" matches a record containing "pagi" even if it doesn't contain "ngopi"). Bump `last_accessed` and increment `access_count` on returned results. Recency-weighted scoring will be layered on top in Phase 8 — for now, just collect the temporal data.
  - `getAllMemories(phoneNumber: string): Promise<object>` — Get all memories grouped by type.
  - `getRelationships(phoneNumber: string): Promise<object[]>` — Get all `knows` edges from self person with contact details.

  Write unit tests in `src/__tests__/memory/operations.test.ts` for each function using in-memory SurrealDB (`mem://`).

- [x] **2.2 Create `src/memory/formatter.ts` — Format memories for prompt injection**
  Create a module that formats memory data into readable text for prompts.
  - `formatFundamentalMemory(memories: object): string` — Format output of `getFundamentalMemories()` as:
    ```
    [MEMORY CONTEXT]

    About the user:
    - Name: Mirza
    - Location: Jakarta
    - Occupation: Software Engineer

    AI Persona:
    - Communication style: casual, friendly

    Key preferences:
    - Suka ngopi hitam setiap pagi

    Key routines:
    - Ngopi setiap pagi jam 7

    Key facts:
    - Alergi kacang
    ```
    If memory is empty (no self person), return: `[MEMORY CONTEXT]\n\nNo memories stored yet. This appears to be a new user — consider introducing yourself.`
  - `formatRecalledMemories(memories: object[]): string` — Format recalled memories for mid-conversation context.
  - `formatAllMemories(memories: object): string` — Detailed format including record IDs for user transparency (so user can reference IDs for deletion).

  Write unit tests in `src/__tests__/memory/formatter.test.ts`.

### Phase 3: MCP Tools — Memory Tools for AI

- [x] **3.1 Create `src/tools/memory.ts` — Memory MCP tools**
  Create memory tools following the pattern of `src/tools/cronjob.ts`. Define `MemoryContext` type: `{ phoneNumber: string }`. Export `createMemoryTools(ctx: MemoryContext)` returning tool array.

  **Tool 1: `save_memory`** — Save new memory (preference, fact, routine, persona, contact). Parameters: `memory_type` (enum), `data` (z.record for flexibility, validate per type in handler). Returns `{ success, record_id }`.

  **Tool 2: `update_memory`** — Update or supersede existing memory. Parameters: `record_id` (string), `new_data` (record), `supersede` (boolean, optional, default false). If supersede=true, creates new + marks old.

  **Tool 3: `recall_memory`** — Search memories by keyword/topic. Parameters: `query` (string), `type_filter` (optional enum). Returns formatted text of matching memories.

  **Tool 4: `list_memories`** — List all stored memories. No parameters. Returns formatted text with record IDs.

  **Tool 5: `forget_memory`** — Delete memory by record ID. Parameters: `record_id` (string). Returns `{ success }`.

  Write unit tests in `src/__tests__/tools/memory.test.ts` that mock memory operations and verify tool behavior.

- [ ] **3.2 Register memory tools in `src/tools/server.ts`**
  Update `createMessageServer` to accept `MemoryContext` parameter. Import and spread `createMemoryTools(memCtx)` into the tools array alongside existing message and cronjob tools. Update the function signature and all callers: `src/core/options.ts`, `src/handlers/message.ts`, `src/cron/executor.ts`.

- [ ] **3.3 Update `src/core/options.ts` — Memory-aware system prompt and query options**
  1. Update `createQueryOptions` signature to accept `phoneNumber: string` and `memCtx: MemoryContext`.
  2. Load fundamental memory: `await getFundamentalMemories(phoneNumber)`, format with `formatFundamentalMemory()`.
  3. Append formatted memory block to the end of the system prompt.
  4. Add MEMORY SYSTEM instructions to the system prompt (after CRONJOB MANAGEMENT):
     ```
     MEMORY SYSTEM:
     You have access to a persistent memory system that stores information about the user across conversations.

     MEMORY LOADING:
     - Fundamental memories (name, location, job, persona, key preferences) are automatically loaded at conversation start.
     - For additional context mid-conversation, use `recall_memory` to search specific topics.

     WHEN TO SAVE MEMORIES:
     - User shares personal info (name, location, job, birthday) → save as "fact" with importance "fundamental"
     - User expresses preferences → save as "preference"
     - User describes routines ("I always...", "every morning I...") → save as "routine"
     - User mentions people they know → save as "contact"
     - User requests specific AI personality → save as "persona"
     - User explicitly says "remember this" or "ingat ya" → always save

     IMPORTANCE CLASSIFICATION:
     - "fundamental" (auto-loaded every conversation):
       - Name, location, occupation, birthday
       - Primary language preference
       - AI persona settings
       - Top 3 routines (by frequency)
       - Critical facts (allergies, important dates)
     - "extended" (recalled on-demand):
       - Hobbies, favorite things (food, color, music)
       - Non-critical preferences
       - Infrequent routines
       - Historical facts (past jobs, past addresses)
     - RULE: When unsure, default to "extended". Only classify as "fundamental" if user explicitly says it's important or if it's essential context for every conversation.

     WHEN TO UPDATE MEMORIES:
     - When new info contradicts existing memory → use `update_memory` with supersede=true
     - Confirm the update: "Noted, I've updated that you now live in Bandung"

     WHEN TO RECALL MEMORIES:
     - User mentions a person's name → recall relationship info
     - Topic shifts to something you might have context for
     - You need more detail beyond fundamental memory

     TRANSPARENCY:
     - "What do you know about me?" → use `list_memories`
     - "Forget X" → use `forget_memory` after confirming
     - Be honest about what you remember

     NEW USER ONBOARDING:
     - If memory context shows "No memories stored yet" → new user
     - Introduce yourself warmly, naturally ask their name
     - Don't interrogate — gather info gradually over conversations
     - Save name immediately as fundamental fact when learned

     CONTEXT PRESERVATION:
     - If a conversation has been long and contains important new information that hasn't been saved yet, proactively save it using `save_memory` before the conversation ends.
     - When you notice the user sharing multiple pieces of personal info in one conversation, save them incrementally — don't wait until the end.
     - Prioritize saving: corrections to existing memories, new contacts/relationships, explicit "remember this" requests.
     ```
  5. Pass `memCtx` through to `createMessageServer`.

### Phase 4: Message Handler Integration

- [ ] **4.1 Update `src/handlers/message.ts` — Wire memory into message processing**
  1. Import `MemoryContext` from `src/tools/memory.ts`.
  2. After creating `cronCtx`, create `memCtx: MemoryContext = { phoneNumber }`.
  3. Update `createQueryOptions` call to pass `phoneNumber` and `memCtx`.

- [ ] **4.2 Update `src/cron/executor.ts` — Wire memory into cronjob execution**
  1. Import `MemoryContext` from `src/tools/memory.ts`.
  2. Create `memCtx: MemoryContext = { phoneNumber }`.
  3. Update `createQueryOptions` call to pass `phoneNumber` and `memCtx`.
  This ensures AI has user context when executing scheduled messages.

- [ ] **4.3 Update `src/utils/prompt.ts` — Add memory context to cronjob prompts**
  Update `buildCronjobPrompt` to accept optional `memoryContext?: string`. If provided, prepend it before `[CRONJOB MESSAGE]`. Update caller in `src/cron/executor.ts` to load and format fundamental memory, then pass it to `buildCronjobPrompt`. This gives AI user context in fresh cronjob sessions.

### Phase 5: Testing & Verification

- [ ] **5.1 Write integration test for full memory flow**
  Create `src/__tests__/memory/integration.test.ts`:
  1. Init memory DB with `mem://`
  2. Save fundamental fact (user name) → verify saved
  3. Save preference → verify saved
  4. Save contact with relationship → verify saved
  5. `getFundamentalMemories()` → verify returns correct data
  6. `recallMemories()` → verify multi-keyword tokenized search works (test: "ngopi pagi" matches record with "pagi hari")
  7. `supersedeMemory()` → verify old marked, new created
  8. `deleteMemory()` → verify node AND edges removed (no orphaned edges)
  9. `getAllMemories()` → verify grouped output
  10. `formatFundamentalMemory()` → verify both empty and populated states
  11. **Multi-user isolation test:** Create memories for phone number A, query with phone number B → assert empty result. Create memories for B → verify A's memories unchanged. This guards against missing `WHERE phone = $phone` in queries.

- [ ] **5.2 Run full test suite and fix any issues**
  Run `pnpm test` to execute all tests. Fix any failures. Run `pnpm run type-check` to verify no TypeScript errors. Ensure no regressions in existing tests.

### Phase 6: Cron-Memory Integration

- [ ] **6.1 Enhance cronjob tool description for memory-aware scheduling**
  Update `create_cronjob` tool description in `src/tools/cronjob.ts` to add:
  `"You can also create memory-triggered reminders, e.g., birthday reminders for contacts. Include relevant memory context in the message field so your future self knows the context."`
  This is description-only — the cron system already works, we just teach AI it can use crons for memory-related reminders.

### Phase 7: Documentation

- [ ] **7.1 Add memory section to project documentation**
  Create `docs/memory.md` documenting:
  - What the memory system does
  - Graph schema (nodes and edges)
  - Fundamental vs extended memory
  - Available memory tools and their usage
  - Scheduler integration
  - User transparency and memory management

---

## Future Phases (Inspired by OpenClaw Comparison)

> These phases address gaps identified by comparing with OpenClaw's memory system.
> They are not blockers for initial launch but significantly improve recall quality and resilience.

### Phase 8: Semantic Search & Temporal Relevance

> **Note:** Schema fields (`created_at`, `last_accessed`, `access_count`, `embedding`) and temporal data collection are already implemented in Phase 1–2. This phase activates the scoring and vector search on top of that foundation.

- [ ] **8.1 Add recency-weighted scoring to `recallMemories()`**
  Implement temporal decay scoring inspired by OpenClaw's approach. `created_at`, `last_accessed`, and `access_count` are already being collected since Phase 1–2. `MEMORY_DECAY_HALF_LIFE_DAYS` constant already defined in Phase 1.2.
  - Calculate a recency score: `score = e^(-λ * days_since_creation)` where λ = `ln(2) / MEMORY_DECAY_HALF_LIFE_DAYS`
  - Combine keyword match with recency: `final_score = match_score * 0.7 + recency_score * 0.3`
  - Memories with `importance = 'fundamental'` skip decay (always score 1.0 for recency) — equivalent to OpenClaw's "evergreen files"
  - Sort results by `final_score` descending

- [ ] **8.2 Add vector embedding generation**
  The `embedding` field already exists in the schema (nullable, added in Phase 1.3). This task activates it:
  1. Create `src/memory/embeddings.ts` module:
     - `generateEmbedding(text: string): Promise<number[]>` — Generate embedding using a provider. Start with OpenAI `text-embedding-3-small` (1536 dims). Accept provider config via environment variable `MEMORY_EMBEDDING_PROVIDER` (default: none/disabled).
     - `cosineSimilarity(a: number[], b: number[]): number` — Compute similarity score
  2. Update `saveMemory()` to generate and store embeddings when `MEMORY_EMBEDDING_ENABLED` is true (constant already defined in Phase 1.2)
  3. Backfill script: create `src/memory/backfill-embeddings.ts` that iterates all existing memories with `embedding = null` and generates embeddings. Run once after enabling the feature.

  > **Vector search performance note:** 1000 memories × 1536 dims × 4 bytes = ~6MB — trivially small. Full table scan with `vector::similarity::cosine()` is fast at this scale without a dedicated index. If memory count exceeds 10K records (unlikely for personal assistant), add `DEFINE INDEX ... MTREE DIMENSION 1536` — test availability in embedded mode during spike (Phase 0.1 step 10).

- [ ] **8.3 Implement hybrid search in `recallMemories()`**
  When embeddings are enabled, combine keyword + semantic search (inspired by OpenClaw's 70/30 hybrid):
  1. Run existing keyword search → normalize scores to [0, 1]
  2. Generate embedding for query → run vector similarity against stored embeddings using SurrealQL `vector::similarity::cosine()`
  3. Merge results: `final_score = (vector_weight * vector_score) + (keyword_weight * keyword_score) + (recency_weight * recency_score)`
  4. Add constants: `MEMORY_VECTOR_WEIGHT = 0.5`, `MEMORY_KEYWORD_WEIGHT = 0.3`, `MEMORY_RECENCY_WEIGHT = 0.2`
  5. When embeddings are disabled, fall back to keyword + recency only (graceful degradation)

  Write unit tests covering: keyword-only mode, hybrid mode, and score merging logic.

- [ ] **8.4 Auto-promotion/demotion of importance level**
  Leverage `access_count` data collected since Phase 1 to suggest importance changes:
  - If an `extended` memory has `access_count >= 5` → suggest promotion to `fundamental`
  - If a `fundamental` memory has not been accessed in 30+ days → suggest demotion to `extended`
  - Add system prompt instruction: "Periodically review memory access patterns and suggest re-classification."

### Phase 9: Heuristic Auto Memory Flush

> **Note:** The prompt-based CONTEXT PRESERVATION instructions are already included in Phase 3.3 system prompt. This phase adds a **heuristic** trigger that works without SDK support.

- [ ] **9.1 Implement turn-based memory flush heuristic**
  Since Claude Agent SDK does not currently expose token count or pre-compaction hooks, use a turn-count heuristic as a practical alternative:
  1. Track turn count per session in the message handler
  2. When `session.turns >= MAX_TURNS * 0.7` (e.g., 7 of 10 turns), inject a system-level reminder into the next query: "You are nearing the session turn limit. If the user shared important information in this conversation that hasn't been saved to memory yet, save it now using `save_memory`."
  3. This is a lightweight addition to `src/handlers/message.ts` — no SDK changes required

  **Future upgrade:** When Claude Agent SDK exposes `session.tokenCount` or an `onBeforeCompaction` hook, replace the turn heuristic with a token-based trigger for more accuracy.

### Phase 10: Conversation Summary Indexing

- [ ] **10.1 Add `conversation_summary` node type to graph schema**
  Inspired by OpenClaw's session memory indexing. Store conversation summaries so AI can recall past interactions.

  Update schema:
  ```
  NODE:
    conversation_summary — { date: datetime, summary: string, topics: array<string>, key_decisions: array<string>, embedding: array<float> (optional) }

  EDGE:
    had_conversation — person -> conversation_summary
  ```

- [ ] **10.2 Create conversation summary generation**
  Create `src/memory/summarizer.ts`:
  - `generateConversationSummary(messages: Message[]): Promise<{ summary: string, topics: string[], key_decisions: string[] }>` — Use the AI model to generate a concise summary of the conversation, extract discussed topics, and identify any decisions or action items.
  - **Trigger mechanism:** Generate summary when user runs `/new` command (explicit session boundary). The existing `/new` handler already clears the session — add summary generation before clearing. This is more reliable than time-based gap detection, which is unreliable for WhatsApp (user may continue the same topic after hours, or switch topics within minutes).
  - **Secondary trigger (optional):** Also generate summary if message gap exceeds 2 hours (not 30 minutes). Use a longer timeout to reduce false positives. If user continues after the gap, append to existing summary rather than creating a new one.

- [ ] **10.3 Add `recall_conversations` tool**
  New MCP tool to search past conversation summaries:
  - Parameters: `query` (string), `date_range` (optional: `{ from, to }`)
  - Search by topic keywords or semantic similarity (if embeddings enabled)
  - Returns: list of matching conversation summaries with dates
  - Enables queries like "kapan terakhir kita bahas soal liburan?" or "apa yang kita obrolin kemarin?"

- [ ] **10.4 Update system prompt for conversation recall**
  Add to MEMORY SYSTEM instructions:
  ```
  CONVERSATION HISTORY:
  - Use `recall_conversations` to search past conversation summaries when:
    - User asks "kapan kita bahas..." or "kemarin kita ngomong apa?"
    - You need context from a previous session to answer coherently
    - User references a past discussion or decision
  ```

### Phase 11: Graph-Powered Relational Queries

- [ ] **11.1 Add `query_relationships` tool**
  Leverage the graph database advantage over flat-file systems. New MCP tool:
  - Parameters: `query_type` (enum: "contacts_by_attribute", "mutual_connections", "upcoming_birthdays", "related_memories"), `filters` (record)
  - Example queries the tool should support:
    - "contacts_by_attribute" + `{ occupation: "engineer" }` → find all contacts who are engineers
    - "upcoming_birthdays" + `{ days_ahead: 30 }` → contacts with birthdays in next 30 days
    - "related_memories" + `{ person_name: "Budi" }` → all memories connected to a specific person
  - Uses SurrealQL graph traversal: `SELECT ->knows->person WHERE ...` and multi-hop queries

- [ ] **11.2 Update system prompt for relational queries**
  Add to MEMORY SYSTEM instructions:
  ```
  RELATIONAL QUERIES:
  - Use `query_relationships` for questions about connections between people and memories
  - Examples: "siapa aja teman kerja aku?", "ada yang ulang tahun bulan ini?", "apa yang aku tahu tentang Budi?"
  - The graph database can traverse relationships that keyword search cannot
  ```
