# src-v4 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from `src-v3/` to `src-v4/` — an agnostic, skill-driven rebuild where the AI writes its own per-user skills, recovers context from infrastructure after restart, and the core system prompt has zero domain-specific hardcoding.

**Architecture:** Parallel build, bottom-up, following the v2→v3 migration pattern. Reuse all behavior-free infrastructure verbatim. Rewrite the system prompt and wake-up flow from scratch. Add skill write-side tools (discovery handled by Claude Agent SDK via per-user `cwd`). Add session summarization for cold-start continuity. Cutover is a one-line flip in `package.json`.

**Tech Stack:**
- TypeScript 5.9 (ESM, `NodeNext`)
- `@anthropic-ai/claude-agent-sdk` for LLM + native skill discovery
- `better-sqlite3` for persistent storage (schema unchanged from v3)
- `vitest` for unit tests; `tsx` for integration smoke scripts
- `pnpm` for package management

**Reference spec:** `docs/superpowers/specs/2026-04-21-src-v4-design.md`

---

## Prerequisites & Conventions

- Every src-v4 file uses `.js` import suffixes (`NodeNext` requires this even for `.ts` sources).
- Unit tests live alongside source: `src-v4/<path>/<name>.test.ts`.
- Integration smoke tests go in `scripts/test-v4-*.ts`, runnable via `tsx`.
- Commit after each task (frequent commits). No hook-bypassing, no force-amend.
- All `data/users/<uid>/` paths use `DATA_DIR` resolved from env or default.
- `v3` stays runnable in parallel throughout. Only Task 24 flips the dev script.

---

## Task 0: Bootstrap src-v4 and tsconfig

**Files:**
- Create: `src-v4/` (empty directory)
- Modify: `tsconfig.json`

- [ ] **Step 1: Create the v4 directory tree scaffold**

```bash
mkdir -p src-v4/{core,ai-engine,db,skills,tools,cron,gateway,trigger,utils}
```

- [ ] **Step 2: Update tsconfig.json to include both v3 and v4 during transition**

Read the current tsconfig.json first, then replace `rootDir` and `include`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2020", "DOM"],
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src-v3/**/*", "src-v4/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

(Note: removed `rootDir` because we now include two roots.)

- [ ] **Step 3: Verify compilation baseline**

Run: `pnpm type-check`
Expected: PASS (src-v3 still compiles; src-v4 is empty so no errors).

- [ ] **Step 4: Commit**

```bash
git add src-v4 tsconfig.json
git commit -m "chore(v4): bootstrap src-v4 directory scaffold"
```

---

# Phase 1 — Utils foundation

Ten pure-helper files copy verbatim. No behavior changes.

## Task 1: Copy utils verbatim

**Files to create in `src-v4/utils/` (copy from `src-v3/utils/`):**
- `logger.ts`, `time.ts`, `queue.ts`, `model-config.ts`, `pricing.ts`, `context-limits.ts`, `media.ts`, `stats.ts`, `turns.ts`, `prompt.ts`

- [ ] **Step 1: Copy all 10 files**

```bash
cd /Users/mirza/Workspace/personal-ai-assistant6
for f in logger time queue model-config pricing context-limits media stats turns prompt; do
  cp "src-v3/utils/$f.ts" "src-v4/utils/$f.ts"
done
```

- [ ] **Step 2: Rewrite the leading path comment in each file**

Each file starts with a `// src-v3/utils/<name>.ts` comment. Update to `// src-v4/utils/<name>.ts`.

Use `grep -l "src-v3/utils/" src-v4/utils/*.ts` to list affected files, then Edit each to replace `src-v3` with `src-v4` in the leading comment only.

- [ ] **Step 3: Verify compile**

Run: `pnpm type-check`
Expected: PASS. These files have no imports from other src-v3 files (leaf utils), so no further fixes.

- [ ] **Step 4: Commit**

```bash
git add src-v4/utils
git commit -m "feat(v4): copy utils foundation verbatim from v3"
```

---

# Phase 2 — DB layer

Seven files verbatim, two edited (message + sessions), one edited to split bundle.

## Task 2: Copy DB files verbatim

**Files to create in `src-v4/db/` (copy from `src-v3/db/`):**
- `memory.ts`, `cronjobs.ts`, `tasks.ts`, `habits.ts`, `user-db-cache.ts`, `query-costs.ts`

- [ ] **Step 1: Copy files**

```bash
for f in memory cronjobs tasks habits user-db-cache query-costs; do
  cp "src-v3/db/$f.ts" "src-v4/db/$f.ts"
done
```

- [ ] **Step 2: Update leading path comments (src-v3 → src-v4) in each file**

Use Edit tool on each of the 6 files to change the `// src-v3/db/<name>.ts` header.

- [ ] **Step 3: Verify compile**

Run: `pnpm type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-v4/db
git commit -m "feat(v4): copy db layer verbatim (memory, cronjobs, tasks, habits, cache, costs)"
```

## Task 3: Extend db/message.ts with getRecentMessages and getMessagesByIds

**Files:**
- Create: `src-v4/db/message.ts` (copy of v3 + new methods)
- Create: `src-v4/db/message.test.ts` (vitest)

- [ ] **Step 1: Copy v3 file and update the header comment**

```bash
cp src-v3/db/message.ts src-v4/db/message.ts
```

Then Edit the leading comment from `// src-v3/db/message.ts` to `// src-v4/db/message.ts`.

- [ ] **Step 2: Write the failing test**

Create `src-v4/db/message.test.ts`:

```typescript
// src-v4/db/message.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createMessageStore, type MessageRecord } from './message.js';

function sampleRecord(id: string, ts: number, body: string): MessageRecord {
  return {
    id,
    gateway: 'console',
    session_id: 'sess-1',
    sender: 'user',
    timestamp: ts,
    type: 'text',
    body,
    has_media: 0,
    media_mimetype: null,
    media_filename: null,
    media_size: null,
    media_path: null,
    quoted_msg_id: null,
    is_forwarded: 0,
    raw_json: null,
  };
}

describe('MessageStore extensions', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createMessageStore>;

  beforeEach(() => {
    db = new Database(':memory:');
    store = createMessageStore(db);
  });

  it('getRecentMessages returns last N messages within time window, newest last', () => {
    // Insert messages at t=100, 200, 300, 400, 500
    for (const t of [100, 200, 300, 400, 500]) {
      store.insert(sampleRecord(`m${t}`, t, `msg at ${t}`));
    }

    const got = store.getRecentMessages({ limit: 3, since: 200 });

    // Expected: 300, 400, 500 (ascending, so newest last for reading order)
    expect(got.map((m) => m.id)).toEqual(['m300', 'm400', 'm500']);
  });

  it('getRecentMessages respects limit when many messages in window', () => {
    for (const t of [100, 200, 300, 400, 500]) {
      store.insert(sampleRecord(`m${t}`, t, `msg`));
    }
    const got = store.getRecentMessages({ limit: 2, since: 0 });
    expect(got.map((m) => m.id)).toEqual(['m400', 'm500']);
  });

  it('getMessagesByIds returns matching records regardless of order', () => {
    store.insert(sampleRecord('a', 100, 'first'));
    store.insert(sampleRecord('b', 200, 'second'));
    store.insert(sampleRecord('c', 300, 'third'));

    const got = store.getMessagesByIds(['c', 'a']);
    const ids = got.map((m) => m.id).sort();
    expect(ids).toEqual(['a', 'c']);
  });

  it('getMessagesByIds returns empty array when no ids provided', () => {
    store.insert(sampleRecord('a', 100, 'x'));
    expect(store.getMessagesByIds([])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test — expect failure**

Run: `pnpm vitest run src-v4/db/message.test.ts`
Expected: FAIL with "store.getRecentMessages is not a function" (or similar).

- [ ] **Step 4: Implement getRecentMessages and getMessagesByIds in src-v4/db/message.ts**

In `src-v4/db/message.ts`:

(a) Extend the `MessageStore` interface to add the two new methods:

```typescript
export interface MessageStore {
  insert(record: MessageRecord): void;
  getById(id: string): MessageRecord | undefined;
  getMessagesByIds(ids: string[]): MessageRecord[];
  getRecentMessages(opts: { limit: number; since?: number }): MessageRecord[];
  search(filter: SearchFilter): MessageRecord[];
  count(): number;
}
```

(b) Inside `createMessageStore`, after the existing `stmtGetById` line, add the new prepared statements and method implementations. Insert this block just before the `return { ... }` statement:

```typescript
  // Returns messages with timestamp >= since, ordered ascending (oldest first),
  // limited to `limit` rows taken from the END of the window (most recent).
  const stmtRecent = db.prepare<[number, number], MessageRecord>(`
    SELECT * FROM (
      SELECT * FROM messages
      WHERE timestamp >= ?
      ORDER BY timestamp DESC
      LIMIT ?
    ) ORDER BY timestamp ASC
  `);

  function getMessagesByIds(ids: string[]): MessageRecord[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare<string[], MessageRecord>(
      `SELECT * FROM messages WHERE id IN (${placeholders})`
    );
    return stmt.all(...ids);
  }
```

(c) Extend the returned object to include the new methods:

```typescript
  return {
    insert(record) { stmtInsert.run(record); },
    getById(id) { return stmtGetById.get(id); },
    getMessagesByIds,
    getRecentMessages({ limit, since = 0 }) {
      const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
      return stmtRecent.all(since, safeLimit);
    },
    search(filter) {
      const { sql, params } = buildSearchQuery(filter);
      const stmt = db.prepare<unknown[], MessageRecord>(sql);
      return stmt.all(...params);
    },
    count() { return stmtCount.get()?.n ?? 0; },
  };
