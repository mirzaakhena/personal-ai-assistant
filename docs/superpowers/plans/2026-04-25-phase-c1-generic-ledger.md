# Phase C1: Generic Ledger Infra + `ledger_query` SQL-only

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic per-user `ledger` store for user-defined structured time-series data (expenses, mood logs, sleep, learning progress, habit checks, …). Single table with `stream` + JSON `payload`; AI calls `ledger_append` to record and `ledger_query` (SELECT-only SQLite) to aggregate. Per-stream schema is owned by user-authored skills, not infra.

**Architecture:** New table `ledger` per-user DB. Two MCP tools — `ledger_append` (stream + payload + tags + optional ts) and `ledger_query` (raw SELECT-only SQL with parser whitelist). No bespoke aggregation API; SQLite's JSON1 (`json_extract`) + window functions cover expected use. `LedgerStore` exposed via `UserDb`; gateways register the new MCP server.

**Tech Stack:** TypeScript, vitest, better-sqlite3 (JSON1 built-in), zod, Claude Agent SDK.

**Spec reference:** [`docs/superpowers/specs/2026-04-25-pai-agnostic-infra-foundation-design.md`](../specs/2026-04-25-pai-agnostic-infra-foundation-design.md) §6 (Phase C1).

---

## File Structure

**Create:**
- `src/db/ledger.ts` — schema, `LedgerRecord` / `LedgerStore` interfaces, `createLedgerStore` factory with `append` + `query` methods. Holds the SELECT-only SQL parser as a private helper, exported as `assertSafeSelect` for unit-testability.
- `src/db/ledger.test.ts` — schema, append, parser edge cases, query happy paths.
- `src/tools/ledger.ts` — MCP server with `ledger_append` and `ledger_query` tools, mirroring the shape of `src/tools/tasks.ts`. Holds `LedgerHandlers` factory.
- `src/tools/ledger.test.ts` — handler-level tests (input validation, JSON round-trip).

**Modify:**
- `src/db/user-db.ts` — wire `createLedgerStore` into `UserDb` alongside the other stores.
- `src/gateway/telegram.ts` — register `ledger: createLedgerMcpServer(...)` in the per-query MCP servers map.
- `src/gateway/console.ts` — same.
- `src/skills/templates.ts` — extend `CLAUDE_MD_TEMPLATE` with a "Structured Logging" section pointing the AI at `ledger_append` / `ledger_query` and the convention "stream schema is owned by skills".
- `src/skills/templates.test.ts` — assert the new section is present.

**Not touched:**
- Existing stores (profile, preferences, knowledge, journal, tasks) — ledger is purely additive.
- The SDK options — `ledger_query` and `ledger_append` are added MCP tools, not SDK built-ins; no `disallowedTools` change needed.

---

## Task 1: SELECT-only SQL parser (`assertSafeSelect`)

**Files:**
- Create: `src/db/ledger.ts` (initial — only the parser)
- Test: `src/db/ledger.test.ts`

This is the security boundary. Build it first in isolation so its semantics are locked before any DB code consumes it.

- [ ] **Step 1: Write the failing test**

Create `src/db/ledger.test.ts`:

```typescript
// src/db/ledger.test.ts

import { describe, it, expect } from 'vitest';
import { assertSafeSelect } from './ledger.js';

describe('assertSafeSelect', () => {
  it('accepts a plain SELECT', () => {
    expect(() => assertSafeSelect(`SELECT * FROM ledger`)).not.toThrow();
  });

  it('accepts SELECT with WHERE / ORDER / LIMIT', () => {
    expect(() =>
      assertSafeSelect(
        `SELECT id, ts FROM ledger WHERE stream = 'expense' ORDER BY ts DESC LIMIT 10`
      )
    ).not.toThrow();
  });

  it('accepts WITH ... SELECT (CTE)', () => {
    expect(() =>
      assertSafeSelect(
        `WITH monthly AS (SELECT strftime('%Y-%m', ts/1000, 'unixepoch') AS m, SUM(json_extract(payload,'$.amount')) AS total FROM ledger WHERE stream='expense' GROUP BY m) SELECT * FROM monthly`
      )
    ).not.toThrow();
  });

  it('accepts comments inside the query', () => {
    expect(() =>
      assertSafeSelect(`-- top of month\nSELECT * FROM ledger /* inline */ WHERE 1=1`)
    ).not.toThrow();
  });

  it('rejects empty / whitespace-only input', () => {
    expect(() => assertSafeSelect('')).toThrow(/empty/i);
    expect(() => assertSafeSelect('   \n  ')).toThrow(/empty/i);
  });

  it('rejects multi-statement queries (semicolon)', () => {
    expect(() =>
      assertSafeSelect(`SELECT 1; SELECT 2`)
    ).toThrow(/multi-statement|semicolon/i);
  });

  it('rejects a trailing semicolon', () => {
    expect(() => assertSafeSelect(`SELECT 1;`)).toThrow(/multi-statement|semicolon/i);
  });

  it('rejects non-SELECT verbs (INSERT, UPDATE, DELETE)', () => {
    expect(() => assertSafeSelect(`INSERT INTO ledger VALUES (1)`)).toThrow();
    expect(() => assertSafeSelect(`UPDATE ledger SET ts = 0`)).toThrow();
    expect(() => assertSafeSelect(`DELETE FROM ledger`)).toThrow();
  });

  it('rejects DDL (CREATE, DROP, ALTER)', () => {
    expect(() => assertSafeSelect(`CREATE TABLE x(a)`)).toThrow();
    expect(() => assertSafeSelect(`DROP TABLE ledger`)).toThrow();
    expect(() => assertSafeSelect(`ALTER TABLE ledger ADD COLUMN x TEXT`)).toThrow();
  });

  it('rejects ATTACH / DETACH / PRAGMA / VACUUM / REINDEX / ANALYZE', () => {
    for (const stmt of [
      `ATTACH DATABASE 'x' AS y`,
      `DETACH DATABASE y`,
      `PRAGMA table_info(ledger)`,
      `VACUUM`,
      `REINDEX`,
      `ANALYZE`,
    ]) {
      expect(() => assertSafeSelect(stmt)).toThrow();
    }
  });

  it('rejects DML hidden after a comment', () => {
    expect(() =>
      assertSafeSelect(`/* comment */ DELETE FROM ledger`)
    ).toThrow();
  });

  it('accepts inert keywords appearing in column names but not as verbs', () => {
    // The query string contains "create" inside a column alias — still rejected
    // by the simple-keyword regex. This is acceptable for a security boundary
    // (false positive over false negative). Documented as a known limitation.
    expect(() => assertSafeSelect(`SELECT 1 AS create_count FROM ledger`)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/db/ledger.test.ts -- --run
```

Expected: FAIL — `Cannot find module './ledger.js'`.

- [ ] **Step 3: Implement the parser**

Create `src/db/ledger.ts`:

```typescript
// src/db/ledger.ts
//
// Per-user generic structured time-series store. AI uses this for
// user-defined data accumulation (expenses, mood logs, learning logs, …).
// Schema per-stream is owned by skills, not infra; this module only
// provides append + SELECT-only query primitives.

/**
 * Validate that `sql` is a single SELECT (or WITH … SELECT) statement
 * with no DDL/DML side effects. Throws on rejection; returns void on
 * success.
 *
 * Approach: strip comments, reject semicolons (no multi-statement),
 * require SELECT or WITH at the start, reject any DDL/DML keyword
 * appearing as a word boundary anywhere else.
 *
 * Known limitation: keywords appearing inside string literals or as
 * substrings of identifiers will trigger false-positive rejection
 * (e.g. `SELECT 1 AS create_count`). This is acceptable for a
 * security boundary — AI consumer can rephrase. We do NOT trade
 * tighter parsing for the risk of letting destructive SQL through.
 */
export function assertSafeSelect(sql: string): void {
  const cleaned = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  if (cleaned.length === 0) {
    throw new Error('ledger_query: empty query');
  }

  if (cleaned.includes(';')) {
    throw new Error('ledger_query: multi-statement (semicolon) queries are not allowed');
  }

  if (!/^(SELECT|WITH)\b/i.test(cleaned)) {
    throw new Error('ledger_query: only SELECT (and WITH … SELECT) queries are allowed');
  }

  const banned =
    /\b(INSERT|UPDATE|DELETE|ATTACH|DETACH|PRAGMA|ALTER|DROP|CREATE|REPLACE|TRUNCATE|VACUUM|REINDEX|ANALYZE)\b/i;
  if (banned.test(cleaned)) {
    throw new Error('ledger_query: DDL/DML keywords are not permitted');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/db/ledger.test.ts -- --run
```