```

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm vitest run src-v4/db/message.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src-v4/db/message.ts src-v4/db/message.test.ts
git commit -m "feat(v4): extend db/message with getRecentMessages and getMessagesByIds"
```

## Task 4: Extend db/sessions.ts with session_summaries table

**Files:**
- Create: `src-v4/db/sessions.ts` (copy of v3 + new table + CRUD)
- Create: `src-v4/db/sessions.test.ts`

- [ ] **Step 1: Copy v3 file and update header comment**

```bash
cp src-v3/db/sessions.ts src-v4/db/sessions.ts
```

Edit the leading comment to `src-v4`.

- [ ] **Step 2: Write the failing test**

Create `src-v4/db/sessions.test.ts`:

```typescript
// src-v4/db/sessions.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createSessionStore, type SessionSummaryRecord } from './sessions.js';

describe('SessionStore summaries', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    db = new Database(':memory:');
    store = createSessionStore(db);
  });

  it('saves and fetches latest session summary by user', () => {
    const rec: SessionSummaryRecord = {
      id: 'sum-1',
      session_id: 'sess-abc',
      user_id: 'u1',
      summary: 'Narrative...',
      turns: 20,
      ended_at: '2026-04-21T20:00:00+07:00',
      ended_reason: 'turn_threshold',
      created_at: '2026-04-21T20:00:05+07:00',
    };
    store.saveSummary(rec);

    const got = store.getLatestSummaryForUser('u1');
    expect(got?.id).toBe('sum-1');
    expect(got?.summary).toBe('Narrative...');
  });

  it('returns undefined when no summary for user', () => {
    expect(store.getLatestSummaryForUser('nobody')).toBeUndefined();
  });

  it('getLatestSummaryForUser returns most recent by ended_at', () => {
    store.saveSummary({
      id: 'sum-old',
      session_id: 's1',
      user_id: 'u1',
      summary: 'old',
      turns: 10,
      ended_at: '2026-04-21T10:00:00+07:00',
      ended_reason: 'turn_threshold',
      created_at: '2026-04-21T10:00:01+07:00',
    });
    store.saveSummary({
      id: 'sum-new',
      session_id: 's2',
      user_id: 'u1',
      summary: 'new',
      turns: 15,
      ended_at: '2026-04-21T20:00:00+07:00',
      ended_reason: 'graceful_shutdown',
      created_at: '2026-04-21T20:00:01+07:00',
    });

    const got = store.getLatestSummaryForUser('u1');
    expect(got?.id).toBe('sum-new');
  });
});
```

- [ ] **Step 3: Run test — expect failure**

Run: `pnpm vitest run src-v4/db/sessions.test.ts`
Expected: FAIL (functions missing).

- [ ] **Step 4: Extend sessions.ts with the new table, types, and methods**

Add to `src-v4/db/sessions.ts`:

(a) Above `createSessionStore`, add the new type:

```typescript
export interface SessionSummaryRecord {
  id: string;
  session_id: string;
  user_id: string;
  summary: string;
  turns: number;
  ended_at: string;         // ISO 8601 with local offset
  ended_reason: 'turn_threshold' | 'graceful_shutdown' | 'manual';
  created_at: string;       // ISO 8601
}
```

(b) Extend the returned interface to include summary methods — and keep all existing methods untouched. Locate the `SessionStore` interface (if one is exported) and add:

```typescript
  saveSummary(record: SessionSummaryRecord): void;
  getLatestSummaryForUser(userId: string): SessionSummaryRecord | undefined;
```

(c) Inside `createSessionStore`, after the existing `db.exec(...)` for the sessions schema, add the summaries schema:

```typescript
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      summary       TEXT NOT NULL,
      turns         INTEGER NOT NULL,
      ended_at      TEXT NOT NULL,
      ended_reason  TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_summaries_user
      ON session_summaries(user_id, ended_at DESC);
  `);

  const stmtSaveSummary = db.prepare(`
    INSERT INTO session_summaries
      (id, session_id, user_id, summary, turns, ended_at, ended_reason, created_at)
    VALUES
      (@id, @session_id, @user_id, @summary, @turns, @ended_at, @ended_reason, @created_at)
  `);

  const stmtLatestSummary = db.prepare<[string], SessionSummaryRecord>(`
    SELECT * FROM session_summaries
    WHERE user_id = ?
    ORDER BY ended_at DESC
    LIMIT 1
  `);
```

(d) Inside the returned object from `createSessionStore`, add:

```typescript
    saveSummary(record) { stmtSaveSummary.run(record); },
    getLatestSummaryForUser(userId) { return stmtLatestSummary.get(userId); },
```

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm vitest run src-v4/db/sessions.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src-v4/db/sessions.ts src-v4/db/sessions.test.ts
git commit -m "feat(v4): add session_summaries table + CRUD to db/sessions"
```

## Task 5: Split db/user-db.ts into getCoreIdentity + getContextHintCounts

**Files:**
- Create: `src-v4/db/user-db.ts` (copy of v3 + new split functions)
- Create: `src-v4/db/user-db.test.ts`

- [ ] **Step 1: Copy v3 file and update header comment**

```bash
cp src-v3/db/user-db.ts src-v4/db/user-db.ts
```

- [ ] **Step 2: Inspect v3's AlwaysBundle shape**

Read `src-v4/db/user-db.ts` (copied from v3) and note the current `AlwaysBundle` interface and `getAlwaysBundle` function. Do NOT remove them — they may still be referenced by other v3 files during transition. We only ADD new splitter functions.

- [ ] **Step 3: Write the failing test**

Create `src-v4/db/user-db.test.ts`:

```typescript
// src-v4/db/user-db.test.ts

import { describe, it, expect } from 'vitest';
import { getCoreIdentity, getContextHintCounts } from './user-db.js';
import { createUserDb } from './user-db-cache.js';
// Note: these tests depend on the existing test harness for user-db.
// If user-db-cache requires a file path, use a tmp dir.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('getCoreIdentity', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'v4-userdb-'));
  const userId = 'test-user';

  it('returns identity, location, and language profile entries only', async () => {
    const db = createUserDb(userId, tmp);
    // Seed profile entries (adapt to v3's save_profile signature)
    // ... insert name (L3 identity), allergy (L3 rule — should NOT be in core)
    // ... insert location (L3), language (L3)
    // Then:
    const id = await getCoreIdentity(db);
    // Expect: name, current_location, language present; allergy absent.
    expect(id.name).toBeDefined();
    expect(id.current_location).toBeDefined();
    expect(id.language).toBeDefined();
    expect((id as any).allergy).toBeUndefined();
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('getContextHintCounts', () => {
  it('returns counts for ongoing, tasks, habits, relationships', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'v4-userdb-'));
    const userId = 'test-user';
    const db = createUserDb(userId, tmp);
    // Seed: 2 ongoing, 1 task, 3 habits, 4 relationships
    // ... (use v3's save_* functions or direct DB insert)
    const counts = await getContextHintCounts(db);
    expect(counts.ongoing).toBeGreaterThanOrEqual(0);
    expect(counts.tasks).toBeGreaterThanOrEqual(0);
    expect(counts.habits).toBeGreaterThanOrEqual(0);
    expect(counts.relationships).toBeGreaterThanOrEqual(0);
    rmSync(tmp, { recursive: true, force: true });
  });
});
```

Note: the exact seeding depends on v3 API — the engineer implementing this task should read `src-v3/db/memory.ts` and `src-v3/db/tasks.ts` etc. to find the correct insert helpers, then fill them in. The test structure is what matters.

- [ ] **Step 4: Run test — expect failure**

Run: `pnpm vitest run src-v4/db/user-db.test.ts`
Expected: FAIL (functions missing).

- [ ] **Step 5: Implement getCoreIdentity and getContextHintCounts**

Add to `src-v4/db/user-db.ts`:

```typescript
export interface CoreIdentity {
  name?: string;
  current_location?: string;
  language?: string;
  [key: string]: string | undefined;
}

export interface ContextHintCounts {
  ongoing: number;
  tasks: number;
  habits: number;
  relationships: number;
}

/**
 * Read the three identity-layer profile entries needed for the wake-up briefing.
 * Returns only keys that exist in the profile — missing keys are undefined.
 */
export async function getCoreIdentity(userDb: UserDb): Promise<CoreIdentity> {
  const profile = await userDb.memory.listProfile();
  const identity: CoreIdentity = {};
  const CORE_KEYS: Record<string, keyof CoreIdentity> = {
    'identity:name': 'name',
    'location:current': 'current_location',
    'preference:language': 'language',
  };
  for (const entry of profile) {
    const compositeKey = `${entry.category}:${entry.key}`;
    const target = CORE_KEYS[compositeKey];
    if (target) identity[target] = entry.value;
  }
  return identity;
}

/**
 * Count active/ongoing records across the four domain tables for context_hints.
 */
export async function getContextHintCounts(userDb: UserDb): Promise<ContextHintCounts> {
  const [ongoing, tasks, habits, relationships] = await Promise.all([
    userDb.memory.countOngoing(),
    userDb.tasks.countActive(),
    userDb.habits.countActive(),
    userDb.memory.countRelationships(),
  ]);
  return { ongoing, tasks, habits, relationships };
}
```

Note: if v3 memory/tasks/habits stores don't already expose the counting methods above (`countOngoing`, `countActive`, `countRelationships`), the engineer should add thin wrappers in the respective v4 db files. Keep those changes minimal — single-purpose count queries.

- [ ] **Step 6: Run test — expect pass**

Run: `pnpm vitest run src-v4/db/user-db.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-v4/db/user-db.ts src-v4/db/user-db.test.ts
git commit -m "feat(v4): add getCoreIdentity and getContextHintCounts to db/user-db"
```

---

# Phase 3 — AI engine

## Task 6: Copy ai-engine and wire per-user cwd + Skill tool

**Files:**
- Create: `src-v4/ai-engine/types.ts` (verbatim)
- Create: `src-v4/ai-engine/query.ts` (edit: drop DEFAULT_SYSTEM_PROMPT fallback)
- Create: `src-v4/ai-engine/index.ts` (verbatim)
- Create: `src-v4/ai-engine/options.ts` (edit: enable Skill + per-user cwd)

- [ ] **Step 1: Copy four files**

```bash
for f in types query index options; do
  cp "src-v3/ai-engine/$f.ts" "src-v4/ai-engine/$f.ts"
done
```

Update the leading `// src-v3/ai-engine/<name>.ts` comment to `src-v4` in each.

- [ ] **Step 2: Edit `src-v4/ai-engine/options.ts` to enable Skill and accept cwd**

Change the `disallowedTools` array to remove `'Skill'` from it (Skill must be ALLOWED now). Find this line in the block:

```typescript
  // Skill / slash (Claude Code UI surface)
  'Skill', 'SlashCommand',
```

Remove only `'Skill',` — keep `'SlashCommand'`. Update the comment to reflect the change:

```typescript
  // Slash (Claude Code UI surface — we don't want AI invoking slash commands)
  'SlashCommand',
```

Then extend `ResolvedConfig` to include `cwd`:

```typescript
export interface ResolvedConfig {
  model: string;
  systemPrompt: string;
  maxTurns: number;
  effort: EffortLevel;
  sessionId?: string;
  mcpServers: Record<string, any>;
  cwd: string;
}
```

In `createQueryOptions`, change `settingSources` to `['user', 'project']` and add `cwd`:

```typescript
export function createQueryOptions(config: ResolvedConfig): Options {
  const options: Options = {
    model: config.model,
    maxTurns: config.maxTurns,
    effort: config.effort,
    permissionMode: 'bypassPermissions' as const,
    allowDangerouslySkipPermissions: true,
    disallowedTools: allBuiltInTools,
    settingSources: ['user', 'project'],
    cwd: config.cwd,
    systemPrompt: config.systemPrompt,
    mcpServers: config.mcpServers,
  };

  if (config.sessionId) {
    options.resume = config.sessionId;
  }

  return options;
}
```

- [ ] **Step 3: Edit `src-v4/ai-engine/query.ts` — remove DEFAULT_SYSTEM_PROMPT import and fallback**

In `query.ts`, find:

```typescript
import { DEFAULT_SYSTEM_PROMPT } from "../utils/system-prompt.js";
```

Delete that line.

Find the defaults block and change `systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,` to require systemPrompt:

```typescript
  if (!config?.systemPrompt) {
    throw new Error('createAIEngine: systemPrompt is required (no hardcoded default in v4)');
  }
  const defaults = {
    model: requireModel(config?.model),
    systemPrompt: config.systemPrompt,
    maxTurns: config?.maxTurns ?? 10,
    effort: config?.effort ?? 'low',
    mcpServers: config?.mcpServers ?? {},
  };
```

Also extend `EngineConfig` and `QueryOptions` to propagate `cwd` (required on engine, overridable per-query):

In `src-v4/ai-engine/types.ts`, add a required `cwd: string` to `EngineConfig` and an optional `cwd?: string` to `QueryOptions`. Then in `query.ts` propagate:

```typescript
  const defaults = {
    model: requireModel(config?.model),
    systemPrompt: config.systemPrompt,
    maxTurns: config?.maxTurns ?? 10,
    effort: config?.effort ?? 'low',
    mcpServers: config?.mcpServers ?? {},
    cwd: config.cwd,
  };
```

And inside `query(prompt, options?)`:

```typescript
      const resolved = {
        model: options?.model ?? defaults.model,
        systemPrompt: options?.systemPrompt ?? defaults.systemPrompt,
        maxTurns: options?.maxTurns ?? defaults.maxTurns,
        effort: options?.effort ?? defaults.effort,
        sessionId: options?.sessionId,
        mcpServers: { ...defaults.mcpServers, ...options?.mcpServers },
        cwd: options?.cwd ?? defaults.cwd,
      };
```

- [ ] **Step 4: Verify compile**

Run: `pnpm type-check`
Expected: PASS. (If any v3 file imports from v4 ai-engine, there would be errors; there should be none.)

- [ ] **Step 5: Commit**

```bash
git add src-v4/ai-engine
git commit -m "feat(v4): ai-engine with per-user cwd, Skill enabled, systemPrompt required"
```

---

# Phase 4 — Core (NEW) — CRITICAL GATE

Each file in this phase is reviewed per-file before merging. This is where v4's character lives.

## Task 7: core/types.ts

**Files:**
- Create: `src-v4/core/types.ts`

- [ ] **Step 1: Write types file**

Create `src-v4/core/types.ts`:

```typescript
// src-v4/core/types.ts

import type { CoreIdentity, ContextHintCounts } from '../db/user-db.js';
import type { SessionSummaryRecord } from '../db/sessions.js';
import type { MessageRecord } from '../db/message.js';

/**
 * Data needed to render the wake-up briefing XML block.
 * Assembled by core/wake-up.ts, rendered into a string, and injected into
 * the {{WAKE_UP_BRIEFING}} slot of the core system prompt.
 */
export interface WakeUpBriefingData {
  now: Date;
  timezone: string;           // e.g. "WIB"
  identity: CoreIdentity;
  hints: ContextHintCounts;
  lastSummary?: SessionSummaryRecord;
  fallbackRecentMessages?: MessageRecord[];  // used only if summarization unavailable
}

export type SessionEndReason = 'turn_threshold' | 'graceful_shutdown' | 'manual';

export interface SummarizeResult {
  sessionId: string;
  userId: string;
  summary: string;     // narrative + key points with <msg_ref/> markers
  turns: number;
  endedAt: Date;
  endedReason: SessionEndReason;
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-v4/core/types.ts
git commit -m "feat(v4): add core/types for wake-up briefing and session summary"
```

## Task 8: core/system-prompt.ts — template + assembler

**Files:**
- Create: `src-v4/core/system-prompt.ts`
- Create: `src-v4/core/system-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src-v4/core/system-prompt.test.ts`:

```typescript
// src-v4/core/system-prompt.test.ts

import { describe, it, expect } from 'vitest';
import { CORE_SYSTEM_PROMPT, assembleSystemPrompt } from './system-prompt.js';

describe('assembleSystemPrompt', () => {
  it('replaces the {{WAKE_UP_BRIEFING}} slot with the provided briefing string', () => {
    const briefing = '<wake_up_briefing>...</wake_up_briefing>';
    const out = assembleSystemPrompt(briefing);
    expect(out).toContain(briefing);
    expect(out).not.toContain('{{WAKE_UP_BRIEFING}}');
  });

  it('preserves the rest of the template verbatim', () => {
    const out = assembleSystemPrompt('');
    expect(out).toContain('<your_role>');
    expect(out).toContain('<initiative>');
    expect(out).toContain('<skill_discipline>');
  });

  it('CORE_SYSTEM_PROMPT contains the six role capacities', () => {
    expect(CORE_SYSTEM_PROMPT).toContain('Time-keeper');
    expect(CORE_SYSTEM_PROMPT).toContain('Conversational companion');
    expect(CORE_SYSTEM_PROMPT).toContain('Adviser');
    expect(CORE_SYSTEM_PROMPT).toContain('Planner');
    expect(CORE_SYSTEM_PROMPT).toContain('Chronicler');
    expect(CORE_SYSTEM_PROMPT).toContain('Check-in & recap partner');
  });

  it('CORE_SYSTEM_PROMPT does not reference dropped v3 domain specifics', () => {
    const forbidden = ['prayer', 'Busan', 'KST', 'sholat', 'save_profile category='];
    for (const term of forbidden) {
      expect(CORE_SYSTEM_PROMPT).not.toContain(term);
    }
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `pnpm vitest run src-v4/core/system-prompt.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the system prompt module**

Create `src-v4/core/system-prompt.ts`. Copy the full prompt text from spec Section 4 (`docs/superpowers/specs/2026-04-21-src-v4-design.md`). Wrap it as a string export.

```typescript
// src-v4/core/system-prompt.ts

/**
 * The agnostic core system prompt for v4. Contains a {{WAKE_UP_BRIEFING}} slot
 * that is filled by assembleSystemPrompt(briefing) at runtime.
 *
 * No domain-specific behavior: no prayer loops, no timezone branches, no
 * hardcoded save_profile category instructions. Domain behavior emerges as
 * per-user skills (see skill_discipline below).
 */
export const CORE_SYSTEM_PROMPT = `You are a personal AI assistant — a friendly manager for your user. Your job is
to help them run their life smoothly: remember what matters, show up at the
right moments, and care about them as a person.

<persona>
Warm, optimistic, genuinely curious, supportive. Match the user's energy and
language — if they write Indonesian, reply Indonesian; if they're playful, be
playful; if they're tired, be gentle. Friend first, competent assistant second.
</persona>

<your_role>
You act in these six capacities:

1. Time-keeper — remind and schedule. Surface the right thing at the right
   moment, and help manage the user's calendar, deadlines, and commitments.
2. Conversational companion — be present as a friend; listen, ask, respond
   naturally.
3. Adviser — give recommendations when asked, grounded in what you know about
   the user.
4. Planner — help break down goals, decide sequencing, clarify next steps.
5. Chronicler — capture what matters: the needs and to-dos that are still
   ahead, and the wins and milestones already behind. Reflect them back when
   relevant.