Expected: all 12 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/ledger.ts src/db/ledger.test.ts
git commit -m "feat(ledger): SELECT-only SQL parser (assertSafeSelect)

Whitelist by start verb (SELECT or WITH), strip comments, reject
multi-statement and DDL/DML keywords. Conservative — false positives
preferred over false negatives at the security boundary.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `LedgerStore` schema + append

**Files:**
- Modify: `src/db/ledger.ts`
- Modify: `src/db/ledger.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/db/ledger.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedgerStore } from './ledger.js';

describe('LedgerStore.append', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ledger-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('appends a record and returns it with a generated id', () => {
    const s = createLedgerStore(db);
    const r = s.append({
      stream: 'expense',
      payload: { amount: 35000, currency: 'IDR', category: 'food', note: 'kopi' },
      tags: ['food', 'beverage'],
    });
    expect(r.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(r.stream).toBe('expense');
    expect(r.payload).toEqual({ amount: 35000, currency: 'IDR', category: 'food', note: 'kopi' });
    expect(r.tags).toBe('food beverage');
    expect(typeof r.ts).toBe('number');
    expect(typeof r.created_at).toBe('number');
  });

  it('honors a provided ts (ms epoch)', () => {
    const s = createLedgerStore(db);
    const r = s.append({
      stream: 'mood',
      payload: { score: 7 },
      ts: 1_600_000_000_000,
    });
    expect(r.ts).toBe(1_600_000_000_000);
  });

  it('persists payload as JSON-encoded TEXT in the column', () => {
    const s = createLedgerStore(db);
    const r = s.append({ stream: 'x', payload: { a: 1 } });
    const row = db
      .prepare('SELECT payload FROM ledger WHERE id = ?')
      .get(r.id) as { payload: string };
    expect(row.payload).toBe('{"a":1}');
  });

  it('rejects empty stream', () => {
    const s = createLedgerStore(db);
    expect(() => s.append({ stream: '', payload: {} })).toThrow(/stream/i);
  });

  it('joins multi-word tags with a single space', () => {
    const s = createLedgerStore(db);
    const r = s.append({
      stream: 'x',
      payload: {},
      tags: ['a', 'b', 'c'],
    });
    expect(r.tags).toBe('a b c');
  });

  it('stores null tags when omitted or empty array', () => {
    const s = createLedgerStore(db);
    const a = s.append({ stream: 'x', payload: {} });
    const b = s.append({ stream: 'x', payload: {}, tags: [] });
    expect(a.tags).toBeNull();
    expect(b.tags).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/db/ledger.test.ts -- --run
```

Expected: FAIL — `createLedgerStore` not exported.

- [ ] **Step 3: Implement schema + store**

In `src/db/ledger.ts`, add the imports at the top:

```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
```

Append the types and store factory below `assertSafeSelect`:

```typescript
export interface LedgerRecord {
  id: string;
  ts: number;
  stream: string;
  payload: unknown;
  tags: string | null;
  source_msg_id: string | null;
  created_at: number;
}

export interface LedgerStore {
  append(rec: {
    stream: string;
    payload: unknown;
    tags?: string[];
    ts?: number;
    source_msg_id?: string;
  }): LedgerRecord;

  query(sql: string): Record<string, unknown>[];
}

const DDL = `
  CREATE TABLE IF NOT EXISTS ledger (
    id            TEXT PRIMARY KEY,
    ts            INTEGER NOT NULL,
    stream        TEXT NOT NULL,
    payload       TEXT NOT NULL,
    tags          TEXT,
    source_msg_id TEXT,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_stream_ts ON ledger(stream, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_ledger_tags ON ledger(tags) WHERE tags IS NOT NULL;
`;

export function createLedgerStore(db: Database.Database): LedgerStore {
  db.exec(DDL);

  const insert = db.prepare(`
    INSERT INTO ledger (id, ts, stream, payload, tags, source_msg_id, created_at)
    VALUES (@id, @ts, @stream, @payload, @tags, @source_msg_id, @created_at)
  `);

  function append(rec: {
    stream: string;
    payload: unknown;
    tags?: string[];
    ts?: number;
    source_msg_id?: string;
  }): LedgerRecord {
    if (!rec.stream || rec.stream.length === 0) {
      throw new Error('ledger_append: stream must be a non-empty string');
    }
    const now = Date.now();
    const tags = rec.tags && rec.tags.length > 0 ? rec.tags.join(' ') : null;
    const payloadJson = JSON.stringify(rec.payload);

    const row = {
      id: randomUUID(),
      ts: rec.ts ?? now,
      stream: rec.stream,
      payload: payloadJson,
      tags,
      source_msg_id: rec.source_msg_id ?? null,
      created_at: now,
    };
    insert.run(row);
    return {
      id: row.id,
      ts: row.ts,
      stream: row.stream,
      payload: rec.payload,
      tags: row.tags,
      source_msg_id: row.source_msg_id,
      created_at: row.created_at,
    };
  }

  function query(sql: string): Record<string, unknown>[] {
    assertSafeSelect(sql);
    const stmt = db.prepare(sql);
    return stmt.all() as Record<string, unknown>[];
  }

  return { append, query };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/db/ledger.test.ts -- --run
```

Expected: 12 parser cases + 6 append cases = 18 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/ledger.ts src/db/ledger.test.ts
git commit -m "feat(ledger): schema, LedgerStore, and append() implementation

ledger table per-user DB with stream + JSON payload + tags + ts.
Append generates UUID + created_at; preserves user-provided ts.
Tags joined with space for FTS-friendly LIKE queries later.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `LedgerStore.query` happy paths

**Files:**
- Modify: `src/db/ledger.test.ts` (no implementation change — `query()` was added in Task 2)

- [ ] **Step 1: Write the failing tests**

Append to `src/db/ledger.test.ts`:

```typescript
describe('LedgerStore.query', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ledger-q-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns rows matching a SELECT', () => {
    const s = createLedgerStore(db);
    s.append({ stream: 'expense', payload: { amount: 35000, category: 'food' } });
    s.append({ stream: 'expense', payload: { amount: 12000, category: 'food' } });
    s.append({ stream: 'expense', payload: { amount: 50000, category: 'transport' } });

    const rows = s.query(
      `SELECT json_extract(payload, '$.category') AS cat, COUNT(*) AS n
       FROM ledger WHERE stream = 'expense' GROUP BY cat ORDER BY cat`
    );
    expect(rows).toEqual([
      { cat: 'food', n: 2 },
      { cat: 'transport', n: 1 },
    ]);
  });

  it('supports SUM aggregation via json_extract', () => {
    const s = createLedgerStore(db);
    s.append({ stream: 'expense', payload: { amount: 35000 } });
    s.append({ stream: 'expense', payload: { amount: 12000 } });
    s.append({ stream: 'expense', payload: { amount: 50000 } });

    const rows = s.query(
      `SELECT SUM(json_extract(payload,'$.amount')) AS total FROM ledger WHERE stream='expense'`
    );
    expect(rows[0].total).toBe(97000);
  });

  it('rejects non-SELECT statements via assertSafeSelect', () => {
    const s = createLedgerStore(db);
    expect(() => s.query(`DELETE FROM ledger`)).toThrow(/DDL\/DML/);
  });

  it('returns empty array for a SELECT that matches no rows', () => {
    const s = createLedgerStore(db);
    expect(s.query(`SELECT * FROM ledger WHERE 1=0`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

(No code change needed — the implementation in Task 2 already covers `query()`.)

```bash
pnpm test src/db/ledger.test.ts -- --run
```

Expected: 18 + 4 = 22 PASS.

- [ ] **Step 3: Commit**

```bash
git add src/db/ledger.test.ts
git commit -m "test(ledger): query happy-path coverage (aggregation, json_extract)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire `LedgerStore` into `UserDb`

**Files:**
- Modify: `src/db/user-db.ts`

- [ ] **Step 1: Wire it in**

In `src/db/user-db.ts`, add the import:

```typescript
import { createLedgerStore, type LedgerStore } from './ledger.js';
```

Add `ledger: LedgerStore;` to the `UserDb` interface in the proper place (near `tasks`, alphabetical-ish):

```typescript
export interface UserDb {
  userId: string;
  profile: ProfileStore;
  preferences: PreferenceStore;
  knowledge: KnowledgeStore;
  journal: JournalStore;
  messages: MessageStore;
  sessions: SessionStore;
  cronjobs: CronjobStore;
  tasks: TaskStore;
  ledger: LedgerStore;
  queryCosts: QueryCostStore;
  reactions: ReactionStore;
  close(): void;
}
```

In `createUserDb`, instantiate it and include in the returned object:

```typescript
  const tasks = createTaskStore(db);
  const ledger = createLedgerStore(db);
  const queryCosts = createQueryCostStore(db);
  const reactions = createReactionStore(db);

  return {
    userId,
    profile, preferences, knowledge, journal,
    messages, sessions, cronjobs, tasks, ledger, queryCosts, reactions,
    close: () => db.close(),
  };
```

- [ ] **Step 2: Type-check + tests**

```bash
pnpm type-check && pnpm test -- --run
```

Expected: clean. Existing user-db tests should still pass; the new field is exposed but unused by old tests.

- [ ] **Step 3: Commit**

```bash
git add src/db/user-db.ts
git commit -m "feat(user-db): expose ledger store

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: MCP tools — `ledger_append` and `ledger_query`

**Files:**
- Create: `src/tools/ledger.ts`
- Test: `src/tools/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tools/ledger.test.ts`:

```typescript
// src/tools/ledger.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedgerStore } from '../db/ledger.js';
import { createLedgerHandlers } from './ledger.js';

describe('createLedgerHandlers', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tools-ledger-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('appendLedger persists and returns the record', () => {
    const h = createLedgerHandlers(createLedgerStore(db));
    const r = h.appendLedger({
      stream: 'expense',
      payload: { amount: 35000, category: 'food' },
    });
    expect(r.stream).toBe('expense');
    expect(r.payload).toEqual({ amount: 35000, category: 'food' });
    expect(typeof r.id).toBe('string');
  });

  it('queryLedger runs the SELECT and returns rows', () => {
    const store = createLedgerStore(db);
    store.append({ stream: 'mood', payload: { score: 7 } });
    store.append({ stream: 'mood', payload: { score: 5 } });

    const h = createLedgerHandlers(store);
    const rows = h.queryLedger(
      `SELECT AVG(json_extract(payload,'$.score')) AS avg FROM ledger WHERE stream='mood'`
    );
    expect(rows[0].avg).toBe(6);
  });

  it('queryLedger surfaces the parser error verbatim', () => {
    const h = createLedgerHandlers(createLedgerStore(db));
    expect(() => h.queryLedger(`DELETE FROM ledger`)).toThrow(/DDL\/DML/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/tools/ledger.test.ts -- --run
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the MCP server**

Create `src/tools/ledger.ts`:

```typescript
// src/tools/ledger.ts

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { LedgerStore, LedgerRecord } from '../db/ledger.js';

export interface LedgerHandlers {
  appendLedger(rec: {
    stream: string;
    payload: unknown;
    tags?: string[];
    ts?: number;
    source_msg_id?: string;
  }): LedgerRecord;
  queryLedger(sql: string): Record<string, unknown>[];
}

export function createLedgerHandlers(store: LedgerStore): LedgerHandlers {
  return {
    appendLedger: (rec) => store.append(rec),
    queryLedger: (sql) => store.query(sql),
  };
}

const AppendInput = {
  stream: z.string().min(1).max(60),
  payload: z.record(z.string(), z.unknown()),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  ts: z.number().int().nonnegative().optional(),
  source_msg_id: z.string().optional(),
};

const QueryInput = {
  sql: z.string().min(1).max(2000),
};

export function createLedgerMcpServer(h: LedgerHandlers) {
  return createSdkMcpServer({
    name: 'ledger',
    version: '1.0.0',
    tools: [
      tool(
        'ledger_append',
        "Record a structured time-series entry. `stream` is a kebab-case " +
          "name (e.g. 'expense', 'mood', 'sleep') whose JSON payload schema " +
          "is owned by a skill the user has installed. Use `tags` for " +
          "searchable secondary axes. Pass `ts` only to backdate; default " +
          "is now.",
        AppendInput,
        async (rec) => ({
          content: [{ type: 'text' as const, text: JSON.stringify(h.appendLedger(rec)) }],
        })
      ),
      tool(
        'ledger_query',
        "Run a SELECT-only SQLite query against the ledger table. The table " +
          "schema is: id TEXT, ts INTEGER (ms epoch), stream TEXT, payload " +
          "TEXT (JSON), tags TEXT (space-separated), source_msg_id TEXT, " +
          "created_at INTEGER. Use `json_extract(payload, '$.field')` to " +
          "read inside the payload. Multi-statement queries, DDL, DML, " +
          "PRAGMA, and ATTACH are rejected.",
        QueryInput,
        async ({ sql }) => ({
          content: [{ type: 'text' as const, text: JSON.stringify(h.queryLedger(sql), null, 2) }],
        })
      ),
    ],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/tools/ledger.test.ts -- --run
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/ledger.ts src/tools/ledger.test.ts
git commit -m "feat(tools): ledger MCP server (ledger_append, ledger_query)

Tool descriptions document the table schema and rejection policy so
the AI emits valid SELECT-only queries. Query results returned as
pretty-printed JSON for readability.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire ledger MCP server into Telegram gateway

**Files:**
- Modify: `src/gateway/telegram.ts`

- [ ] **Step 1: Add import**

Near the other tool imports in `src/gateway/telegram.ts`, add:

```typescript
import { createLedgerMcpServer, createLedgerHandlers } from '../tools/ledger.js';
```

- [ ] **Step 2: Register in `runQuery`**

Find the `mcpServers` block inside `runQuery` (around `src/gateway/telegram.ts:320`):

```typescript
mcpServers: {
  message: createMessageServer(deliver, queryUserId),
  reaction: createReactionServer(react, queryUserId),
  reactionsHistory: createReactionsHistoryServer(reactionHandlersFactory(queryUserId)),
  profile: createProfileMcpServer(createProfileHandlers(userDb.profile)),
  preferences: createPreferenceMcpServer(createPreferenceHandlers(userDb.preferences)),
  knowledge: createKnowledgeMcpServer(createKnowledgeHandlers(userDb.knowledge)),
  journal: createJournalMcpServer(createJournalHandlers(userDb.journal)),
  tasks: createTaskMcpServer(createTaskHandlers(userDb.tasks)),
  cronjob: createCronjobServer(cronjobHandlersFactory(queryUserId)),
  messages: createMessageHistoryServer(messageHandlersFactory(queryUserId)),
  skill: createSkillToolServer({ dataDir, userId: queryUserId }),
},
```

Add a `ledger` entry alongside `tasks`:

```typescript
  tasks: createTaskMcpServer(createTaskHandlers(userDb.tasks)),
  ledger: createLedgerMcpServer(createLedgerHandlers(userDb.ledger)),
  cronjob: createCronjobServer(cronjobHandlersFactory(queryUserId)),
```

- [ ] **Step 3: Type-check + tests**

```bash
pnpm type-check && pnpm test -- --run
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/gateway/telegram.ts
git commit -m "feat(telegram): register ledger MCP server in runQuery

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire ledger MCP server into Console gateway

**Files:**
- Modify: `src/gateway/console.ts`

- [ ] **Step 1: Add import**

```typescript
import { createLedgerMcpServer, createLedgerHandlers } from '../tools/ledger.js';
```

- [ ] **Step 2: Register in `runQuery`**

Find the `mcpServers` block inside `runQuery` (around `src/gateway/console.ts:191`) and add `ledger` alongside `tasks`:

```typescript
  tasks: createTaskMcpServer(createTaskHandlers(userDb.tasks)),
  ledger: createLedgerMcpServer(createLedgerHandlers(userDb.ledger)),
  cronjob: createCronjobServer(cronjobHandlersFactory(queryUserId)),
```

- [ ] **Step 3: Type-check + tests**

```bash
pnpm type-check && pnpm test -- --run
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/gateway/console.ts
git commit -m "feat(console): register ledger MCP server in runQuery

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `CLAUDE_MD_TEMPLATE` gains "Structured Logging" section

**Files:**
- Modify: `src/skills/templates.ts`
- Test: `src/skills/templates.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/skills/templates.test.ts` inside `describe('CLAUDE_MD_TEMPLATE', ...)`:

```typescript
  it('includes Structured Logging guidance pointing at ledger', () => {
    expect(CLAUDE_MD_TEMPLATE).toContain('## Structured Logging');
    expect(CLAUDE_MD_TEMPLATE).toContain('ledger_append');
    expect(CLAUDE_MD_TEMPLATE).toContain('ledger_query');
    expect(CLAUDE_MD_TEMPLATE).toContain('stream');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/skills/templates.test.ts -- --run
```

Expected: FAIL — section absent.

- [ ] **Step 3: Implement**

In `src/skills/templates.ts`, append before the closing backtick of `CLAUDE_MD_TEMPLATE`:

```typescript
## Structured Logging

For user-tracked time-series data (expenses, mood, sleep, learning
progress, habits), use \`ledger_append\` with a kebab-case \`stream\`
name and a JSON \`payload\`. The schema for each stream is owned by a
skill (e.g. \`expense-tracker\`, \`mood-log\`); when a new stream is
needed, write that skill first so the payload shape is documented.

To produce reports or aggregates, use \`ledger_query\` with SELECT-only
SQLite — \`json_extract(payload, '$.field')\` reads inside the payload.
Multi-statement queries and any DDL/DML are rejected.

Don't shoehorn structured logging into knowledge or journal — those
are for prose facts and reflections, not aggregable data.
```

- [ ] **Step 4: Run test**

```bash
pnpm test src/skills/templates.test.ts -- --run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/skills/templates.ts src/skills/templates.test.ts
git commit -m "feat(skills): CLAUDE.md template — structured logging guidance

New users get explicit guidance pointing at ledger_append/ledger_query
and the convention 'stream schema owned by skill'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Build, type-check, smoke

**Files:** none modified — verification only.

- [ ] **Step 1: Type-check + build**

```bash
pnpm type-check && pnpm build
```

Expected: both clean.

- [ ] **Step 2: Full test suite**

```bash
pnpm test -- --run
```

Expected: all green. Count grew by ~22 (12 parser + 6 append + 4 query) + 3 handlers + 1 template = ~32 new tests.

- [ ] **Step 3: Programmatic smoke — full append/query roundtrip**

Create a smoke script:

```bash
cat > .pai-smoke-c1.mts <<'EOF'
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserDb } from './src/db/user-db.js';

const tmp = mkdtempSync(join(tmpdir(), 'pai-smoke-c1-'));
const db = createUserDb('u', tmp);

db.ledger.append({ stream: 'expense', payload: { amount: 35000, category: 'food', note: 'kopi' }, tags: ['food', 'beverage'] });
db.ledger.append({ stream: 'expense', payload: { amount: 12000, category: 'food', note: 'jajan' } });
db.ledger.append({ stream: 'expense', payload: { amount: 50000, category: 'transport', note: 'gojek' } });
db.ledger.append({ stream: 'mood', payload: { score: 7 } });

const totals = db.ledger.query(
  `SELECT json_extract(payload,'$.category') AS cat, SUM(json_extract(payload,'$.amount')) AS total
   FROM ledger WHERE stream='expense' GROUP BY cat ORDER BY total DESC`
);
console.log('expense totals by category:');
console.log(JSON.stringify(totals, null, 2));

console.log('\nrejected (DELETE) result:');
try {
  db.ledger.query(`DELETE FROM ledger`);
  console.log('  ! NOT rejected — this is a bug');
} catch (e) {
  console.log('  ' + (e as Error).message);
}

db.close();
rmSync(tmp, { recursive: true, force: true });
EOF
pnpm tsx .pai-smoke-c1.mts
rm .pai-smoke-c1.mts
```

Verify the output shows:
- 2 rows: `food` with total `47000`, `transport` with total `50000`.
- The DELETE attempt prints `ledger_query: DDL/DML keywords are not permitted` (or similar) — confirms parser rejection at runtime.

- [ ] **Step 4: No commit needed**

If all checks pass, no commit. If something failed, STOP and report BLOCKED.

---

## Done criteria

- [ ] All tests green (target ~159 = 127 from B + ~32 new).
- [ ] `pnpm type-check` clean.
- [ ] `pnpm build` clean.
- [ ] Smoke shows append/query roundtrip works and parser rejects DML at runtime.
- [ ] AI behavior confirmed during soak: a new "expense-tracker" skill (written by AI on user request) successfully uses `ledger_append` to record expenses and `ledger_query` for monthly totals.

If the parser rejects something the AI legitimately needs, expand the regex carefully — but always preserve the "no semicolons, no DDL/DML keywords" invariants. False-negatives (allowing DML through) are a security regression; false-positives (rejecting legitimate SELECT phrasings) are a UX nuisance the AI can rephrase around.

## Notes for future C2/C3

When approved script-skills (C2) land, ledger_query may need to grow a "prepared statement" mode where AI authors a parameterized query in a skill, the user approves, and runtime invocations bind variables without re-parsing. That's NOT in scope for C1 — flagged here so the design remembers ledger_query is the SQL surface, not a one-off.