6. Check-in & recap partner — greet, ask how the user is, detect shifts in
   mood or energy; and periodically review how things have been going,
   surfacing patterns worth a course correction.
</your_role>

<initiative>
Initiative is not a seventh capacity — it is the meta-quality that decides
whether the six capacities above are worth anything. A reminder you do not
proactively surface is not a reminder. A plan you do not push forward is not
a plan. A check-in the user has to start themselves is not a check-in.

After every user message, and after every tool observation, ask yourself:
- What just changed — and what else should update because of it?
- Is something the user mentioned earlier connected to what's happening now?
- Is there a situation I've been tracking that needs a follow-up today?
- Did I just detect a shift in mood, energy, or pattern worth naming?

If any answer is yes, act. Do not wait to be prompted.

Patterns of initiative (agnostic, not tied to any domain):
- User shares a new fact → update the relevant memory entry AND consider
  which cronjobs, tasks, or relationships are downstream of it.
- User expresses frustration about a recurring issue → do not merely
  sympathize; propose a concrete next step or a tracking mechanism.
- A topic raised days ago has not been revisited → raise it yourself at a
  natural moment.
- User mentions something offhand that implies a deadline → save a task or
  schedule a reminder without being asked.
- User completes something they'd been stuck on → mark the milestone,
  celebrate briefly, then check what unblocks next.

Failure modes to avoid:
- Acknowledging without acting ("noted" — but nothing saved, no follow-up).
- Waiting for the user to re-ask ("let me know if you want me to remind you").
- Surfacing generic empathy when a specific action would be more useful.
- Treating each message as isolated, ignoring the thread of the user's life.

You are not a passive notepad. You are not a reactive chatbot. You are a
manager who thinks one step ahead, connects dots, and acts before being asked.
This is the single behavior that separates a useful assistant from a mere tool.
</initiative>

<input_format>
Messages arrive wrapped in XML tags:
- <user_message timestamp="..."><body>...</body></user_message> — real-time
  message from user. May include has_media="true" when image/document attached.
- <system_message timestamp="..."><body>...</body></system_message> — automated
  trigger from scheduler or internal system. Act on it as if on your own
  initiative. Never reveal the underlying machinery.

If a <system_message> is no longer relevant by the time you see it (user
already addressed the topic), adapt or skip.
</input_format>

<response_rule>
ALWAYS respond using the \`send_message\` tool. Never reply with plain text.
EXCEPTION: skip send_message only when a system_message is no longer relevant
given recent context.
</response_rule>

<messaging_style>
You are texting on a chat app — NOT writing email. Default to short, natural
bursts. \`send_message\` accepts an array; 2–3 messages back-to-back is normal.

Single message: short answers, confirmations, one-sentence replies.
Split into multiple: greeting + follow-up, ack + new topic, lists with 2+
items, emotional reactions, any moment a real person would naturally pause.

\`pauseBeforeTyping\` defaults to 1000ms; use 1500–2500ms for dramatic pauses.
</messaging_style>

<memory>
You have memory tools to save and retrieve what you know about the user. Use
them inline, quietly — don't announce ("aku simpan ya") unless the user
explicitly asked to remember.

- SAVE when you learn a new fact, observation, preference, event, ongoing
  situation, relationship, task, or habit.
- BEFORE saving, search/list first — update existing rather than duplicate.
- BEFORE claiming "I don't know", search memory AND search past messages.
- BATCH: if the user shares multiple facts in one turn, save all of them before
  send_message.

Memory stores FACTS. It is separate from skills (below), which store HOW you
behave.
</memory>

<skill_discipline>
A skill is a persistent procedure — a named markdown file that tells you HOW
to behave in a specific emergent situation not covered by your general role
above. Skills are user-specific and invisible to the user in conversation.

What IS a skill:
- A user-specific ritual (e.g. how this user closes their day).
- A unique format they want applied in certain situations.
- A specific nuance in how they want a recurring request handled.

What is NOT a skill:
- A fact about the user → memory
- A one-time action item → task
- A recurring tracked behavior → habit
- A time-triggered reminder → cronjob

When creating or updating skills, follow this discipline strictly:

1. LIST FIRST. Before writing, review the available skills list that is
   auto-injected in your context. Never write blind.
2. UPDATE, DON'T DUPLICATE. If a similar skill exists, call \`write_skill\` with
   the same name to supersede. Never create overlapping skills.
3. WRITE SILENTLY. The user does not need to know about skill terminology.
   Never say "let me write a skill." Just write and act.
4. EMERGENT, NOT SPECULATIVE. Only write a skill when a real pattern or
   explicit request has emerged. Don't invent skills for hypothetical cases.
5. STANDARD FORMAT. Every skill is a markdown file with YAML frontmatter
   \`name:\` and \`description:\`. The description drives when the skill triggers.
6. ENGLISH BODY. Always write the skill's \`description\` and body in English,
   even when the user conversation is in another language. Translate at reply
   time as needed. This keeps skill instructions consistent and portable.
</skill_discipline>

{{WAKE_UP_BRIEFING}}

Keep responses concise. Be warm. Act like a manager who genuinely cares —
and who always thinks one step ahead.`;

/**
 * Inject the rendered wake-up briefing block into the core prompt's slot.
 */
export function assembleSystemPrompt(briefing: string): string {
  return CORE_SYSTEM_PROMPT.replace('{{WAKE_UP_BRIEFING}}', briefing);
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm vitest run src-v4/core/system-prompt.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src-v4/core/system-prompt.ts src-v4/core/system-prompt.test.ts
git commit -m "feat(v4): agnostic core system prompt with {{WAKE_UP_BRIEFING}} slot"
```

## Task 9: core/wake-up.ts — buildWakeUpBriefing

**Files:**
- Create: `src-v4/core/wake-up.ts`
- Create: `src-v4/core/wake-up.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src-v4/core/wake-up.test.ts`:

```typescript
// src-v4/core/wake-up.test.ts

import { describe, it, expect } from 'vitest';
import { renderWakeUpBriefing } from './wake-up.js';
import type { WakeUpBriefingData } from './types.js';

describe('renderWakeUpBriefing', () => {
  const baseData: WakeUpBriefingData = {
    now: new Date('2026-04-21T21:30:00+07:00'),
    timezone: 'WIB',
    identity: { name: 'Mirza', current_location: 'Jakarta', language: 'id' },
    hints: { ongoing: 3, tasks: 2, habits: 5, relationships: 8 },
    lastSummary: {
      id: 'sum-1',
      session_id: 'abc123',
      user_id: 'u1',
      summary: 'Mirza sedang refactor v3 ke v4.\nKey points:\n- Decision X <msg_ref id="abc"/>',
      turns: 30,
      ended_at: '2026-04-21T20:00:00+07:00',
      ended_reason: 'turn_threshold',
      created_at: '2026-04-21T20:00:05+07:00',
    },
  };

  it('produces a valid XML block wrapped in <wake_up_briefing>', () => {
    const out = renderWakeUpBriefing(baseData);
    expect(out).toMatch(/^<wake_up_briefing>/);
    expect(out).toMatch(/<\/wake_up_briefing>$/);
  });

  it('includes current_moment with now and timezone attrs', () => {
    const out = renderWakeUpBriefing(baseData);
    expect(out).toContain('<current_moment');
    expect(out).toContain('now="2026-04-21T21:30:00');
    expect(out).toContain('timezone="WIB"');
  });

  it('includes core_identity with name, location, language', () => {
    const out = renderWakeUpBriefing(baseData);
    expect(out).toContain('name: "Mirza"');
    expect(out).toContain('current_location: "Jakarta"');
    expect(out).toContain('language: "id"');
  });

  it('includes context_hints with counts', () => {
    const out = renderWakeUpBriefing(baseData);
    expect(out).toContain('Ongoing situations: 3');
    expect(out).toContain('Active tasks: 2');
    expect(out).toContain('Active habits: 5');
    expect(out).toContain('Relationships tracked: 8');
  });

  it('includes last_session_summary block with summary text', () => {
    const out = renderWakeUpBriefing(baseData);
    expect(out).toContain('<last_session_summary');
    expect(out).toContain('from_session="abc123"');
    expect(out).toContain('turns="30"');
    expect(out).toContain('Mirza sedang refactor');
  });

  it('omits last_session_summary block when no summary provided', () => {
    const out = renderWakeUpBriefing({ ...baseData, lastSummary: undefined });
    expect(out).not.toContain('<last_session_summary');
  });

  it('falls back to recent messages when summary missing but fallback provided', () => {
    const data: WakeUpBriefingData = {
      ...baseData,
      lastSummary: undefined,
      fallbackRecentMessages: [
        {
          id: 'm1', gateway: 'console', session_id: 'x', sender: 'user',
          timestamp: 1700000000, type: 'text', body: 'Halo', has_media: 0,
          media_mimetype: null, media_filename: null, media_size: null,
          media_path: null, quoted_msg_id: null, is_forwarded: 0, raw_json: null,
        },
      ],
    };
    const out = renderWakeUpBriefing(data);
    expect(out).toContain('<recent_messages');
    expect(out).toContain('Halo');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `pnpm vitest run src-v4/core/wake-up.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement wake-up.ts**

Create `src-v4/core/wake-up.ts`:

```typescript
// src-v4/core/wake-up.ts

import type { UserDb } from '../db/user-db.js';
import { getCoreIdentity, getContextHintCounts } from '../db/user-db.js';
import type { WakeUpBriefingData } from './types.js';
import type { MessageRecord } from '../db/message.js';

/**
 * Gather all the data needed to render a wake-up briefing for a user.
 *
 * - identity + hints come from the per-user DB
 * - lastSummary comes from session_summaries
 * - fallbackRecentMessages is loaded only if no summary is available
 */
export async function buildWakeUpBriefing(opts: {
  userId: string;
  now: Date;
  timezone: string;
  userDb: UserDb;
  fallbackRecentMessagesCount?: number;
}): Promise<WakeUpBriefingData> {
  const { userId, now, timezone, userDb, fallbackRecentMessagesCount = 10 } = opts;

  const [identity, hints, lastSummary] = await Promise.all([
    getCoreIdentity(userDb),
    getContextHintCounts(userDb),
    userDb.sessions.getLatestSummaryForUser(userId),
  ]);

  let fallbackRecentMessages: MessageRecord[] | undefined;
  if (!lastSummary) {
    fallbackRecentMessages = userDb.messages.getRecentMessages({
      limit: fallbackRecentMessagesCount,
      since: 0,
    });
  }

  return { now, timezone, identity, hints, lastSummary, fallbackRecentMessages };
}

/**
 * Render a WakeUpBriefingData object to the XML string that gets injected
 * into the core system prompt.
 */
export function renderWakeUpBriefing(data: WakeUpBriefingData): string {
  const lines: string[] = ['<wake_up_briefing>'];

  // current_moment
  const nowIso = data.now.toISOString().replace('Z', '+00:00');
  // Callers may pre-format `now` with local offset; renderWakeUpBriefing trusts whatever Date serializes.
  // A richer timezone formatter can be added later if needed.
  lines.push('');
  lines.push(
    `<current_moment now="${nowIso}" timezone="${data.timezone}"/>`
  );

  // core_identity
  lines.push('');
  lines.push('<core_identity>');
  if (data.identity.name !== undefined) lines.push(`  - name: "${data.identity.name}"`);
  if (data.identity.current_location !== undefined)
    lines.push(`  - current_location: "${data.identity.current_location}"`);
  if (data.identity.language !== undefined)
    lines.push(`  - language: "${data.identity.language}"`);
  lines.push('</core_identity>');

  // context_hints
  lines.push('');
  lines.push('<context_hints>');
  lines.push(`  Ongoing situations: ${data.hints.ongoing}`);
  lines.push(`  Active tasks: ${data.hints.tasks}`);
  lines.push(`  Active habits: ${data.hints.habits}`);
  lines.push(`  Relationships tracked: ${data.hints.relationships}`);
  lines.push(
    '  Use search_memory / list_tasks / list_habits / list_relationships when relevant.'
  );
  lines.push('</context_hints>');

  // last_session_summary OR fallback recent_messages
  if (data.lastSummary) {
    const s = data.lastSummary;
    lines.push('');
    lines.push(
      `<last_session_summary from_session="${s.session_id}" ended_at="${s.ended_at}" ended_reason="${s.ended_reason}" turns="${s.turns}">`
    );
    lines.push('');
    lines.push(s.summary);
    lines.push('');
    lines.push('</last_session_summary>');
  } else if (data.fallbackRecentMessages && data.fallbackRecentMessages.length > 0) {
    lines.push('');
    lines.push(
      `<recent_messages count="${data.fallbackRecentMessages.length}" note="fallback: summarization unavailable">`
    );
    for (const m of data.fallbackRecentMessages) {
      const ts = new Date(m.timestamp * 1000).toISOString();
      lines.push(`<msg from="${m.sender}" ts="${ts}"><body>${m.body ?? ''}</body></msg>`);
    }
    lines.push('</recent_messages>');
  }

  lines.push('');
  lines.push('</wake_up_briefing>');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm vitest run src-v4/core/wake-up.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src-v4/core/wake-up.ts src-v4/core/wake-up.test.ts
git commit -m "feat(v4): wake-up briefing builder and renderer"
```

## Task 10: core/summarize.ts — session summarization

**Files:**
- Create: `src-v4/core/summarize.ts`
- Create: `scripts/test-v4-summarize.ts` (integration smoke, real API)

- [ ] **Step 1: Write summarize.ts**

Create `src-v4/core/summarize.ts`:

```typescript
// src-v4/core/summarize.ts

import { createAIEngine } from '../ai-engine/index.js';
import type { MessageStore, MessageRecord } from '../db/message.js';
import type { SessionStore } from '../db/sessions.js';
import type { SummarizeResult, SessionEndReason } from './types.js';
import { randomUUID } from 'node:crypto';
import { log } from '../utils/logger.js';

const SUMMARIZER_SYSTEM_PROMPT = `You are summarizing a conversation between a personal AI assistant and its user,
for the assistant's future self to remember context after a restart or session reset.

Output structure:
1. One paragraph narrative: what the user was working on, where the conversation
   was heading, their current emotional/mental state.
2. 3-7 bulleted key points. Each key point ends with <msg_ref id="MSG_ID"/>
   pointing to the message where the point was established.
3. A closing short note on the user's mood or energy.

Be concise but information-dense. Preserve nuance, not verbatim text. Your
future self can fetch any referenced message if more detail is needed.

Output in English regardless of the conversation language.`;

function formatMessagesForSummarizer(msgs: MessageRecord[]): string {
  const parts = msgs.map((m) => {
    const body = m.body ?? '';
    return `<msg id="${m.id}" from="${m.sender}">${body}</msg>`;
  });
  return `<conversation>\n${parts.join('\n')}\n</conversation>`;
}

export async function summarizeSession(opts: {
  sessionId: string;
  userId: string;
  reason: SessionEndReason;
  messages: MessageStore;
  sessions: SessionStore;
  model: string;                // e.g. 'claude-haiku-4-5'
  cwd: string;                  // required by v4 engine config
  timeoutMs?: number;
}): Promise<SummarizeResult | null> {
  const { sessionId, userId, reason, messages, sessions, model, cwd, timeoutMs = 30_000 } = opts;

  // Fetch messages belonging to this session
  const sessionMessages = messages
    .search({ limit: 100, order: 'oldest' })
    .filter((m) => m.session_id === sessionId);

  if (sessionMessages.length === 0) {
    log.warn(`summarizeSession: no messages for session ${sessionId}, skipping`);
    return null;
  }

  const engine = createAIEngine({
    model,
    systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
    cwd,
    mcpServers: {},      // summarizer needs no tools
    maxTurns: 1,
  });

  const prompt = formatMessagesForSummarizer(sessionMessages);

  let result: SummarizeResult | null = null;
  try {
    const queryPromise = engine.query(prompt);
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    );
    const raced = await Promise.race([queryPromise, timeoutPromise]);

    if (raced === null) {
      log.warn(`summarizeSession: timeout for session ${sessionId}`);
      return null;
    }

    const endedAt = new Date();
    result = {
      sessionId,
      userId,
      summary: raced.responseText,
      turns: sessionMessages.length,
      endedAt,
      endedReason: reason,
    };

    sessions.saveSummary({
      id: randomUUID(),
      session_id: sessionId,
      user_id: userId,
      summary: result.summary,
      turns: result.turns,
      ended_at: endedAt.toISOString(),
      ended_reason: reason,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    log.error(`summarizeSession failed for session ${sessionId}`, err);
    return null;
  }

  return result;
}
```

Note: this calls `createAIEngine` whose return shape includes `responseText`. Adjust the property access if your v3 `QueryResult` shape differs — the engineer should verify by reading `src-v4/ai-engine/types.ts`.

- [ ] **Step 2: Write an integration smoke script**

Create `scripts/test-v4-summarize.ts`:

```typescript
// scripts/test-v4-summarize.ts
//
// Integration test: seed a synthetic conversation, run summarizer, print output.
// Requires ANTHROPIC_API_KEY set.

import 'dotenv/config';
import Database from 'better-sqlite3';
import { createMessageStore } from '../src-v4/db/message.js';
import { createSessionStore } from '../src-v4/db/sessions.js';
import { summarizeSession } from '../src-v4/core/summarize.js';

async function main() {
  const db = new Database(':memory:');
  const messages = createMessageStore(db);
  const sessions = createSessionStore(db);

  const sessionId = 'test-session';
  const sample = [
    { role: 'user', body: "Hai, aku lagi mikirin mau refactor v3 ke v4" },
    { role: 'assistant', body: "Oke, mulai dari mana dulu?" },
    { role: 'user', body: "Filosofinya: agnostic core + skill driven" },
    { role: 'assistant', body: "Strong. Mau aku bantu rancang struktur foldernya?" },
    { role: 'user', body: "Iya" },
  ];
  let t = 1700000000;
  for (const m of sample) {
    messages.insert({
      id: `msg-${t}`, gateway: 'console', session_id: sessionId,
      sender: m.role as any, timestamp: t++,
      type: 'text', body: m.body,
      has_media: 0, media_mimetype: null, media_filename: null, media_size: null,
      media_path: null, quoted_msg_id: null, is_forwarded: 0, raw_json: null,
    });
  }

  const result = await summarizeSession({
    sessionId, userId: 'u-test', reason: 'manual',
    messages, sessions,
    model: process.env.SUMMARIZE_MODEL ?? 'claude-haiku-4-5',
    cwd: process.cwd(),
  });

  console.log('\n=== Summary ===\n');
  console.log(result?.summary ?? '(null)');
  console.log('\n=== Stored ===\n');
  console.log(sessions.getLatestSummaryForUser('u-test'));
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run the smoke script**

Run: `pnpm tsx scripts/test-v4-summarize.ts`
Expected: PASS — prints a coherent English summary with 3-7 bullets referencing the msg-ids, plus the stored `session_summaries` row.

- [ ] **Step 4: Commit**

```bash
git add src-v4/core/summarize.ts scripts/test-v4-summarize.ts
git commit -m "feat(v4): session summarizer with msg_ref key points and fallback timeout"
```

---

# Phase 5 — Skills infrastructure

## Task 11: skills/types.ts

**Files:**
- Create: `src-v4/skills/types.ts`

- [ ] **Step 1: Write the types**

Create `src-v4/skills/types.ts`:

```typescript
// src-v4/skills/types.ts

export interface SkillFrontmatter {
  name: string;
  description: string;
  created_at: string;     // ISO 8601
  updated_at: string;     // ISO 8601
}

export interface SkillFile {
  frontmatter: SkillFrontmatter;
  body: string;
}

export type WriteResult =
  | { status: 'created'; path: string }
  | { status: 'updated'; path: string };

export type ArchiveResult =
  | { status: 'archived'; from: string; to: string }
  | { status: 'not_found'; name: string };
```

- [ ] **Step 2: Verify compile**

Run: `pnpm type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-v4/skills/types.ts
git commit -m "feat(v4): skill types"
```

## Task 12: skills/storage.ts — writeSkill / archiveSkill / ensureUserSkillDir

**Files:**
- Create: `src-v4/skills/storage.ts`
- Create: `src-v4/skills/storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src-v4/skills/storage.test.ts`:

```typescript
// src-v4/skills/storage.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSkill, archiveSkill, ensureUserSkillDir, SKILL_NAME_RE } from './storage.js';

describe('SKILL_NAME_RE', () => {
  it('accepts kebab-case names 3-60 chars', () => {
    expect(SKILL_NAME_RE.test('evening-wind-down')).toBe(true);
    expect(SKILL_NAME_RE.test('abc')).toBe(true);
  });
  it('rejects path traversal and bad chars', () => {
    expect(SKILL_NAME_RE.test('../escape')).toBe(false);
    expect(SKILL_NAME_RE.test('with space')).toBe(false);
    expect(SKILL_NAME_RE.test('UPPER')).toBe(false);
    expect(SKILL_NAME_RE.test('ab')).toBe(false);        // too short
  });
});

describe('writeSkill / archiveSkill', () => {
  let dataDir: string;
  const userId = 'u1';

  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'v4-skill-')); });
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('creates a new skill file with frontmatter', async () => {
    const res = await writeSkill({
      dataDir, userId,
      name: 'evening-wind-down',
      description: 'Use when user reports feeling tired',
      body: '# Evening wind-down\n\nSteps here...',
    });
    expect(res.status).toBe('created');

    const p = join(dataDir, 'users', userId, '.claude', 'skills', 'evening-wind-down', 'SKILL.md');
    expect(existsSync(p)).toBe(true);

    const content = readFileSync(p, 'utf8');
    expect(content).toContain('name: evening-wind-down');
    expect(content).toContain('description: Use when user reports feeling tired');
    expect(content).toContain('# Evening wind-down');
    expect(content).toMatch(/created_at: /);
    expect(content).toMatch(/updated_at: /);
  });

  it('updates existing skill while preserving created_at', async () => {
    await writeSkill({
      dataDir, userId,
      name: 'sx',
      description: 'First version',
      body: 'First body',
    });
    // Delay 5ms to make timestamps different
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await writeSkill({
      dataDir, userId,
      name: 'sx',
      description: 'Updated version',
      body: 'Updated body',
    });
    expect(r2.status).toBe('updated');

    const p = join(dataDir, 'users', userId, '.claude', 'skills', 'sx', 'SKILL.md');
    const content = readFileSync(p, 'utf8');
    expect(content).toContain('description: Updated version');
    expect(content).toContain('Updated body');
    // created_at + updated_at should both be present and differ
    const created = /created_at: (.+)/.exec(content)?.[1];
    const updated = /updated_at: (.+)/.exec(content)?.[1];
    expect(created).toBeDefined();
    expect(updated).toBeDefined();
    expect(created).not.toBe(updated);
  });

  it('rejects invalid skill names', async () => {
    await expect(
      writeSkill({
        dataDir, userId,
        name: '../escape',
        description: 'x', body: 'y',
      })
    ).rejects.toThrow(/invalid skill name/i);
  });

  it('archives a skill by moving its directory', async () => {
    await writeSkill({
      dataDir, userId,
      name: 'my-skill',
      description: 'x', body: 'y',
    });
    const res = await archiveSkill({ dataDir, userId, name: 'my-skill' });
    expect(res.status).toBe('archived');

    const activePath = join(dataDir, 'users', userId, '.claude', 'skills', 'my-skill');
    const archivedPath = join(dataDir, 'users', userId, '.archived-skills', 'my-skill');
    expect(existsSync(activePath)).toBe(false);
    expect(existsSync(archivedPath)).toBe(true);
  });

  it('archiveSkill returns not_found when skill does not exist', async () => {
    const res = await archiveSkill({ dataDir, userId, name: 'ghost' });
    expect(res.status).toBe('not_found');
  });

  it('ensureUserSkillDir creates .claude/skills/ if missing', async () => {
    await ensureUserSkillDir({ dataDir, userId });
    const p = join(dataDir, 'users', userId, '.claude', 'skills');
    expect(existsSync(p)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `pnpm vitest run src-v4/skills/storage.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement storage.ts**

Create `src-v4/skills/storage.ts`:

```typescript
// src-v4/skills/storage.ts

import { promises as fs, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { WriteResult, ArchiveResult, SkillFrontmatter } from './types.js';

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_NAME = 3;
const MAX_NAME = 60;

function validateName(name: string): void {
  if (name.length < MIN_NAME || name.length > MAX_NAME || !SKILL_NAME_RE.test(name)) {
    throw new Error(`invalid skill name: ${JSON.stringify(name)}`);
  }
}

function skillDir(dataDir: string, userId: string, name: string): string {
  return join(dataDir, 'users', userId, '.claude', 'skills', name);
}
function archivedDir(dataDir: string, userId: string, name: string): string {
  return join(dataDir, 'users', userId, '.archived-skills', name);
}

function renderFrontmatter(fm: SkillFrontmatter, body: string): string {
  return (
    `---\n` +
    `name: ${fm.name}\n` +
    `description: ${fm.description}\n` +
    `created_at: ${fm.created_at}\n` +
    `updated_at: ${fm.updated_at}\n` +
    `---\n\n` +
    body +
    (body.endsWith('\n') ? '' : '\n')
  );
}

async function readExistingCreatedAt(skillPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(skillPath, 'utf8');
    const m = /^created_at:\s*(.+)$/m.exec(content);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

export async function ensureUserSkillDir(opts: {
  dataDir: string;
  userId: string;
}): Promise<void> {
  const dir = join(opts.dataDir, 'users', opts.userId, '.claude', 'skills');
  await fs.mkdir(dir, { recursive: true });
}

export async function writeSkill(opts: {
  dataDir: string;
  userId: string;
  name: string;
  description: string;
  body: string;
}): Promise<WriteResult> {
  validateName(opts.name);

  const dir = skillDir(opts.dataDir, opts.userId, opts.name);
  const filePath = join(dir, 'SKILL.md');
  const tmpPath = join(dir, 'SKILL.md.tmp');

  await fs.mkdir(dir, { recursive: true });

  const existingCreatedAt = await readExistingCreatedAt(filePath);
  const now = new Date().toISOString();

  const fm: SkillFrontmatter = {
    name: opts.name,
    description: opts.description,
    created_at: existingCreatedAt ?? now,
    updated_at: now,
  };

  const rendered = renderFrontmatter(fm, opts.body);
  await fs.writeFile(tmpPath, rendered, 'utf8');
  await fs.rename(tmpPath, filePath);

  return {
    status: existingCreatedAt ? 'updated' : 'created',
    path: filePath,
  };
}

export async function archiveSkill(opts: {
  dataDir: string;
  userId: string;
  name: string;
}): Promise<ArchiveResult> {
  validateName(opts.name);
  const from = skillDir(opts.dataDir, opts.userId, opts.name);
  if (!existsSync(from)) return { status: 'not_found', name: opts.name };

  const to = archivedDir(opts.dataDir, opts.userId, opts.name);
  await fs.mkdir(dirname(to), { recursive: true });
  // If a same-named archive already exists, suffix with timestamp
  let finalTo = to;
  if (existsSync(to)) {
    finalTo = `${to}-${Date.now()}`;
  }
  await fs.rename(from, finalTo);
  return { status: 'archived', from, to: finalTo };
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm vitest run src-v4/skills/storage.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src-v4/skills
git commit -m "feat(v4): skills/storage with writeSkill, archiveSkill, ensureUserSkillDir"
```

---

# Phase 6 — Tools (MCP)

## Task 13: Copy MCP tools with behavioral prose stripped

**Files:**
- Create: `src-v4/tools/message.ts`, `cronjob.ts`, `memory.ts`, `tasks.ts`, `habits.ts`

- [ ] **Step 1: Copy the 5 tool files**

```bash
for f in message cronjob memory tasks habits; do
  cp "src-v3/tools/$f.ts" "src-v4/tools/$f.ts"
done
```

Update `// src-v3/tools/<name>.ts` header comments to `src-v4` in each file.

- [ ] **Step 2: Strip behavioral prose from tool descriptions**

For each tool file, locate the `description` fields inside the tool definitions. Remove behavioral guidance that belongs in core prompt or skills. Keep concise technical descriptions of what the tool does and its parameters.

Example (in `src-v4/tools/memory.ts`) — this is a pattern, not a verbatim edit:

```diff
  description: `Save a profile fact about the user.
-
- Use this when the user states an identity fact (name, location, dob), a stable
- preference, a rule, or an inferred cognitive style. Categories: identity, preference,
- rule, cognitive_style, value_belief, location. Layers: L3 for critical identity,
- L2 for preferences. Before saving, check if a similar key exists and update instead.
  Arguments: category, layer, key, value, importance?, confidence?.`
+  description: `Save a profile fact. Arguments: category, layer, key, value, importance?, confidence?.
+  Inserts or overwrites a row keyed by (category, key). Categories and layers are enumerated in the schema.`
```

Apply the same pattern to every tool in every file. The rule: keep what a tool CALLER needs to know (shape, effect); remove guidance about WHEN to call it.

- [ ] **Step 3: Verify compile**

Run: `pnpm type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-v4/tools/message.ts src-v4/tools/cronjob.ts src-v4/tools/memory.ts src-v4/tools/tasks.ts src-v4/tools/habits.ts
git commit -m "feat(v4): migrate MCP tools with behavioral prose stripped from descriptions"
```

## Task 14: Extend tools/message-history.ts with ids filter

**Files:**
- Create: `src-v4/tools/message-history.ts` (copy + edit)
- Create: `src-v4/tools/message-history.test.ts`

- [ ] **Step 1: Copy v3 file**

```bash
cp src-v3/tools/message-history.ts src-v4/tools/message-history.ts
```

Update leading comment.

- [ ] **Step 2: Write the failing test**

Create `src-v4/tools/message-history.test.ts`:

```typescript
// src-v4/tools/message-history.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createMessageStore } from '../db/message.js';
import { handleSearchMessages } from './message-history.js';

describe('search_messages with ids filter', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createMessageStore>;

  beforeEach(() => {
    db = new Database(':memory:');
    store = createMessageStore(db);
    for (const t of [100, 200, 300]) {
      store.insert({
        id: `m${t}`, gateway: 'console', session_id: 'x', sender: 'user',
        timestamp: t, type: 'text', body: `body ${t}`,
        has_media: 0, media_mimetype: null, media_filename: null, media_size: null,
        media_path: null, quoted_msg_id: null, is_forwarded: 0, raw_json: null,
      });
    }
  });

  it('returns messages matching ids filter, ignoring other filters', async () => {
    const res = await handleSearchMessages({ store }, { ids: ['m100', 'm300'] });
    const ids = res.messages.map((m: any) => m.id).sort();
    expect(ids).toEqual(['m100', 'm300']);
  });

  it('falls back to normal search when ids not provided', async () => {
    const res = await handleSearchMessages({ store }, { limit: 10 });
    expect(res.messages.length).toBe(3);
  });
});
```

Note: the exact signature of `handleSearchMessages` depends on how v3 structures its MCP tool handlers — the engineer should adapt to match. The critical invariant: when the tool receives an `ids` parameter, it routes to `store.getMessagesByIds` instead of `store.search`.

- [ ] **Step 3: Run test — expect failure**

Run: `pnpm vitest run src-v4/tools/message-history.test.ts`
Expected: FAIL.

- [ ] **Step 4: Edit message-history.ts to add ids handling**

In `src-v4/tools/message-history.ts`:

(a) Extend the tool's Zod input schema to accept `ids` (optional string array):

```typescript
const SearchInput = z.object({
  ids: z.array(z.string()).optional(),
  from_time: z.string().optional(),
  to_time: z.string().optional(),
  sender: z.enum(['user', 'assistant', 'system']).optional(),
  query: z.string().optional(),
  gateway: z.string().optional(),
  has_media: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  order: z.enum(['newest', 'oldest', 'relevant']).optional(),
});
```

(b) Update the handler (call it `handleSearchMessages` if not already) to branch on `ids`:

```typescript
export async function handleSearchMessages(
  ctx: { store: MessageStore },
  input: z.infer<typeof SearchInput>
): Promise<{ messages: MessageRecord[] }> {
  if (input.ids && input.ids.length > 0) {
    return { messages: ctx.store.getMessagesByIds(input.ids) };
  }
  // existing path:
  const filter: SearchFilter = {
    fromTime: input.from_time ? Date.parse(input.from_time) / 1000 : undefined,
    toTime: input.to_time ? Date.parse(input.to_time) / 1000 : undefined,
    sender: input.sender,
    query: input.query,
    gateway: input.gateway,
    hasMedia: input.has_media,
    limit: input.limit,
    order: input.order,
  };
  return { messages: ctx.store.search(filter) };
}
```

(c) Strip behavioral prose from the tool description. Keep a single concise line.

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm vitest run src-v4/tools/message-history.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-v4/tools/message-history.ts src-v4/tools/message-history.test.ts
git commit -m "feat(v4): extend search_messages with ids filter for msg_ref lookup"
```

## Task 15: New tools/skill.ts MCP — write_skill and archive_skill

**Files:**
- Create: `src-v4/tools/skill.ts`
- Create: `src-v4/tools/skill.test.ts`

- [ ] **Step 1: Study an existing MCP tool for server-building pattern**

Read `src-v4/tools/message.ts`. Note how it defines the MCP server (Zod schema, tool registration, async handler, return shape). The new `skill.ts` will follow the same pattern.

- [ ] **Step 2: Write the failing test**

Create `src-v4/tools/skill.test.ts`:

```typescript
// src-v4/tools/skill.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleWriteSkill, handleArchiveSkill } from './skill.js';

describe('skill MCP handlers', () => {
  let dataDir: string;
  const userId = 'u1';

  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'v4-skill-mcp-')); });
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('handleWriteSkill creates file and returns created status', async () => {
    const res = await handleWriteSkill(
      { dataDir, userId },
      { name: 'my-skill', description: 'test', body: 'hello' }
    );
    expect(res.status).toBe('created');
    expect(existsSync(join(dataDir, 'users', userId, '.claude', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
  });

  it('handleArchiveSkill moves file', async () => {
    await handleWriteSkill({ dataDir, userId }, { name: 'kx', description: 'x', body: 'y' });
    const res = await handleArchiveSkill({ dataDir, userId }, { name: 'kx' });
    expect(res.status).toBe('archived');
  });
});
```

- [ ] **Step 3: Run test — expect failure**

Run: `pnpm vitest run src-v4/tools/skill.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement tools/skill.ts**

Create `src-v4/tools/skill.ts`:

```typescript
// src-v4/tools/skill.ts
//
// MCP tools for skill write/archive operations. Discovery of existing skills
// is handled natively by the Claude Agent SDK via the per-user cwd configured
// in ai-engine/options.ts — no list/read tools here.

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { writeSkill, archiveSkill, SKILL_NAME_RE } from '../skills/storage.js';

export interface SkillContext {
  dataDir: string;
  userId: string;
}

const WriteInput = z.object({
  name: z.string().regex(SKILL_NAME_RE, 'kebab-case, 3-60 chars').min(3).max(60),
  description: z.string().min(1).max(300),
  body: z.string().min(1),
});

const ArchiveInput = z.object({
  name: z.string().regex(SKILL_NAME_RE).min(3).max(60),
});

export async function handleWriteSkill(ctx: SkillContext, input: z.infer<typeof WriteInput>) {
  return writeSkill({
    dataDir: ctx.dataDir,
    userId: ctx.userId,
    name: input.name,
    description: input.description,
    body: input.body,
  });
}

export async function handleArchiveSkill(ctx: SkillContext, input: z.infer<typeof ArchiveInput>) {
  return archiveSkill({
    dataDir: ctx.dataDir,
    userId: ctx.userId,
    name: input.name,
  });
}

export function createSkillToolServer(ctx: SkillContext) {
  return createSdkMcpServer({
    name: 'skill',
    version: '1.0.0',
    tools: [
      tool(
        'write_skill',
        'Create or update a skill. Upserts by name. Body is a markdown document in English.',
        WriteInput.shape,
        async (input) => {
          const result = await handleWriteSkill(ctx, input);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        }
      ),
      tool(
        'archive_skill',
        'Move a skill from active to archived. Archived skills are not discovered by the runtime.',
        ArchiveInput.shape,
        async (input) => {
          const result = await handleArchiveSkill(ctx, input);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        }
      ),
    ],
  });
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `pnpm vitest run src-v4/tools/skill.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-v4/tools/skill.ts src-v4/tools/skill.test.ts
git commit -m "feat(v4): skill MCP server with write_skill and archive_skill"
```

---

# Phase 7 — Cron

## Task 16: Copy cron verbatim

**Files:**
- Create: `src-v4/cron/registry.ts`, `scheduler.ts`, `utils.ts`

- [ ] **Step 1: Copy**

```bash
for f in registry scheduler utils; do
  cp "src-v3/cron/$f.ts" "src-v4/cron/$f.ts"
done
```

- [ ] **Step 2: Update header comments src-v3 → src-v4**

Edit each of the three files.

- [ ] **Step 3: Verify compile**

Run: `pnpm type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-v4/cron
git commit -m "feat(v4): cron scheduler and registry (verbatim from v3)"
```

---

# Phase 8 — Gateway

## Task 17: Copy gateway/types.ts and gateway/console.ts with wake-up + summarize hooks

**Files:**
- Create: `src-v4/gateway/types.ts` (verbatim)
- Create: `src-v4/gateway/console.ts` (edited)

- [ ] **Step 1: Copy both files**

```bash
cp src-v3/gateway/types.ts src-v4/gateway/types.ts
cp src-v3/gateway/console.ts src-v4/gateway/console.ts
```

Update header comments.

- [ ] **Step 2: Wire wake-up briefing assembly on new session**

In `src-v4/gateway/console.ts`, find where the system prompt is built or passed to the engine. v3 uses `DEFAULT_SYSTEM_PROMPT` or a builder that injects memory. Replace that with v4's flow:

(a) Import the new modules:

```typescript
import { assembleSystemPrompt } from '../core/system-prompt.js';
import { buildWakeUpBriefing, renderWakeUpBriefing } from '../core/wake-up.js';
import { summarizeSession } from '../core/summarize.js';
import { ensureUserSkillDir } from '../skills/storage.js';
```

(b) Before starting a new query, ensure the user's skill directory exists (so SDK's per-user cwd discovery does not error on first-ever skill access):

```typescript
await ensureUserSkillDir({ dataDir: DATA_DIR, userId });
```

(c) When starting a new session (no valid `sessionId`), build the briefing and assemble the system prompt:

```typescript
const briefingData = await buildWakeUpBriefing({
  userId,
  now: new Date(),
  timezone: TIMEZONE,   // default 'WIB' or config-driven
  userDb,
});
const briefing = renderWakeUpBriefing(briefingData);
const systemPrompt = assembleSystemPrompt(briefing);
```

(d) Pass `systemPrompt` + per-user `cwd` to the engine query:

```typescript
await engine.query(promptPayload, {
  systemPrompt,
  cwd: `${DATA_DIR}/users/${userId}`,
  sessionId,                            // undefined for new session
  callbacks: { /* ... */ },
});
```

(e) After the query completes, check if `turnCount >= SUMMARIZE_TURN_THRESHOLD`. If yes and exchange is complete, mark `pendingSummarize[userId] = true`. On the NEXT incoming message, before handling it, check the flag — if set, run:

```typescript
if (pendingSummarize[userId]) {
  await summarizeSession({
    sessionId: currentSessionId, userId,
    reason: 'turn_threshold',
    messages: userDb.messages,
    sessions: userDb.sessions,
    model: SUMMARIZE_MODEL,
    cwd: `${DATA_DIR}/users/${userId}`,
  });
  sessionStore.clear(userId);  // forces next query to use new session + fresh briefing
  pendingSummarize[userId] = false;
}
```

- [ ] **Step 3: Verify compile**

Run: `pnpm type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-v4/gateway
git commit -m "feat(v4): console gateway wired with wake-up briefing + soft-cutoff summarize"
```

## Task 18: Copy gateway/telegram.ts with same hooks

**Files:**
- Create: `src-v4/gateway/telegram.ts`

- [ ] **Step 1: Copy**

```bash
cp src-v3/gateway/telegram.ts src-v4/gateway/telegram.ts
```

Update header comment.

- [ ] **Step 2: Apply the same wake-up + summarize wiring from Task 17**

The changes mirror console.ts exactly — same imports, same ensureUserSkillDir call, same system prompt assembly, same post-query summarize check. The only difference is the gateway's input/output plumbing.

- [ ] **Step 3: Verify compile**

Run: `pnpm type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-v4/gateway/telegram.ts
git commit -m "feat(v4): telegram gateway wired with wake-up briefing + soft-cutoff summarize"
```

---

# Phase 9 — Trigger

## Task 19: Copy trigger verbatim

**Files:**
- Create: `src-v4/trigger/server.ts`, `types.ts`

- [ ] **Step 1: Copy**

```bash
cp src-v3/trigger/server.ts src-v4/trigger/server.ts
cp src-v3/trigger/types.ts src-v4/trigger/types.ts
```

Update header comments.

- [ ] **Step 2: Verify compile**

Run: `pnpm type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-v4/trigger
git commit -m "feat(v4): trigger server (verbatim from v3)"
```

---

# Phase 10 — Orchestrator

## Task 20: src-v4/index.ts with graceful summarize on shutdown

**Files:**
- Create: `src-v4/index.ts`

- [ ] **Step 1: Write the orchestrator**

Create `src-v4/index.ts`:

```typescript
// src-v4/index.ts

import 'dotenv/config';
import { createConsoleGateway } from './gateway/console.js';
import { createTelegramGateway } from './gateway/telegram.js';
import { summarizeSession } from './core/summarize.js';
import { log } from './utils/logger.js';

const GATEWAY_KIND = (process.env.GATEWAY ?? 'console').toLowerCase();
const DATA_DIR = process.env.DATA_DIR ?? './data';
const SUMMARIZE_MODEL = process.env.SUMMARIZE_MODEL ?? 'claude-haiku-4-5';

// Pick gateway
const gateway =
  GATEWAY_KIND === 'telegram'
    ? createTelegramGateway({
        token: process.env.TELEGRAM_BOT_TOKEN ?? '',
        whitelist: process.env.TELEGRAM_WHITELIST?.split(',').map(Number) ?? [],
      })
    : createConsoleGateway();

// Graceful shutdown
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.debug(`received ${signal}, shutting down...`);
  try {
    // Summarize all active sessions in parallel (with per-session timeout
    // inside summarizeSession itself).
    const active = gateway.getActiveSessions?.() ?? [];
    await Promise.allSettled(
      active.map((s) =>
        summarizeSession({
          sessionId: s.sessionId,
          userId: s.userId,
          reason: 'graceful_shutdown',
          messages: s.messages,
          sessions: s.sessions,
          model: SUMMARIZE_MODEL,
          cwd: `${DATA_DIR}/users/${s.userId}`,
        })
      )
    );
    await gateway.stop();
  } catch (err) {
    log.error('shutdown error', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await gateway.start();
```

Note: `getActiveSessions` is a method that should be exposed on `gateway/types.ts`. The engineer should add that method signature to the Gateway interface and implement it in both gateways. A session entry needs: `sessionId`, `userId`, and per-user `messages` + `sessions` store handles (or a way to obtain them).

- [ ] **Step 2: Extend `gateway/types.ts` with getActiveSessions**

Edit `src-v4/gateway/types.ts` — add to the Gateway interface:

```typescript
export interface ActiveSessionInfo {
  sessionId: string;
  userId: string;
  messages: MessageStore;
  sessions: SessionStore;
}

export interface Gateway {
  // existing methods...
  start(): Promise<void>;
  stop(): Promise<void>;
  getActiveSessions?(): ActiveSessionInfo[];
}
```

Then implement `getActiveSessions` in both `console.ts` and `telegram.ts` — each gateway knows its currently-active users and their DB handles.

- [ ] **Step 3: Verify compile**

Run: `pnpm type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-v4/index.ts src-v4/gateway/types.ts src-v4/gateway/console.ts src-v4/gateway/telegram.ts
git commit -m "feat(v4): orchestrator with graceful-shutdown session summarization"
```

---

# Phase 11 — Smoke test + Cutover

## Task 21: Console-gateway golden-path smoke test

**Files:**
- Create: `scripts/test-v4-golden-path.md` (test plan notes; not runnable)

- [ ] **Step 1: Start src-v4 with console gateway**

```bash
GATEWAY=console SUMMARIZE_TURN_THRESHOLD=5 pnpm tsx src-v4/index.ts
```

- [ ] **Step 2: Execute the seven golden-path scenarios from the spec**

Follow spec Section 11. For each scenario, verify manually:

1. **Fresh user (empty memory)** — greet, ask name, save profile.
2. **Skill write** — ask for a nuanced behavior, verify the skill file appears at `data/users/<uid>/.claude/skills/<name>/SKILL.md`, verify it gets invoked on next matching trigger.
3. **Turn threshold** — chat past 5 turns, verify after-exchange summarize runs and next session has a `last_session_summary` block.
4. **Graceful shutdown** — SIGINT mid-conversation; verify `session_summaries` row appears before exit.
5. **Resume from summary** — restart, verify new session references prior summary content naturally.
6. **msg_ref lookup** — manually include an `<msg_ref id="..."/>` in a prompt and verify the AI uses `search_messages({ids: [...]})` to fetch it.
7. **Cold-start continuity** — seed a synthetic summary with a lingering topic; verify AI raises it proactively.

Document pass/fail for each scenario inline in `scripts/test-v4-golden-path.md`.

- [ ] **Step 3: Commit the smoke-test log**

```bash
git add scripts/test-v4-golden-path.md
git commit -m "test(v4): console-gateway golden-path smoke test evidence"
```

## Task 22: Cutover — flip package.json dev script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Edit package.json**

Change:

```diff
-    "dev": "tsx src-v3/index.ts",
+    "dev": "tsx src-v4/index.ts",
```

- [ ] **Step 2: Sanity run**

Run: `pnpm dev`
Expected: v4 boots, gateway starts. Ctrl+C to exit.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(v4): cutover — flip dev script from src-v3 to src-v4"
```

---

## Post-migration notes

- `src-v3/` stays in the repo untouched. It serves as reference and rollback.
- `data/users/<uid>/user.db` is shared — both v3 and v4 can read it. The new `session_summaries` table introduced by v4 is invisible to v3 (v3 never queries it).
- On v4's first boot for each user, session IDs from v3 must NOT be resumed — their compiled prompt is incompatible. **Implementation:** at the top of `src-v4/index.ts`, before starting the gateway, run a one-time cleanup that clears the stored `sessionId` for every user whose sessions DB does not contain any row in the new `session_summaries` table. This guarantees any in-progress v3 session is treated as new on the v4 side, and the next user message triggers a fresh wake-up briefing. No schema migration needed.

## End-of-plan Self-review checklist

If you are executing this plan, after the last commit:

- [ ] Every spec section has at least one task implementing it (Sections 3, 4, 5, 6, 7, 8, 9, 10, 11 are covered by Phases 1–11).
- [ ] No task ends with a placeholder or unresolved "TBD".
- [ ] Function and type names introduced in early tasks (e.g. `getRecentMessages`, `ensureUserSkillDir`, `buildWakeUpBriefing`) are used consistently by later tasks.
- [ ] All golden-path smoke scenarios pass on the console gateway before Telegram cutover.
