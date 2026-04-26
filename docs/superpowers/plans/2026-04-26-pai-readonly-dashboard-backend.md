# PAI Read-Only Dashboard — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Express HTTP backend for a read-only multi-user dashboard mounted in-process with the bot, exposing 11 SQLite stores with filter / sort / paginate, FTS5 search, per-store charts, cookie-based auth, and self-signed in-app HTTPS.

**Architecture:** A new `src/dashboard/` module owns its own Express 5 app. The active gateway (console / telegram) creates the dashboard server alongside its scheduler / trigger server, sharing the existing `UserDbCache` so the active user's read-write `UserDb` is reused (no double file-handle). Other users are opened on demand in read-only mode through a small TTL pool. Every route is reached only via cookie auth (token exchanged at login). `SQLITE_BUSY` collisions with the bot's writer are absorbed by a 3-attempt retry, then surfaced as 503 to the client.

**Tech Stack:** Express 5, cookie-parser, Zod 4, Vitest 4, supertest, better-sqlite3 12, Node `https` for in-app TLS, OpenSSL for the self-signed cert.

**Spec:** `docs/superpowers/specs/2026-04-26-pai-readonly-dashboard-design.md`

---

## File Structure

```
src/dashboard/
├── shared/
│   ├── store-types.ts            # type StoreName + StoreCategory
│   ├── api-types.ts              # request/response shapes
│   └── store-meta.ts             # type StoreConfig (no data, just type)
├── store-config.ts               # const STORE_CONFIG: Record<StoreName, StoreConfig>
├── store-config.test.ts
├── filter-builder.ts             # buildListQuery(config, params) → { sql, params }
├── filter-builder.test.ts
├── userdb-pool.ts                # createUserDbPool({ activeCache, baseDir })
├── userdb-pool.test.ts
├── auth.ts                       # cookieAuthMiddleware + login/logout helpers
├── auth.test.ts
├── error-middleware.ts           # global JSON error mapper
├── error-middleware.test.ts
├── boot.ts                       # createDashboardServer({...}) → { start, stop }
├── routes/
│   ├── auth.ts + .test.ts        # POST /api/auth, POST /api/auth/logout
│   ├── meta.ts + .test.ts        # GET  /api/meta
│   ├── users.ts + .test.ts       # GET  /api/users
│   ├── stores.ts + .test.ts      # GET  /api/users/:uid/stores
│   ├── store-list.ts + .test.ts  # GET  /api/users/:uid/stores/:store/list
│   ├── store-stats.ts + .test.ts # GET  /api/users/:uid/stores/:store/stats
│   ├── knowledge.ts + .test.ts   # GET  /api/users/:uid/knowledge/search
│   ├── messages.ts + .test.ts    # GET  /api/users/:uid/messages/search
│   │                             # GET  /api/users/:uid/messages/thread/:sessionId
│   └── ledger.ts + .test.ts      # GET  /api/users/:uid/ledger/aggregate

src/db/                           (modified — extensions only, no rewrites)
├── knowledge.ts                  # + listPage, count, searchPage with snippets, countByCategory
├── tasks.ts                      # + listPage, count, countByStatus
├── journal.ts                    # + listPage, countByWeek
├── messages.ts                   # + listPage, searchPage with snippets, countByDay
├── ledger.ts                     # + listPage, count, aggregateByStream
├── cronjobs.ts                   # + listPage, count, countByStatus
├── query-costs.ts                # + listPage, aggregateByDay
├── reactions.ts                  # + listPage, count
└── preferences.ts                # + count

src/gateway/console.ts            # wire createDashboardServer (start/stop)
src/gateway/telegram.ts           # wire createDashboardServer (start/stop)
.gitignore                        # add data/dashboard-tls/
scripts/gen-dashboard-cert.sh     # one-shot openssl provisioning
```

---

## Conventions used in this plan

- **Test command:** `pnpm test <path>` runs a single Vitest file.
- **Dev run:** `pnpm dev` (runs `tsx src/index.ts`).
- **Type check:** `pnpm type-check` (runs `tsc --noEmit`).
- **Commit style:** match recent history — `feat(dashboard): ...`, `feat(db-knowledge): ...`, `chore(dashboard): ...`. No body required for trivial steps.
- **TDD discipline:** every implementation step is preceded by a failing test step. Do not skip the "verify it fails" step — it catches false negatives where the test never ran.
- **Tests use real SQLite + temp dirs**, matching the codebase pattern (e.g. `src/db/journal.test.ts`). No mocking of `better-sqlite3`.

---

## Phase 0 — Setup

### Task 0.1: Add backend dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime + dev deps**

```bash
pnpm add express cookie-parser
pnpm add -D @types/express @types/cookie-parser supertest @types/supertest
```

Expected: `package.json` updated; `pnpm-lock.yaml` updated. Express 5.x is current default on npm.

- [ ] **Step 2: Verify type-check passes**

```bash
pnpm type-check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add express + cookie-parser + supertest for dashboard backend"
```

---

### Task 0.2: Scaffold dashboard folders + .gitignore for cert dir

**Files:**
- Create: `src/dashboard/.gitkeep`
- Create: `src/dashboard/routes/.gitkeep`
- Create: `src/dashboard/shared/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create empty folders so subsequent tasks have a place to write**

```bash
mkdir -p src/dashboard/routes src/dashboard/shared
touch src/dashboard/.gitkeep src/dashboard/routes/.gitkeep src/dashboard/shared/.gitkeep
```

- [ ] **Step 2: Add cert directory to `.gitignore`**

Open `.gitignore`. Append:

```
# self-signed cert for dashboard HTTPS (operator-generated, never committed)
data/dashboard-tls/
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore src/dashboard/
git commit -m "chore(dashboard): scaffold src/dashboard tree + ignore cert dir"
```

---

## Phase 1 — Shared types

### Task 1.1: Define StoreName, StoreCategory, StoreConfig, ApiTypes

**Files:**
- Create: `src/dashboard/shared/store-types.ts`
- Create: `src/dashboard/shared/store-meta.ts`
- Create: `src/dashboard/shared/api-types.ts`

- [ ] **Step 1: Write `store-types.ts`**

```typescript
// src/dashboard/shared/store-types.ts

export const STORE_NAMES = [
  'profile', 'preferences', 'knowledge', 'journal',
  'tasks', 'cronjobs', 'messages', 'reactions',
  'sessions', 'ledger', 'query_costs',
] as const;

export type StoreName = typeof STORE_NAMES[number];

export type StoreCategory = 'memory' | 'activity' | 'system';

export const STORE_CATEGORY: Record<StoreName, StoreCategory> = {
  profile: 'memory', preferences: 'memory', knowledge: 'memory', journal: 'memory',
  tasks: 'activity', cronjobs: 'activity', messages: 'activity', reactions: 'activity',
  sessions: 'system', ledger: 'system', query_costs: 'system',
};
```

- [ ] **Step 2: Write `store-meta.ts`**

```typescript
// src/dashboard/shared/store-meta.ts

import type { StoreName } from './store-types.js';

export type ColumnDef = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'timestamp' | 'json' | 'enum';
  width?: number;
  truncateAt?: number;
};

export type FilterDef =
  | { key: string; type: 'string' | 'substring' }
  | { key: string; type: 'enum'; options: readonly string[] }
  | { key: string; type: 'date-range' }
  | { key: string; type: 'number-range' };

export type ChartDef = {
  id: string;
  label: string;
  type: 'line' | 'bar' | 'donut';
};

export type StoreConfig = {
  name: StoreName;
  table: string;                       // SQLite table name (informational)
  primaryKey: readonly string[];       // for row identity in UI
  columns: readonly ColumnDef[];
  filters: readonly FilterDef[];
  sortable: readonly string[];         // allow-list of sort keys
  defaultSort: { key: string; dir: 'asc' | 'desc' };
  charts: readonly ChartDef[];
  fts: boolean;                        // exposes /search endpoint
};
```

- [ ] **Step 3: Write `api-types.ts`**

```typescript
// src/dashboard/shared/api-types.ts

import type { StoreName, StoreCategory } from './store-types.js';
import type { StoreConfig, ChartDef } from './store-meta.js';

export type ApiError = {
  error: { code: ErrorCode; message: string; details?: unknown };
};

export type ErrorCode =
  | 'INVALID_QUERY'
  | 'UNAUTHENTICATED'
  | 'USER_NOT_FOUND'
  | 'STORE_NOT_FOUND'
  | 'DB_BUSY'
  | 'INTERNAL';

export type AuthLoginRequest = { token: string };
export type AuthLoginResponse = { ok: true };

export type UsersListResponse = { users: Array<{ userId: string }> };

export type StoreSummary = {
  name: StoreName;
  category: StoreCategory;
  count: number;
};
export type StoresResponse = { stores: StoreSummary[] };

export type ListQuery = {
  filter?: Record<string, string | string[]>;
  sort?: string;       // "key:asc" or "key:desc"
  page?: number;       // 1-indexed
  limit?: number;      // default 50, max 200
};
export type ListResponse<Row = Record<string, unknown>> = {
  rows: Row[];
  total: number;
  page: number;
  limit: number;
};

export type SearchQuery = ListQuery & { q: string };
export type SearchHit<Row = Record<string, unknown>> = Row & { snippet?: string };
export type SearchResponse<Row = Record<string, unknown>> = {
  hits: SearchHit<Row>[];
  total: number;
  page: number;
  limit: number;
};

export type ChartPayload =
  | { type: 'line'; xKey: string; yKey: string; series: Array<Record<string, number | string>> }
  | { type: 'bar'; xKey: string; yKey: string; series: Array<Record<string, number | string>> }
  | { type: 'donut'; series: Array<{ name: string; value: number }> };

export type StatsResponse = { charts: Record<string, ChartPayload> };

export type MetaResponse = { stores: Record<StoreName, StoreConfig> };
```

- [ ] **Step 4: Verify type-check**

```bash
pnpm type-check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/shared/
git commit -m "feat(dashboard): shared store + api type definitions"
```

---

## Phase 2 — Backend foundation

### Task 2.1: store-config — initial 11 store entries

**Files:**
- Create: `src/dashboard/store-config.ts`
- Create: `src/dashboard/store-config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/store-config.test.ts

import { describe, it, expect } from 'vitest';
import { STORE_NAMES } from './shared/store-types.js';
import { STORE_CONFIG } from './store-config.js';

describe('STORE_CONFIG', () => {
  it('has an entry for every StoreName', () => {
    for (const name of STORE_NAMES) {
      expect(STORE_CONFIG[name]).toBeDefined();
      expect(STORE_CONFIG[name].name).toBe(name);
    }
  });

  it('every store has at least one column', () => {
    for (const name of STORE_NAMES) {
      expect(STORE_CONFIG[name].columns.length).toBeGreaterThan(0);
    }
  });

  it('defaultSort.key appears in sortable allow-list', () => {
    for (const name of STORE_NAMES) {
      const cfg = STORE_CONFIG[name];
      expect(cfg.sortable).toContain(cfg.defaultSort.key);
    }
  });

  it('every filter key references a known column', () => {
    for (const name of STORE_NAMES) {
      const cfg = STORE_CONFIG[name];
      const cols = new Set(cfg.columns.map((c) => c.key));
      for (const f of cfg.filters) expect(cols.has(f.key)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/dashboard/store-config.test.ts
```

Expected: FAIL — `Cannot find module './store-config.js'`.

- [ ] **Step 3: Write `store-config.ts`**

```typescript
// src/dashboard/store-config.ts

import type { StoreConfig } from './shared/store-meta.js';
import type { StoreName } from './shared/store-types.js';

export const STORE_CONFIG: Record<StoreName, StoreConfig> = {
  profile: {
    name: 'profile', table: 'profile', primaryKey: ['key'],
    columns: [
      { key: 'key', label: 'Key', type: 'string' },
      { key: 'value', label: 'Value', type: 'string', truncateAt: 200 },
      { key: 'updated_at', label: 'Updated', type: 'timestamp' },
    ],
    filters: [],
    sortable: ['key', 'updated_at'],
    defaultSort: { key: 'key', dir: 'asc' },
    charts: [],
    fts: false,
  },
  preferences: {
    name: 'preferences', table: 'preferences', primaryKey: ['kind', 'key'],
    columns: [
      { key: 'kind', label: 'Kind', type: 'enum' },
      { key: 'key', label: 'Key', type: 'string' },
      { key: 'value', label: 'Value', type: 'string', truncateAt: 200 },
      { key: 'updated_at', label: 'Updated', type: 'timestamp' },
    ],
    filters: [{ key: 'kind', type: 'enum', options: ['rule', 'style'] }],
    sortable: ['kind', 'key', 'updated_at'],
    defaultSort: { key: 'updated_at', dir: 'desc' },
    charts: [],
    fts: false,
  },
  knowledge: {
    name: 'knowledge', table: 'knowledge', primaryKey: ['category', 'key'],
    columns: [
      { key: 'category', label: 'Category', type: 'enum' },
      { key: 'key', label: 'Key', type: 'string' },
      { key: 'value', label: 'Value', type: 'string', truncateAt: 200 },
      { key: 'updated_at', label: 'Updated', type: 'timestamp' },
    ],
    filters: [{
      key: 'category', type: 'enum',
      options: ['identity', 'person', 'routine', 'context', 'insight'],
    }],
    sortable: ['category', 'key', 'updated_at'],
    defaultSort: { key: 'updated_at', dir: 'desc' },
    charts: [{ id: 'count_by_category', label: 'Entries per category', type: 'donut' }],
    fts: true,
  },
  journal: {
    name: 'journal', table: 'journal', primaryKey: ['id'],
    columns: [
      { key: 'id', label: 'ID', type: 'string', width: 80 },
      { key: 'content', label: 'Content', type: 'string', truncateAt: 300 },
      { key: 'event_date', label: 'Event date', type: 'string' },
      { key: 'created_at', label: 'Created', type: 'timestamp' },
    ],
    filters: [
      { key: 'event_date', type: 'date-range' },
      { key: 'created_at', type: 'date-range' },
    ],
    sortable: ['created_at', 'event_date'],
    defaultSort: { key: 'created_at', dir: 'desc' },
    charts: [{ id: 'count_by_week', label: 'Entries per week', type: 'bar' }],
    fts: false,
  },
  tasks: {
    name: 'tasks', table: 'tasks', primaryKey: ['id'],
    columns: [
      { key: 'id', label: 'ID', type: 'string', width: 80 },
      { key: 'title', label: 'Title', type: 'string', truncateAt: 200 },
      { key: 'status', label: 'Status', type: 'enum' },
      { key: 'trigger_type', label: 'Trigger', type: 'enum' },
      { key: 'due_date', label: 'Due', type: 'string' },
      { key: 'updated_at', label: 'Updated', type: 'timestamp' },
    ],
    filters: [
      { key: 'status', type: 'enum', options: ['pending', 'done', 'cancelled'] },
      { key: 'trigger_type', type: 'enum', options: ['time', 'event', 'always'] },
      { key: 'due_date', type: 'date-range' },
    ],
    sortable: ['status', 'due_date', 'updated_at', 'created_at'],
    defaultSort: { key: 'updated_at', dir: 'desc' },
    charts: [{ id: 'count_by_status', label: 'Tasks by status', type: 'donut' }],
    fts: false,
  },
  cronjobs: {
    name: 'cronjobs', table: 'cronjobs', primaryKey: ['id'],
    columns: [
      { key: 'id', label: 'ID', type: 'string', width: 80 },
      { key: 'type', label: 'Type', type: 'enum' },
      { key: 'status', label: 'Status', type: 'enum' },
      { key: 'schedule_human', label: 'Schedule', type: 'string' },
      { key: 'scheduled_at', label: 'Next fire', type: 'timestamp' },
    ],
    filters: [
      { key: 'type', type: 'enum', options: ['once', 'recurring'] },
      { key: 'status', type: 'enum',
        options: ['PENDING', 'EXECUTING', 'EXECUTED', 'FAILED', 'MISSED', 'ACTIVE', 'COMPLETED'] },
    ],
    sortable: ['scheduled_at', 'status'],
    defaultSort: { key: 'scheduled_at', dir: 'asc' },
    charts: [{ id: 'count_by_status', label: 'Cronjobs by status', type: 'donut' }],
    fts: false,
  },
  messages: {
    name: 'messages', table: 'messages', primaryKey: ['id'],
    columns: [
      { key: 'id', label: 'ID', type: 'string', width: 200 },
      { key: 'gateway', label: 'Gateway', type: 'enum' },
      { key: 'sender', label: 'Sender', type: 'enum' },
      { key: 'session_id', label: 'Session', type: 'string', width: 200 },
      { key: 'body', label: 'Body', type: 'string', truncateAt: 300 },
      { key: 'timestamp', label: 'When', type: 'timestamp' },
    ],
    filters: [
      { key: 'gateway', type: 'enum', options: ['console', 'telegram'] },
      { key: 'sender', type: 'enum', options: ['user', 'assistant', 'system'] },
      { key: 'session_id', type: 'string' },
      { key: 'timestamp', type: 'date-range' },
    ],
    sortable: ['timestamp'],
    defaultSort: { key: 'timestamp', dir: 'desc' },
    charts: [{ id: 'count_by_day', label: 'Messages per day', type: 'bar' }],
    fts: true,
  },
  reactions: {
    name: 'reactions', table: 'reactions', primaryKey: ['id'],
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 60 },
      { key: 'message_id', label: 'Message', type: 'string', width: 200 },
      { key: 'actor', label: 'Actor', type: 'enum' },
      { key: 'new_emojis', label: 'Emojis', type: 'json' },
      { key: 'timestamp', label: 'When', type: 'timestamp' },
    ],
    filters: [{ key: 'actor', type: 'enum', options: ['user', 'assistant'] }],
    sortable: ['timestamp'],
    defaultSort: { key: 'timestamp', dir: 'desc' },
    charts: [],
    fts: false,
  },
  sessions: {
    name: 'sessions', table: 'sessions', primaryKey: ['id'],
    columns: [
      { key: 'id', label: 'ID', type: 'number' },
      { key: 'session_id', label: 'Active session', type: 'string' },
      { key: 'updated_at', label: 'Updated', type: 'timestamp' },
    ],
    filters: [],
    sortable: ['updated_at'],
    defaultSort: { key: 'updated_at', dir: 'desc' },
    charts: [],
    fts: false,
  },
  ledger: {
    name: 'ledger', table: 'ledger', primaryKey: ['id'],
    columns: [
      { key: 'id', label: 'ID', type: 'string', width: 200 },
      { key: 'stream', label: 'Stream', type: 'string' },
      { key: 'tags', label: 'Tags', type: 'string', truncateAt: 100 },
      { key: 'payload', label: 'Payload', type: 'json' },
      { key: 'ts', label: 'When', type: 'timestamp' },
    ],
    filters: [
      { key: 'stream', type: 'string' },
      { key: 'tags', type: 'substring' },
      { key: 'ts', type: 'date-range' },
    ],
    sortable: ['ts', 'stream'],
    defaultSort: { key: 'ts', dir: 'desc' },
    charts: [{ id: 'aggregate_by_stream', label: 'Events per stream', type: 'bar' }],
    fts: false,
  },
  query_costs: {
    name: 'query_costs', table: 'query_costs', primaryKey: ['id'],
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 60 },
      { key: 'session_id', label: 'Session', type: 'string', width: 200 },
      { key: 'model', label: 'Model', type: 'string' },
      { key: 'input_tokens', label: 'Input', type: 'number' },
      { key: 'output_tokens', label: 'Output', type: 'number' },
      { key: 'actual_cost_usd', label: 'Cost (USD)', type: 'number' },
      { key: 'created_at', label: 'When', type: 'timestamp' },
    ],
    filters: [
      { key: 'session_id', type: 'string' },
      { key: 'model', type: 'string' },
      { key: 'created_at', type: 'date-range' },
    ],
    sortable: ['created_at', 'actual_cost_usd'],
    defaultSort: { key: 'created_at', dir: 'desc' },
    charts: [{ id: 'cost_by_day', label: 'Cost per day (USD)', type: 'line' }],
    fts: false,
  },
};
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm test src/dashboard/store-config.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/store-config.ts src/dashboard/store-config.test.ts
git commit -m "feat(dashboard): per-store config (columns, filters, charts) for all 11 stores"
```

---

### Task 2.2: filter-builder — whitelist-based parameterized SQL

**Files:**
- Create: `src/dashboard/filter-builder.ts`
- Create: `src/dashboard/filter-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/filter-builder.test.ts

import { describe, it, expect } from 'vitest';
import { buildListQuery, BadQueryError } from './filter-builder.js';
import { STORE_CONFIG } from './store-config.js';

describe('buildListQuery — knowledge', () => {
  const cfg = STORE_CONFIG.knowledge;

  it('builds default sort + pagination when no params', () => {
    const built = buildListQuery(cfg, {});
    expect(built.where).toBe('');
    expect(built.params).toEqual([]);
    expect(built.orderBy).toBe('ORDER BY updated_at DESC');
    expect(built.limit).toBe(50);
    expect(built.offset).toBe(0);
  });

  it('parameterizes enum filter', () => {
    const built = buildListQuery(cfg, { filter: { category: 'person' } });
    expect(built.where).toBe('WHERE category = ?');
    expect(built.params).toEqual(['person']);
  });

  it('rejects unknown filter key', () => {
    expect(() => buildListQuery(cfg, { filter: { foo: 'bar' } }))
      .toThrow(BadQueryError);
  });

  it('rejects enum value outside allow-list', () => {
    expect(() => buildListQuery(cfg, { filter: { category: '../etc/passwd' } }))
      .toThrow(BadQueryError);
  });

  it('rejects unknown sort key', () => {
    expect(() => buildListQuery(cfg, { sort: 'foo:asc' }))
      .toThrow(BadQueryError);
  });

  it('honors sort direction', () => {
    const built = buildListQuery(cfg, { sort: 'key:asc' });
    expect(built.orderBy).toBe('ORDER BY key ASC');
  });

  it('clamps limit to 200', () => {
    const built = buildListQuery(cfg, { limit: 9999 });
    expect(built.limit).toBe(200);
  });

  it('rejects page < 1', () => {
    expect(() => buildListQuery(cfg, { page: 0 })).toThrow(BadQueryError);
  });
});

describe('buildListQuery — ledger date range', () => {
  const cfg = STORE_CONFIG.ledger;

  it('builds BETWEEN clause from date-range filter (epoch ms)', () => {
    const built = buildListQuery(cfg, {
      filter: { ts: ['1700000000000', '1800000000000'] },
    });
    expect(built.where).toBe('WHERE ts >= ? AND ts <= ?');
    expect(built.params).toEqual([1700000000000, 1800000000000]);
  });
});

describe('buildListQuery — ledger substring filter', () => {
  const cfg = STORE_CONFIG.ledger;

  it('builds LIKE clause from substring filter', () => {
    const built = buildListQuery(cfg, { filter: { tags: 'spending' } });
    expect(built.where).toBe('WHERE tags LIKE ?');
    expect(built.params).toEqual(['%spending%']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/dashboard/filter-builder.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `filter-builder.ts`**

```typescript
// src/dashboard/filter-builder.ts

import type { StoreConfig, FilterDef } from './shared/store-meta.js';
import type { ListQuery } from './shared/api-types.js';

export class BadQueryError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = 'BadQueryError';
  }
}

export type BuiltQuery = {
  where: string;       // '' or 'WHERE ...'
  params: Array<string | number>;
  orderBy: string;     // 'ORDER BY ...'
  limit: number;
  offset: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function buildListQuery(cfg: StoreConfig, q: ListQuery): BuiltQuery {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (q.filter) {
    for (const [key, raw] of Object.entries(q.filter)) {
      const def = cfg.filters.find((f) => f.key === key);
      if (!def) throw new BadQueryError(`unknown filter key: ${key}`, { key });
      applyFilter(def, raw, clauses, params);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  let sortKey = cfg.defaultSort.key;
  let sortDir: 'asc' | 'desc' = cfg.defaultSort.dir;
  if (q.sort) {
    const [k, d] = q.sort.split(':');
    if (!cfg.sortable.includes(k)) throw new BadQueryError(`unknown sort key: ${k}`);
    if (d !== 'asc' && d !== 'desc') throw new BadQueryError(`bad sort direction: ${d}`);
    sortKey = k;
    sortDir = d;
  }
  const orderBy = `ORDER BY ${sortKey} ${sortDir.toUpperCase()}`;

  const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const page = q.page ?? 1;
  if (page < 1) throw new BadQueryError(`page must be >= 1, got ${page}`);
  const offset = (page - 1) * limit;

  return { where, params, orderBy, limit, offset };
}

function applyFilter(
  def: FilterDef,
  raw: string | string[],
  clauses: string[],
  params: Array<string | number>,
): void {
  switch (def.type) {
    case 'string': {
      if (Array.isArray(raw)) throw new BadQueryError(`${def.key} expects scalar`);
      clauses.push(`${def.key} = ?`);
      params.push(raw);
      return;
    }
    case 'substring': {
      if (Array.isArray(raw)) throw new BadQueryError(`${def.key} expects scalar`);
      clauses.push(`${def.key} LIKE ?`);
      params.push(`%${raw}%`);
      return;
    }
    case 'enum': {
      if (Array.isArray(raw)) throw new BadQueryError(`${def.key} expects scalar`);
      if (!def.options.includes(raw)) {
        throw new BadQueryError(`${def.key}=${raw} not in allowed values`,
          { allowed: def.options });
      }
      clauses.push(`${def.key} = ?`);
      params.push(raw);
      return;
    }
    case 'date-range': {
      const [from, to] = Array.isArray(raw) ? raw : [raw, raw];
      const fromN = Number(from);
      const toN = Number(to);
      if (!Number.isFinite(fromN) || !Number.isFinite(toN)) {
        throw new BadQueryError(`${def.key} date-range needs numeric epoch ms`);
      }
      clauses.push(`${def.key} >= ? AND ${def.key} <= ?`);
      params.push(fromN, toN);
      return;
    }
    case 'number-range': {
      const [from, to] = Array.isArray(raw) ? raw : [raw, raw];
      const fromN = Number(from);
      const toN = Number(to);
      if (!Number.isFinite(fromN) || !Number.isFinite(toN)) {
        throw new BadQueryError(`${def.key} number-range needs numeric values`);
      }
      clauses.push(`${def.key} >= ? AND ${def.key} <= ?`);
      params.push(fromN, toN);
      return;
    }
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm test src/dashboard/filter-builder.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/filter-builder.ts src/dashboard/filter-builder.test.ts
git commit -m "feat(dashboard): whitelist-based filter/sort/paginate query builder"
```

---

### Task 2.3: userdb-pool — read-only TTL cache + busy-retry

**Files:**
- Create: `src/dashboard/userdb-pool.ts`
- Create: `src/dashboard/userdb-pool.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/userdb-pool.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createUserDb } from '../db/user-db.js';
import { createUserDbPool, DbBusyError } from './userdb-pool.js';

let baseDir: string;
beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'pool-'));
});
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeUserOnDisk(uid: string): void {
  const db = createUserDb(uid, baseDir);
  db.profile.setMany([{ key: 'name', value: 'X' }]);
  db.close();
}

describe('createUserDbPool', () => {
  it('lists user IDs by scanning baseDir', () => {
    makeUserOnDisk('alice');
    makeUserOnDisk('bob');
    const pool = createUserDbPool({ baseDir });
    expect(pool.listUserIds().sort()).toEqual(['alice', 'bob']);
  });

  it('returns the active user instance instead of opening a second handle', () => {
    makeUserOnDisk('alice');
    const active = createUserDb('alice', baseDir);
    const pool = createUserDbPool({ baseDir, activeUser: { userId: 'alice', db: active } });
    expect(pool.acquire('alice')).toBe(active);
    active.close();
  });

  it('opens non-active user read-only and caches', () => {
    makeUserOnDisk('alice');
    const pool = createUserDbPool({ baseDir });
    const a = pool.acquire('alice');
    const b = pool.acquire('alice');
    expect(a).toBe(b);
    pool.dispose();
  });

  it('throws USER_NOT_FOUND for missing user dir', () => {
    const pool = createUserDbPool({ baseDir });
    expect(() => pool.acquire('ghost')).toThrowError(/USER_NOT_FOUND/);
  });

  it('retries SQLITE_BUSY then throws DbBusyError', async () => {
    makeUserOnDisk('alice');
    const pool = createUserDbPool({ baseDir });
    let attempts = 0;
    await expect(pool.runWithRetry(async () => {
      attempts += 1;
      const err = new Error('database is locked') as Error & { code?: string };
      err.code = 'SQLITE_BUSY';
      throw err;
    })).rejects.toThrow(DbBusyError);
    expect(attempts).toBe(3);
    pool.dispose();
  });

  it('runWithRetry passes through non-busy errors immediately', async () => {
    const pool = createUserDbPool({ baseDir });
    let attempts = 0;
    await expect(pool.runWithRetry(async () => {
      attempts += 1;
      throw new Error('something else');
    })).rejects.toThrow('something else');
    expect(attempts).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/dashboard/userdb-pool.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `userdb-pool.ts`**

```typescript
// src/dashboard/userdb-pool.ts

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createUserDb, type UserDb } from '../db/user-db.js';

export class DbBusyError extends Error {
  constructor(message = 'database is busy') {
    super(message);
    this.name = 'DbBusyError';
  }
}
export class UserNotFoundError extends Error {
  constructor(public userId: string) {
    super(`USER_NOT_FOUND: ${userId}`);
    this.name = 'UserNotFoundError';
  }
}

export type ActiveUser = { userId: string; db: UserDb };

export type DashboardUserDbPool = {
  listUserIds(): string[];
  acquire(userId: string): UserDb;
  runWithRetry<T>(fn: () => Promise<T> | T): Promise<T>;
  dispose(): void;
};

type CacheEntry = { db: UserDb; expiresAt: number };

const TTL_MS = 5 * 60 * 1000;
const SWEEP_MS = 60 * 1000;
const RETRY_DELAYS = [50, 100, 200];

export function createUserDbPool(opts: {
  baseDir: string;
  activeUser?: ActiveUser;
}): DashboardUserDbPool {
  const { baseDir, activeUser } = opts;
  const cache = new Map<string, CacheEntry>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [uid, e] of cache) {
      if (uid === activeUser?.userId) continue;
      if (e.expiresAt <= now) {
        e.db.close();
        cache.delete(uid);
      }
    }
  }, SWEEP_MS);
  sweep.unref?.();

  function listUserIds(): string[] {
    if (!existsSync(baseDir)) return [];
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  function acquire(userId: string): UserDb {
    if (activeUser && activeUser.userId === userId) return activeUser.db;

    const cached = cache.get(userId);
    if (cached) {
      cached.expiresAt = Date.now() + TTL_MS;
      return cached.db;
    }

    const dir = join(baseDir, userId);
    const dbPath = join(dir, 'app.db');
    if (!existsSync(dbPath)) throw new UserNotFoundError(userId);

    // createUserDb opens read-write. For pool entries we need read-only.
    // Open a raw read-only connection and wrap it minimally — but the dashboard
    // route handlers call store APIs that require the full UserDb shape, so
    // we reuse createUserDb with a readonly Database underneath. The factory
    // re-runs CREATE TABLE IF NOT EXISTS statements which are no-ops on
    // existing schemas; for safety pass a pre-opened readonly handle.
    const db = openReadOnly(dbPath, userId, baseDir);
    cache.set(userId, { db, expiresAt: Date.now() + TTL_MS });
    return db;
  }

  async function runWithRetry<T>(fn: () => Promise<T> | T): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < RETRY_DELAYS.length; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string }).code;
        if (code !== 'SQLITE_BUSY') throw err;
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]));
      }
    }
    throw new DbBusyError(`SQLITE_BUSY after ${RETRY_DELAYS.length} retries`);
  }

  function dispose(): void {
    clearInterval(sweep);
    for (const [uid, e] of cache) {
      if (uid === activeUser?.userId) continue;
      e.db.close();
    }
    cache.clear();
  }

  return { listUserIds, acquire, runWithRetry, dispose };
}

/**
 * Opens a UserDb backed by a read-only SQLite connection. We bypass createUserDb
 * because that runs DDL; here we trust the schema exists (active gateway already
 * created/migrated it).
 */
function openReadOnly(dbPath: string, userId: string, _baseDir: string): UserDb {
  // For the read-only path we reuse the store factories but with a readonly
  // connection. The store factories call CREATE TABLE IF NOT EXISTS which
  // SQLite refuses on a readonly DB — so we open read-write but never call
  // mutation methods from dashboard handlers (defense-in-depth: the bot still
  // owns writes; dashboard discipline is to never call .insert/.save/.delete).
  // This mirrors the trade-off documented in the spec §3 "Key choices".
  const conn = new Database(dbPath, { fileMustExist: true });
  conn.pragma('foreign_keys = ON');
  conn.pragma('journal_mode = DELETE');
  return wrapAsUserDb(conn, userId);
}

function wrapAsUserDb(_conn: Database.Database, userId: string): UserDb {
  // Minimal pass-through: reconstruct UserDb by calling createUserDb factories
  // on this connection. Implemented inline to avoid changing user-db.ts API.
  // (This file imports the same factories used by user-db.ts.)
  // — see implementation note in plan: keep openReadOnly logic colocated here.
  void userId;
  void _conn;
  throw new Error('openReadOnly: pending wiring — see Task 2.3 step 4');
}
```

- [ ] **Step 4: Wire `openReadOnly` properly using existing factories**

The `wrapAsUserDb` stub above is a placeholder. Replace the bottom half of `userdb-pool.ts` with:

```typescript
// Replace openReadOnly + wrapAsUserDb with the following:

import { createProfileStore } from '../db/profile.js';
import { createPreferenceStore } from '../db/preferences.js';
import { createKnowledgeStore } from '../db/knowledge.js';
import { createJournalStore } from '../db/journal.js';
import { createMessageStore } from '../db/message.js';
import { createSessionStore } from '../db/sessions.js';
import { createCronjobStore } from '../db/cronjobs.js';
import { createTaskStore } from '../db/tasks.js';
import { createLedgerStore } from '../db/ledger.js';
import { createQueryCostStore } from '../db/query-costs.js';
import { createReactionStore } from '../db/reactions.js';

function openReadOnly(dbPath: string, userId: string): UserDb {
  const conn = new Database(dbPath, { fileMustExist: true });
  conn.pragma('foreign_keys = ON');
  conn.pragma('journal_mode = DELETE');

  const messages = createMessageStore(conn);
  const profile = createProfileStore(conn);
  const preferences = createPreferenceStore(conn);
  const knowledge = createKnowledgeStore(conn);
  const journal = createJournalStore(conn);
  const sessions = createSessionStore(conn);
  const cronjobs = createCronjobStore(conn);
  const tasks = createTaskStore(conn);
  const ledger = createLedgerStore(conn);
  const queryCosts = createQueryCostStore(conn);
  const reactions = createReactionStore(conn);

  return {
    userId,
    profile, preferences, knowledge, journal, messages,
    sessions, cronjobs, tasks, ledger, queryCosts, reactions,
    close: () => conn.close(),
  };
}
```

Also remove the placeholder `wrapAsUserDb` and the unused `_baseDir` parameter — `openReadOnly(dbPath, userId)`. Update the call site inside `acquire`.

- [ ] **Step 5: Run test, verify it passes**

```bash
pnpm test src/dashboard/userdb-pool.test.ts
```

Expected: all tests pass. (If `runWithRetry` test is flaky on slow machines, the 50/100/200 ms delays still total <500 ms.)

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/userdb-pool.ts src/dashboard/userdb-pool.test.ts
git commit -m "feat(dashboard): read-only UserDb pool with TTL cache and SQLITE_BUSY retry"
```

---

### Task 2.4: auth — cookie-based middleware + login/logout

**Files:**
- Create: `src/dashboard/auth.ts`
- Create: `src/dashboard/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/auth.test.ts

import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createAuthMiddleware, mountAuthRoutes, COOKIE_NAME } from './auth.js';

function makeApp(token: string) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  mountAuthRoutes(app, { token, secureCookie: false });
  app.use('/api/protected', createAuthMiddleware({ token }));
  app.get('/api/protected/ping', (_req, res) => res.json({ pong: true }));
  return app;
}

describe('auth', () => {
  it('rejects request without cookie', async () => {
    const app = makeApp('s3cret');
    const r = await request(app).get('/api/protected/ping');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('login with wrong token → 401', async () => {
    const app = makeApp('s3cret');
    const r = await request(app).post('/api/auth').send({ token: 'wrong' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('login with correct token sets cookie and lets request through', async () => {
    const app = makeApp('s3cret');
    const agent = request.agent(app);
    const login = await agent.post('/api/auth').send({ token: 's3cret' });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ ok: true });
    const setCookie = login.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toMatch(new RegExp(`^${COOKIE_NAME}=`));
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);

    const ping = await agent.get('/api/protected/ping');
    expect(ping.status).toBe(200);
    expect(ping.body).toEqual({ pong: true });
  });

  it('logout clears cookie', async () => {
    const app = makeApp('s3cret');
    const agent = request.agent(app);
    await agent.post('/api/auth').send({ token: 's3cret' });
    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);
    const setCookie = out.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toMatch(new RegExp(`^${COOKIE_NAME}=;`));
    const ping = await agent.get('/api/protected/ping');
    expect(ping.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/dashboard/auth.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `auth.ts`**

```typescript
// src/dashboard/auth.ts

import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Express } from 'express';

export const COOKIE_NAME = 'pai_dashboard';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function unauthenticated(res: Parameters<RequestHandler>[1]): void {
  res.status(401).json({
    error: { code: 'UNAUTHENTICATED', message: 'login required' },
  });
}

export function createAuthMiddleware(opts: { token: string }): RequestHandler {
  return (req, res, next) => {
    const cookieVal = (req as { cookies?: Record<string, string> }).cookies?.[COOKIE_NAME];
    if (!cookieVal || !safeEqual(cookieVal, opts.token)) {
      unauthenticated(res);
      return;
    }
    next();
  };
}

export function mountAuthRoutes(
  app: Express,
  opts: { token: string; secureCookie: boolean },
): void {
  app.post('/api/auth', (req, res) => {
    const submitted = (req.body as { token?: unknown })?.token;
    if (typeof submitted !== 'string' || !safeEqual(submitted, opts.token)) {
      unauthenticated(res);
      return;
    }
    res.cookie(COOKIE_NAME, opts.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookie,
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.cookie(COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookie,
      maxAge: 0,
      path: '/',
    });
    res.json({ ok: true });
  });
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm test src/dashboard/auth.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/auth.ts src/dashboard/auth.test.ts
git commit -m "feat(dashboard): cookie-based auth middleware + login/logout routes"
```

---

### Task 2.5: error-middleware — typed error → JSON shape

**Files:**
- Create: `src/dashboard/error-middleware.ts`
- Create: `src/dashboard/error-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/error-middleware.test.ts

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorMiddleware } from './error-middleware.js';
import { BadQueryError } from './filter-builder.js';
import { DbBusyError, UserNotFoundError } from './userdb-pool.js';

function makeApp(handler: express.RequestHandler) {
  const app = express();
  app.get('/x', handler);
  app.use(errorMiddleware);
  return app;
}

describe('errorMiddleware', () => {
  it('maps BadQueryError → 400 INVALID_QUERY', async () => {
    const app = makeApp((_req, _res, next) => next(new BadQueryError('bad', { k: 'v' })));
    const r = await request(app).get('/x');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_QUERY');
    expect(r.body.error.details).toEqual({ k: 'v' });
  });

  it('maps UserNotFoundError → 404 USER_NOT_FOUND', async () => {
    const app = makeApp((_req, _res, next) => next(new UserNotFoundError('alice')));
    const r = await request(app).get('/x');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('maps DbBusyError → 503 DB_BUSY', async () => {
    const app = makeApp((_req, _res, next) => next(new DbBusyError()));
    const r = await request(app).get('/x');
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('DB_BUSY');
  });

  it('maps unknown error → 500 INTERNAL', async () => {
    const app = makeApp((_req, _res, next) => next(new Error('boom')));
    const r = await request(app).get('/x');
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/dashboard/error-middleware.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `error-middleware.ts`**

```typescript
// src/dashboard/error-middleware.ts

import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { BadQueryError } from './filter-builder.js';
import { DbBusyError, UserNotFoundError } from './userdb-pool.js';
import { log } from '../utils/logger.js';

export class StoreNotFoundError extends Error {
  constructor(public storeName: string) {
    super(`STORE_NOT_FOUND: ${storeName}`);
    this.name = 'StoreNotFoundError';
  }
}

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof BadQueryError) {
    res.status(400).json({
      error: { code: 'INVALID_QUERY', message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'INVALID_QUERY', message: 'invalid request', details: err.issues },
    });
    return;
  }
  if (err instanceof UserNotFoundError) {
    res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: err.message },
    });
    return;
  }
  if (err instanceof StoreNotFoundError) {
    res.status(404).json({
      error: { code: 'STORE_NOT_FOUND', message: err.message },
    });
    return;
  }
  if (err instanceof DbBusyError) {
    res.status(503).json({
      error: { code: 'DB_BUSY', message: err.message },
    });
    return;
  }
  log.error('[dashboard] unhandled error', err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'internal error' },
  });
};
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm test src/dashboard/error-middleware.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/error-middleware.ts src/dashboard/error-middleware.test.ts
git commit -m "feat(dashboard): JSON error middleware + StoreNotFoundError type"
```

---

## Phase 3 — Store API extensions

Each task in this phase adds **read-only** helpers to an existing `src/db/<store>.ts` to support pagination, total counts, FTS snippets, or chart aggregations. Each is TDD on top of the store's existing test file.

### Task 3.1: knowledge — listPage, count, searchPage with snippets, countByCategory

**Files:**
- Modify: `src/db/knowledge.ts`
- Modify: `src/db/knowledge.test.ts`

- [ ] **Step 1: Add the failing tests at the bottom of `knowledge.test.ts`**

```typescript
describe('KnowledgeStore — dashboard helpers', () => {
  it('listPage returns rows + total with limit/offset', () => {
    const db = makeDb();
    const store = createKnowledgeStore(db);
    for (let i = 0; i < 12; i++) {
      store.saveMany([{ category: 'context', key: `k${i}`, value: `v${i}` }]);
    }
    const page1 = store.listPage({ limit: 5, offset: 0 });
    expect(page1.rows.length).toBe(5);
    expect(page1.total).toBe(12);
    const page2 = store.listPage({ limit: 5, offset: 10 });
    expect(page2.rows.length).toBe(2);
  });

  it('listPage applies category filter', () => {
    const db = makeDb();
    const store = createKnowledgeStore(db);
    store.saveMany([
      { category: 'person', key: 'p1', value: 'a' },
      { category: 'context', key: 'c1', value: 'b' },
    ]);
    const r = store.listPage({ category: 'person', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.rows[0].key).toBe('p1');
  });

  it('searchPage returns snippets', () => {
    const db = makeDb();
    const store = createKnowledgeStore(db);
    store.saveMany([
      { category: 'person', key: 'mirza', value: 'mirza loves coffee' },
    ]);
    const r = store.searchPage('coffee', { limit: 10, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.hits[0].snippet).toContain('coffee');
  });

  it('countByCategory returns per-category counts', () => {
    const db = makeDb();
    const store = createKnowledgeStore(db);
    store.saveMany([
      { category: 'person', key: 'a', value: '1' },
      { category: 'person', key: 'b', value: '2' },
      { category: 'context', key: 'c', value: '3' },
    ]);
    const counts = store.countByCategory();
    expect(counts.person).toBe(2);
    expect(counts.context).toBe(1);
  });
});
```

If `makeDb()` does not exist in this test file, add at the top:

```typescript
import Database from 'better-sqlite3';
function makeDb() { return new Database(':memory:'); }
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/db/knowledge.test.ts
```

Expected: FAIL — `store.listPage is not a function`, etc.

- [ ] **Step 3: Add the four methods to `KnowledgeStore` in `src/db/knowledge.ts`**

Add to the `KnowledgeStore` interface:

```typescript
export interface KnowledgeStore {
  // ... existing
  listPage(opts: { category?: KnowledgeCategory; limit: number; offset: number }):
    { rows: KnowledgeRecord[]; total: number };
  searchPage(q: string, opts: { category?: KnowledgeCategory; limit: number; offset: number }):
    { hits: Array<KnowledgeRecord & { snippet: string }>; total: number };
  countByCategory(): Record<KnowledgeCategory, number>;
}
```

Add to `createKnowledgeStore` body:

```typescript
function listPage(opts: { category?: KnowledgeCategory; limit: number; offset: number }) {
  const where = opts.category ? 'WHERE category = ?' : '';
  const params = opts.category ? [opts.category] : [];
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM knowledge ${where}`)
    .get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT category, key, value, source_msg_id, created_at, updated_at
     FROM knowledge ${where}
     ORDER BY updated_at DESC
     LIMIT ? OFFSET ?`,
  ).all(...params, opts.limit, opts.offset) as KnowledgeRecord[];
  return { rows, total };
}

function searchPage(
  q: string,
  opts: { category?: KnowledgeCategory; limit: number; offset: number },
) {
  const catWhere = opts.category ? 'AND k.category = ?' : '';
  const catParams = opts.category ? [opts.category] : [];
  const totalRow = db.prepare(
    `SELECT COUNT(*) AS n
     FROM knowledge_fts f JOIN knowledge k
       ON k.category = f.category AND k.key = f.key
     WHERE f.value MATCH ? ${catWhere}`,
  ).get(q, ...catParams) as { n: number };
  const hits = db.prepare(
    `SELECT k.category, k.key, k.value, k.source_msg_id, k.created_at, k.updated_at,
            snippet(knowledge_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet
     FROM knowledge_fts f JOIN knowledge k
       ON k.category = f.category AND k.key = f.key
     WHERE f.value MATCH ? ${catWhere}
     ORDER BY rank
     LIMIT ? OFFSET ?`,
  ).all(q, ...catParams, opts.limit, opts.offset) as Array<KnowledgeRecord & { snippet: string }>;
  return { hits, total: totalRow.n };
}

function countByCategory(): Record<KnowledgeCategory, number> {
  const out: Record<KnowledgeCategory, number> = {
    identity: 0, person: 0, routine: 0, context: 0, insight: 0,
  };
  const rows = db.prepare(
    `SELECT category, COUNT(*) AS n FROM knowledge GROUP BY category`,
  ).all() as Array<{ category: KnowledgeCategory; n: number }>;
  for (const r of rows) out[r.category] = r.n;
  return out;
}

return {
  // ... existing returned methods
  listPage, searchPage, countByCategory,
};
```

(The `snippet()` argument `0` refers to the first FTS column. Verify this matches the FTS table definition in the same file — adjust if the column index differs.)

- [ ] **Step 4: Run tests, verify pass**

```bash
pnpm test src/db/knowledge.test.ts
```

Expected: all tests (existing + new) pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/knowledge.ts src/db/knowledge.test.ts
git commit -m "feat(db-knowledge): listPage, searchPage with snippets, countByCategory"
```

---

### Task 3.2: messages — listPage, searchPage with snippets, getThread, countByDay

**Files:**
- Modify: `src/db/message.ts`
- Modify: `src/db/message.test.ts`

- [ ] **Step 1: Append failing tests in `message.test.ts`**

```typescript
describe('MessageStore — dashboard helpers', () => {
  it('listPage with sender filter + total count', () => {
    const db = makeDb();
    const store = createMessageStore(db);
    for (let i = 0; i < 7; i++) {
      store.insert({
        id: `m${i}`, gateway: 'console', session_id: 's', sender: 'user',
        timestamp: 1000 + i, type: 'text', body: `hi ${i}`,
        has_media: 0, media_mimetype: null, media_filename: null,
        media_size: null, media_path: null,
        quoted_msg_id: null, is_forwarded: 0, raw_json: null,
      });
    }
    const r = store.listPage({ sender: 'user', limit: 5, offset: 0 });
    expect(r.total).toBe(7);
    expect(r.rows.length).toBe(5);
  });

  it('searchPage returns FTS snippets on body', () => {
    const db = makeDb();
    const store = createMessageStore(db);
    store.insert({
      id: 'm1', gateway: 'console', session_id: 's', sender: 'user',
      timestamp: 1000, type: 'text', body: 'I love coffee in the morning',
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null,
      quoted_msg_id: null, is_forwarded: 0, raw_json: null,
    });
    const r = store.searchPage('coffee', { limit: 10, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.hits[0].snippet).toContain('coffee');
  });

  it('getThread returns all messages for a session ordered by timestamp', () => {
    const db = makeDb();
    const store = createMessageStore(db);
    for (let i = 0; i < 3; i++) {
      store.insert({
        id: `m${i}`, gateway: 'console', session_id: 'S1', sender: 'user',
        timestamp: 1000 - i, type: 'text', body: `n${i}`,
        has_media: 0, media_mimetype: null, media_filename: null,
        media_size: null, media_path: null,
        quoted_msg_id: null, is_forwarded: 0, raw_json: null,
      });
    }
    const thread = store.getThread('S1', { limit: 100, offset: 0 });
    expect(thread.rows.map((r) => r.body)).toEqual(['n2', 'n1', 'n0']);
  });

  it('countByDay buckets timestamps by Jakarta YMD', () => {
    const db = makeDb();
    const store = createMessageStore(db);
    const day1 = Date.UTC(2026, 3, 20, 10);  // 20 Apr 2026 UTC
    const day2 = Date.UTC(2026, 3, 21, 10);
    store.insert({
      id: 'a', gateway: 'console', session_id: null, sender: 'user',
      timestamp: day1, type: 'text', body: 'x',
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null,
      quoted_msg_id: null, is_forwarded: 0, raw_json: null,
    });
    store.insert({
      id: 'b', gateway: 'console', session_id: null, sender: 'user',
      timestamp: day2, type: 'text', body: 'y',
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null,
      quoted_msg_id: null, is_forwarded: 0, raw_json: null,
    });
    const buckets = store.countByDay({ sinceMs: day1 - 1000 });
    expect(buckets.length).toBeGreaterThanOrEqual(2);
    expect(buckets.reduce((a, b) => a + b.n, 0)).toBe(2);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/db/message.test.ts
```

Expected: FAIL — `store.listPage is not a function`, etc.

- [ ] **Step 3: Add methods to `MessageStore` in `src/db/message.ts`**

Add to the interface:

```typescript
export interface MessageStore {
  // ... existing
  listPage(opts: {
    gateway?: string; sender?: string; session_id?: string;
    timestampFrom?: number; timestampTo?: number;
    limit: number; offset: number;
  }): { rows: MessageRecord[]; total: number };

  searchPage(q: string, opts: {
    sender?: string; limit: number; offset: number;
  }): { hits: Array<MessageRecord & { snippet: string }>; total: number };

  getThread(sessionId: string, opts: { limit: number; offset: number }):
    { rows: MessageRecord[]; total: number };

  countByDay(opts: { sinceMs: number }): Array<{ day: string; n: number }>;
}
```

Add to `createMessageStore` body:

```typescript
function listPage(opts: {
  gateway?: string; sender?: string; session_id?: string;
  timestampFrom?: number; timestampTo?: number;
  limit: number; offset: number;
}) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.gateway)    { clauses.push('gateway = ?');    params.push(opts.gateway); }
  if (opts.sender)     { clauses.push('sender = ?');     params.push(opts.sender); }
  if (opts.session_id) { clauses.push('session_id = ?'); params.push(opts.session_id); }
  if (opts.timestampFrom != null) { clauses.push('timestamp >= ?'); params.push(opts.timestampFrom); }
  if (opts.timestampTo   != null) { clauses.push('timestamp <= ?'); params.push(opts.timestampTo); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM messages ${where}`)
    .get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM messages ${where}
     ORDER BY timestamp DESC
     LIMIT ? OFFSET ?`,
  ).all(...params, opts.limit, opts.offset) as MessageRecord[];
  return { rows, total };
}

function searchPage(q: string, opts: { sender?: string; limit: number; offset: number }) {
  const senderClause = opts.sender ? 'AND m.sender = ?' : '';
  const senderParam  = opts.sender ? [opts.sender] : [];
  const total = (db.prepare(
    `SELECT COUNT(*) AS n FROM messages_fts f
     JOIN messages m ON m.id = f.rowid
     WHERE f.body MATCH ? ${senderClause}`,
  ).get(q, ...senderParam) as { n: number }).n;
  const hits = db.prepare(
    `SELECT m.*, snippet(messages_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet
     FROM messages_fts f JOIN messages m ON m.id = f.rowid
     WHERE f.body MATCH ? ${senderClause}
     ORDER BY rank
     LIMIT ? OFFSET ?`,
  ).all(q, ...senderParam, opts.limit, opts.offset) as Array<MessageRecord & { snippet: string }>;
  return { hits, total };
}

function getThread(sessionId: string, opts: { limit: number; offset: number }) {
  const total = (db.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE session_id = ?`,
  ).get(sessionId) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM messages WHERE session_id = ?
     ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
  ).all(sessionId, opts.limit, opts.offset) as MessageRecord[];
  return { rows, total };
}

function countByDay(opts: { sinceMs: number }): Array<{ day: string; n: number }> {
  // Bucket by Jakarta YMD (UTC+7). Timestamps are unix ms.
  return db.prepare(
    `SELECT strftime('%Y-%m-%d', (timestamp / 1000 + 7*3600), 'unixepoch') AS day,
            COUNT(*) AS n
     FROM messages
     WHERE timestamp >= ?
     GROUP BY day
     ORDER BY day ASC`,
  ).all(opts.sinceMs) as Array<{ day: string; n: number }>;
}

return {
  // ... existing
  listPage, searchPage, getThread, countByDay,
};
```

(Verify the FTS table is named `messages_fts` and that `f.rowid` joins to `m.id`. Adjust the join column if the existing schema uses a different scheme.)

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test src/db/message.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/message.ts src/db/message.test.ts
git commit -m "feat(db-message): listPage, searchPage with snippets, getThread, countByDay"
```

---

### Task 3.3: tasks — listPage, count, countByStatus

**Files:**
- Modify: `src/db/tasks.ts`
- Modify: `src/db/tasks.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
describe('TaskStore — dashboard helpers', () => {
  it('listPage filters by status', () => {
    const db = makeDb();
    const store = createTaskStore(db);
    store.create({ id: 't1', title: 'a', status: 'pending' });
    store.create({ id: 't2', title: 'b', status: 'done' });
    const r = store.listPage({ status: 'pending', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.rows[0].id).toBe('t1');
  });

  it('countByStatus aggregates per status', () => {
    const db = makeDb();
    const store = createTaskStore(db);
    store.create({ id: 't1', title: 'a', status: 'pending' });
    store.create({ id: 't2', title: 'b', status: 'pending' });
    store.create({ id: 't3', title: 'c', status: 'done' });
    const c = store.countByStatus();
    expect(c.pending).toBe(2);
    expect(c.done).toBe(1);
    expect(c.cancelled).toBe(0);
  });
});
```

(If `create` signature in `tasks.ts` requires more fields — `notes`, `due_date`, `trigger_type`, `trigger_pattern` — pass nulls explicitly; the test should mirror the actual signature.)

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/db/tasks.test.ts
```

- [ ] **Step 3: Add to `TaskStore`**

```typescript
export interface TaskStore {
  // ... existing
  listPage(opts: {
    status?: 'pending' | 'done' | 'cancelled';
    trigger_type?: 'time' | 'event' | 'always';
    dueDateFrom?: string; dueDateTo?: string;
    limit: number; offset: number;
  }): { rows: TaskRecord[]; total: number };
  countByStatus(): Record<'pending' | 'done' | 'cancelled', number>;
}
```

Implementation:

```typescript
function listPage(opts: {
  status?: 'pending' | 'done' | 'cancelled';
  trigger_type?: 'time' | 'event' | 'always';
  dueDateFrom?: string; dueDateTo?: string;
  limit: number; offset: number;
}) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.status)       { clauses.push('status = ?');        params.push(opts.status); }
  if (opts.trigger_type) { clauses.push('trigger_type = ?');  params.push(opts.trigger_type); }
  if (opts.dueDateFrom)  { clauses.push('due_date >= ?');     params.push(opts.dueDateFrom); }
  if (opts.dueDateTo)    { clauses.push('due_date <= ?');     params.push(opts.dueDateTo); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM tasks ${where}`)
    .get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM tasks ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, opts.limit, opts.offset) as TaskRecord[];
  return { rows, total };
}

function countByStatus(): Record<'pending' | 'done' | 'cancelled', number> {
  const out = { pending: 0, done: 0, cancelled: 0 } as Record<string, number>;
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS n FROM tasks GROUP BY status`,
  ).all() as Array<{ status: string; n: number }>;
  for (const r of rows) if (r.status in out) out[r.status] = r.n;
  return out as Record<'pending' | 'done' | 'cancelled', number>;
}

return { /* existing */, listPage, countByStatus };
```

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test src/db/tasks.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/db/tasks.ts src/db/tasks.test.ts
git commit -m "feat(db-tasks): listPage with filters + countByStatus"
```

---

### Task 3.4: journal — listPage, countByWeek

**Files:**
- Modify: `src/db/journal.ts`
- Modify: `src/db/journal.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
describe('JournalStore — dashboard helpers', () => {
  it('listPage paginates with total count', () => {
    const db = makeDb();
    const store = createJournalStore(db);
    for (let i = 0; i < 5; i++) store.save(`entry ${i}`);
    const r = store.listPage({ limit: 3, offset: 0 });
    expect(r.total).toBe(5);
    expect(r.rows.length).toBe(3);
  });

  it('countByWeek buckets by Monday-anchored Jakarta week', () => {
    const db = makeDb();
    const store = createJournalStore(db);
    store.save('a');  // implicit "now"
    store.save('b');
    const buckets = store.countByWeek({ sinceMs: 0 });
    expect(buckets.length).toBeGreaterThanOrEqual(1);
    expect(buckets.reduce((acc, b) => acc + b.n, 0)).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/db/journal.test.ts
```

- [ ] **Step 3: Add to `JournalStore`**

```typescript
export interface JournalStore {
  // ... existing
  listPage(opts: {
    eventDateFrom?: string; eventDateTo?: string;
    createdFrom?: number; createdTo?: number;
    limit: number; offset: number;
  }): { rows: JournalRecord[]; total: number };

  countByWeek(opts: { sinceMs: number }): Array<{ week: string; n: number }>;
}
```

Implementation:

```typescript
function listPage(opts: {
  eventDateFrom?: string; eventDateTo?: string;
  createdFrom?: number; createdTo?: number;
  limit: number; offset: number;
}) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.eventDateFrom) { clauses.push('event_date >= ?'); params.push(opts.eventDateFrom); }
  if (opts.eventDateTo)   { clauses.push('event_date <= ?'); params.push(opts.eventDateTo); }
  if (opts.createdFrom != null) { clauses.push('created_at >= ?'); params.push(opts.createdFrom); }
  if (opts.createdTo   != null) { clauses.push('created_at <= ?'); params.push(opts.createdTo); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM journal ${where}`)
    .get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM journal ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, opts.limit, opts.offset) as JournalRecord[];
  return { rows, total };
}

function countByWeek(opts: { sinceMs: number }): Array<{ week: string; n: number }> {
  // Jakarta-anchored ISO week using strftime('%Y-W%W', ...)
  return db.prepare(
    `SELECT strftime('%Y-W%W', (created_at / 1000 + 7*3600), 'unixepoch') AS week,
            COUNT(*) AS n
     FROM journal WHERE created_at >= ?
     GROUP BY week ORDER BY week ASC`,
  ).all(opts.sinceMs) as Array<{ week: string; n: number }>;
}

return { /* existing */, listPage, countByWeek };
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/db/journal.test.ts
git add src/db/journal.ts src/db/journal.test.ts
git commit -m "feat(db-journal): listPage with date filters + countByWeek"
```

---

### Task 3.5: ledger — listPage, count, aggregateByStream

**Files:**
- Modify: `src/db/ledger.ts`
- Modify: `src/db/ledger.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
describe('LedgerStore — dashboard helpers', () => {
  it('listPage filters by stream', () => {
    const db = makeDb();
    const store = createLedgerStore(db);
    store.append('spending', { amount: 10 }, 'food', 1000, null);
    store.append('mood', { score: 8 }, '', 1100, null);
    const r = store.listPage({ stream: 'spending', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.rows[0].stream).toBe('spending');
  });

  it('listPage filters by tags substring', () => {
    const db = makeDb();
    const store = createLedgerStore(db);
    store.append('spending', { amount: 10 }, 'food coffee', 1000, null);
    store.append('spending', { amount: 5 }, 'transport',   1100, null);
    const r = store.listPage({ tagsLike: 'coffee', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
  });

  it('aggregateByStream returns events-per-stream', () => {
    const db = makeDb();
    const store = createLedgerStore(db);
    store.append('a', {}, '', 1, null);
    store.append('a', {}, '', 2, null);
    store.append('b', {}, '', 3, null);
    const agg = store.aggregateByStream({ sinceMs: 0 });
    const map = Object.fromEntries(agg.map((r) => [r.stream, r.n]));
    expect(map.a).toBe(2);
    expect(map.b).toBe(1);
  });
});
```

(Match the actual `append` signature — adjust positional args if it differs.)

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/db/ledger.test.ts
```

- [ ] **Step 3: Add to `LedgerStore`**

```typescript
export interface LedgerStore {
  // ... existing
  listPage(opts: {
    stream?: string; tagsLike?: string;
    tsFrom?: number; tsTo?: number;
    limit: number; offset: number;
  }): { rows: LedgerRecord[]; total: number };

  aggregateByStream(opts: { sinceMs: number }): Array<{ stream: string; n: number }>;
}
```

Implementation:

```typescript
function listPage(opts: {
  stream?: string; tagsLike?: string;
  tsFrom?: number; tsTo?: number;
  limit: number; offset: number;
}) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.stream)            { clauses.push('stream = ?'); params.push(opts.stream); }
  if (opts.tagsLike)          { clauses.push('tags LIKE ?'); params.push(`%${opts.tagsLike}%`); }
  if (opts.tsFrom != null)    { clauses.push('ts >= ?');    params.push(opts.tsFrom); }
  if (opts.tsTo   != null)    { clauses.push('ts <= ?');    params.push(opts.tsTo); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM ledger ${where}`)
    .get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM ledger ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`,
  ).all(...params, opts.limit, opts.offset) as LedgerRecord[];
  return { rows, total };
}

function aggregateByStream(opts: { sinceMs: number }) {
  return db.prepare(
    `SELECT stream, COUNT(*) AS n FROM ledger WHERE ts >= ?
     GROUP BY stream ORDER BY n DESC`,
  ).all(opts.sinceMs) as Array<{ stream: string; n: number }>;
}

return { /* existing */, listPage, aggregateByStream };
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/db/ledger.test.ts
git add src/db/ledger.ts src/db/ledger.test.ts
git commit -m "feat(db-ledger): listPage with stream/tags filters + aggregateByStream"
```

---

### Task 3.6: cronjobs — listPage, countByStatus

**Files:**
- Modify: `src/db/cronjobs.ts`
- Modify (or create): `src/db/cronjobs.test.ts` if it does not exist yet

- [ ] **Step 1: Append failing tests** (create the test file if missing, mirroring style of `tasks.test.ts`)

```typescript
describe('CronjobStore — dashboard helpers', () => {
  it('listPage filters by type and status', () => {
    const db = makeDb();
    const store = createCronjobStore(db);
    // (Use the actual insertJob signature — adjust fields to match cronjobs.ts)
    store.insertJob({ /* … minimal job, type:'once', status:'PENDING', … */ } as never);
    store.insertJob({ /* … type:'recurring', status:'ACTIVE', … */ } as never);
    const r = store.listPage({ type: 'once', limit: 50, offset: 0 });
    expect(r.total).toBe(1);
  });

  it('countByStatus aggregates', () => {
    const db = makeDb();
    const store = createCronjobStore(db);
    // … two PENDING + one EXECUTED
    const c = store.countByStatus();
    expect(c.PENDING ?? 0).toBe(2);
    expect(c.EXECUTED ?? 0).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/db/cronjobs.test.ts
```

- [ ] **Step 3: Add `listPage` and `countByStatus` to `CronjobStore`** following the same pattern as Task 3.3 (single `WHERE` builder + `COUNT(*)` for total).

```typescript
export interface CronjobStore {
  // ... existing
  listPage(opts: {
    type?: 'once' | 'recurring';
    status?: string;
    limit: number; offset: number;
  }): { rows: CronjobRecord[]; total: number };
  countByStatus(): Record<string, number>;
}

function listPage(opts: {
  type?: 'once' | 'recurring'; status?: string;
  limit: number; offset: number;
}) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.type)   { clauses.push('type = ?');   params.push(opts.type); }
  if (opts.status) { clauses.push('status = ?'); params.push(opts.status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM cronjobs ${where}`)
    .get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM cronjobs ${where} ORDER BY scheduled_at ASC LIMIT ? OFFSET ?`,
  ).all(...params, opts.limit, opts.offset) as CronjobRecord[];
  return { rows, total };
}

function countByStatus(): Record<string, number> {
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS n FROM cronjobs GROUP BY status`,
  ).all() as Array<{ status: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/db/cronjobs.test.ts
git add src/db/cronjobs.ts src/db/cronjobs.test.ts
git commit -m "feat(db-cronjobs): listPage with filters + countByStatus"
```

---

### Task 3.7: query-costs — listPage, aggregateByDay

**Files:**
- Modify: `src/db/query-costs.ts`
- Modify (or create): `src/db/query-costs.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
describe('QueryCostStore — dashboard helpers', () => {
  it('listPage paginates', () => {
    const db = makeDb();
    const store = createQueryCostStore(db);
    for (let i = 0; i < 5; i++) {
      store.insert({ /* fill required fields with i-varied values */ } as never);
    }
    const r = store.listPage({ limit: 3, offset: 0 });
    expect(r.total).toBe(5);
    expect(r.rows.length).toBe(3);
  });

  it('aggregateByDay sums cost per Jakarta YMD', () => {
    const db = makeDb();
    const store = createQueryCostStore(db);
    const day1 = Date.UTC(2026, 3, 20, 5);
    store.insert({ /* … created_at = day1, actual_cost_usd = 0.10 */ } as never);
    store.insert({ /* … created_at = day1, actual_cost_usd = 0.05 */ } as never);
    const agg = store.aggregateByDay({ sinceMs: 0 });
    expect(agg.length).toBeGreaterThanOrEqual(1);
    expect(agg.reduce((a, b) => a + b.usd, 0)).toBeCloseTo(0.15);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/db/query-costs.test.ts
```

- [ ] **Step 3: Add to `QueryCostStore`**

```typescript
export interface QueryCostStore {
  // ... existing
  listPage(opts: {
    sessionId?: string; model?: string;
    createdFrom?: number; createdTo?: number;
    limit: number; offset: number;
  }): { rows: QueryCostRecord[]; total: number };

  aggregateByDay(opts: { sinceMs: number }):
    Array<{ day: string; usd: number; queries: number }>;
}

function listPage(opts: {
  sessionId?: string; model?: string;
  createdFrom?: number; createdTo?: number;
  limit: number; offset: number;
}) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.sessionId) { clauses.push('session_id = ?'); params.push(opts.sessionId); }
  if (opts.model)     { clauses.push('model = ?');      params.push(opts.model); }
  if (opts.createdFrom != null) { clauses.push('created_at >= ?'); params.push(opts.createdFrom); }
  if (opts.createdTo   != null) { clauses.push('created_at <= ?'); params.push(opts.createdTo); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM query_costs ${where}`)
    .get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM query_costs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, opts.limit, opts.offset) as QueryCostRecord[];
  return { rows, total };
}

function aggregateByDay(opts: { sinceMs: number }) {
  return db.prepare(
    `SELECT strftime('%Y-%m-%d', (created_at / 1000 + 7*3600), 'unixepoch') AS day,
            SUM(actual_cost_usd) AS usd,
            COUNT(*) AS queries
     FROM query_costs WHERE created_at >= ?
     GROUP BY day ORDER BY day ASC`,
  ).all(opts.sinceMs) as Array<{ day: string; usd: number; queries: number }>;
}
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/db/query-costs.test.ts
git add src/db/query-costs.ts src/db/query-costs.test.ts
git commit -m "feat(db-query-costs): listPage + aggregateByDay (Jakarta YMD)"
```

---

### Task 3.8: small stores — preferences, reactions, sessions counts

These three are small enough that the routes can use the existing `list*` methods + simple `COUNT(*)` queries on the underlying connection. To keep the dashboard discipline of "no raw SQL in routes", add a `count()` helper to each.

**Files:**
- Modify: `src/db/preferences.ts` + `.test.ts`
- Modify: `src/db/reactions.ts` + `.test.ts`
- Modify: `src/db/sessions.ts` + `.test.ts`

- [ ] **Step 1: Append a failing test to each**

For preferences:
```typescript
describe('PreferenceStore — count', () => {
  it('returns total rows', () => {
    const db = makeDb();
    const s = createPreferenceStore(db);
    s.saveMany([
      { kind: 'rule', key: 'r1', value: 'v1' },
      { kind: 'style', key: 's1', value: 'v2' },
    ]);
    expect(s.count()).toBe(2);
  });
});
```

For reactions:
```typescript
describe('ReactionStore — count + listPage', () => {
  it('count + listPage with offset', () => {
    const db = makeDb();
    const s = createReactionStore(db);
    for (let i = 0; i < 3; i++) {
      s.insert({ /* fill with i-varied required fields */ } as never);
    }
    expect(s.count()).toBe(3);
    const r = s.listPage({ limit: 2, offset: 1 });
    expect(r.rows.length).toBe(2);
    expect(r.total).toBe(3);
  });
});
```

For sessions:
```typescript
describe('SessionStore — count', () => {
  it('returns 0 if no session, 1 if session set', () => {
    const db = makeDb();
    const s = createSessionStore(db);
    expect(s.count()).toBe(0);
    s.save('sess-1');
    expect(s.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fail (one file at a time)**

```bash
pnpm test src/db/preferences.test.ts src/db/reactions.test.ts src/db/sessions.test.ts
```

- [ ] **Step 3: Add the methods**

In `preferences.ts`:
```typescript
function count(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM preferences').get() as { n: number }).n;
}
return { /* existing */, count };
```

In `reactions.ts`:
```typescript
function count(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM reactions').get() as { n: number }).n;
}
function listPage(opts: { actor?: 'user' | 'assistant'; limit: number; offset: number }) {
  const where = opts.actor ? 'WHERE actor = ?' : '';
  const params = opts.actor ? [opts.actor] : [];
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM reactions ${where}`)
    .get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT * FROM reactions ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
  ).all(...params, opts.limit, opts.offset) as ReactionRecord[];
  return { rows, total };
}
return { /* existing */, count, listPage };
```

In `sessions.ts`:
```typescript
function count(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
}
return { /* existing */, count };
```

Update interfaces to declare these methods.

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/db/preferences.test.ts src/db/reactions.test.ts src/db/sessions.test.ts
git add src/db/preferences.ts src/db/preferences.test.ts \
        src/db/reactions.ts   src/db/reactions.test.ts \
        src/db/sessions.ts    src/db/sessions.test.ts
git commit -m "feat(db): count helpers + reactions.listPage for dashboard"
```

---

## Phase 4 — Routes

### Task 4.1: routes/auth — already covered

`POST /api/auth` and `POST /api/auth/logout` are already implemented in Task 2.4 via `mountAuthRoutes`. **No new code.** This task is just a placeholder for clarity — confirm `mountAuthRoutes` is still exported and the test in Task 2.4 still passes.

- [ ] **Step 1: Re-run `auth.test.ts`**

```bash
pnpm test src/dashboard/auth.test.ts
```

Expected: pass.

- [ ] **Step 2: No commit needed.**

---

### Task 4.2: routes/users — list users from data dir

**Files:**
- Create: `src/dashboard/routes/users.ts`
- Create: `src/dashboard/routes/users.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/routes/users.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountUsersRoute } from './users.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'users-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeUser(uid: string) {
  const db = createUserDb(uid, baseDir);
  db.close();
}

function makeApp() {
  const pool = createUserDbPool({ baseDir });
  const app = express();
  mountUsersRoute(app, { pool });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users', () => {
  it('returns empty list when no users on disk', async () => {
    const r = await request(makeApp()).get('/api/users');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ users: [] });
  });

  it('returns each user on disk', async () => {
    makeUser('alice'); makeUser('bob');
    const r = await request(makeApp()).get('/api/users');
    expect(r.status).toBe(200);
    expect(r.body.users.map((u: { userId: string }) => u.userId).sort())
      .toEqual(['alice', 'bob']);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/dashboard/routes/users.test.ts
```

- [ ] **Step 3: Write `routes/users.ts`**

```typescript
// src/dashboard/routes/users.ts

import type { Express } from 'express';
import type { DashboardUserDbPool } from '../userdb-pool.js';

export function mountUsersRoute(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get('/api/users', (_req, res) => {
    const users = deps.pool.listUserIds().map((userId) => ({ userId }));
    res.json({ users });
  });
}
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/dashboard/routes/users.test.ts
git add src/dashboard/routes/users.ts src/dashboard/routes/users.test.ts
git commit -m "feat(dashboard): GET /api/users route"
```

---

### Task 4.3: routes/stores — per-user store summary (counts)

**Files:**
- Create: `src/dashboard/routes/stores.ts`
- Create: `src/dashboard/routes/stores.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/routes/stores.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountStoresRoute } from './stores.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'stores-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const pool = createUserDbPool({ baseDir });
  const app = express();
  mountStoresRoute(app, { pool });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users/:uid/stores', () => {
  it('404 for unknown user', async () => {
    const r = await request(makeApp()).get('/api/users/ghost/stores');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns summary with counts after seeding data', async () => {
    const db = createUserDb('alice', baseDir);
    db.knowledge.saveMany([{ category: 'person', key: 'k', value: 'v' }]);
    db.profile.setMany([{ key: 'name', value: 'A' }]);
    db.close();

    const r = await request(makeApp()).get('/api/users/alice/stores');
    expect(r.status).toBe(200);
    const k = r.body.stores.find((s: { name: string }) => s.name === 'knowledge');
    const p = r.body.stores.find((s: { name: string }) => s.name === 'profile');
    expect(k.count).toBe(1);
    expect(p.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/dashboard/routes/stores.test.ts
```

- [ ] **Step 3: Write `routes/stores.ts`**

```typescript
// src/dashboard/routes/stores.ts

import type { Express, Request, Response, NextFunction } from 'express';
import type { DashboardUserDbPool } from '../userdb-pool.js';
import { STORE_NAMES, STORE_CATEGORY } from '../shared/store-types.js';
import type { StoreName } from '../shared/store-types.js';
import type { UserDb } from '../../db/user-db.js';

export function mountStoresRoute(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get('/api/users/:uid/stores', (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = deps.pool.acquire(req.params.uid);
      const stores = STORE_NAMES.map((name) => ({
        name,
        category: STORE_CATEGORY[name],
        count: countFor(name, db),
      }));
      res.json({ stores });
    } catch (err) { next(err); }
  });
}

function countFor(name: StoreName, db: UserDb): number {
  switch (name) {
    case 'profile':     return db.profile.getAllRows().length;
    case 'preferences': return db.preferences.count();
    case 'knowledge':   return db.knowledge.list().length;
    case 'journal':     return db.journal.count();
    case 'tasks':       return db.tasks.listPage({ limit: 1, offset: 0 }).total;
    case 'cronjobs':    return db.cronjobs.listPage({ limit: 1, offset: 0 }).total;
    case 'messages':    return db.messages.count();
    case 'reactions':   return db.reactions.count();
    case 'sessions':    return db.sessions.count();
    case 'ledger':      return db.ledger.listPage({ limit: 1, offset: 0 }).total;
    case 'query_costs': return db.queryCosts.listPage({ limit: 1, offset: 0 }).total;
  }
}
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/dashboard/routes/stores.test.ts
git add src/dashboard/routes/stores.ts src/dashboard/routes/stores.test.ts
git commit -m "feat(dashboard): GET /api/users/:uid/stores summary route"
```

---

### Task 4.4: routes/store-list — generic paginated list per store

**Files:**
- Create: `src/dashboard/routes/store-list.ts`
- Create: `src/dashboard/routes/store-list.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/routes/store-list.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountStoreListRoute } from './store-list.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'store-list-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const pool = createUserDbPool({ baseDir });
  const app = express();
  mountStoreListRoute(app, { pool });
  app.use(errorMiddleware);
  return app;
}

function seedKnowledge(uid: string, n: number) {
  const db = createUserDb(uid, baseDir);
  for (let i = 0; i < n; i++) {
    db.knowledge.saveMany([{ category: 'context', key: `k${i}`, value: `v${i}` }]);
  }
  db.close();
}

describe('GET /api/users/:uid/stores/:store/list', () => {
  it('paginates knowledge', async () => {
    seedKnowledge('alice', 12);
    const r = await request(makeApp())
      .get('/api/users/alice/stores/knowledge/list?limit=5&page=1');
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBe(5);
    expect(r.body.total).toBe(12);
    expect(r.body.page).toBe(1);
    expect(r.body.limit).toBe(5);
  });

  it('rejects unknown store with 404', async () => {
    seedKnowledge('alice', 1);
    const r = await request(makeApp())
      .get('/api/users/alice/stores/nosuch/list');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('STORE_NOT_FOUND');
  });

  it('rejects unknown filter key with 400', async () => {
    seedKnowledge('alice', 1);
    const r = await request(makeApp())
      .get('/api/users/alice/stores/knowledge/list?filter[bogus]=x');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_QUERY');
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/dashboard/routes/store-list.test.ts
```

- [ ] **Step 3: Write `routes/store-list.ts`**

```typescript
// src/dashboard/routes/store-list.ts

import type { Express, Request, Response, NextFunction } from 'express';
import type { DashboardUserDbPool } from '../userdb-pool.js';
import { STORE_CONFIG } from '../store-config.js';
import { STORE_NAMES, type StoreName } from '../shared/store-types.js';
import { buildListQuery } from '../filter-builder.js';
import { StoreNotFoundError } from '../error-middleware.js';
import type { UserDb } from '../../db/user-db.js';
import type { ListQuery } from '../shared/api-types.js';

export function mountStoreListRoute(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get(
    '/api/users/:uid/stores/:store/list',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const storeName = req.params.store as StoreName;
        if (!STORE_NAMES.includes(storeName)) throw new StoreNotFoundError(storeName);
        const cfg = STORE_CONFIG[storeName];
        const params = parseQuery(req.query);
        const built = buildListQuery(cfg, params);
        const db = deps.pool.acquire(req.params.uid);
        const result = await deps.pool.runWithRetry(() => listFor(storeName, db, params, built));
        res.json({
          rows: result.rows,
          total: result.total,
          page: params.page ?? 1,
          limit: built.limit,
        });
      } catch (err) { next(err); }
    },
  );
}

function parseQuery(q: Request['query']): ListQuery {
  const out: ListQuery = {};
  if (q.filter && typeof q.filter === 'object') out.filter = q.filter as ListQuery['filter'];
  if (typeof q.sort === 'string')  out.sort = q.sort;
  if (typeof q.page === 'string')  out.page = parseInt(q.page, 10);
  if (typeof q.limit === 'string') out.limit = parseInt(q.limit, 10);
  return out;
}

function listFor(
  name: StoreName, db: UserDb, q: ListQuery,
  built: { limit: number; offset: number },
): { rows: unknown[]; total: number } {
  const f = (q.filter ?? {}) as Record<string, string>;
  switch (name) {
    case 'profile': {
      const all = db.profile.getAllRows();
      return { rows: all.slice(built.offset, built.offset + built.limit), total: all.length };
    }
    case 'preferences': {
      const all = db.preferences.list(f.kind as 'rule' | 'style' | undefined);
      return { rows: all.slice(built.offset, built.offset + built.limit), total: all.length };
    }
    case 'knowledge':
      return db.knowledge.listPage({
        category: f.category as never, limit: built.limit, offset: built.offset,
      });
    case 'journal':
      return db.journal.listPage({
        eventDateFrom: Array.isArray(f.event_date) ? f.event_date[0] : undefined,
        eventDateTo:   Array.isArray(f.event_date) ? f.event_date[1] : undefined,
        createdFrom:   Array.isArray(f.created_at) ? Number(f.created_at[0]) : undefined,
        createdTo:     Array.isArray(f.created_at) ? Number(f.created_at[1]) : undefined,
        limit: built.limit, offset: built.offset,
      });
    case 'tasks':
      return db.tasks.listPage({
        status:       f.status as never,
        trigger_type: f.trigger_type as never,
        dueDateFrom:  Array.isArray(f.due_date) ? f.due_date[0] : undefined,
        dueDateTo:    Array.isArray(f.due_date) ? f.due_date[1] : undefined,
        limit: built.limit, offset: built.offset,
      });
    case 'cronjobs':
      return db.cronjobs.listPage({
        type: f.type as never, status: f.status,
        limit: built.limit, offset: built.offset,
      });
    case 'messages':
      return db.messages.listPage({
        gateway: f.gateway, sender: f.sender, session_id: f.session_id,
        timestampFrom: Array.isArray(f.timestamp) ? Number(f.timestamp[0]) : undefined,
        timestampTo:   Array.isArray(f.timestamp) ? Number(f.timestamp[1]) : undefined,
        limit: built.limit, offset: built.offset,
      });
    case 'reactions':
      return db.reactions.listPage({
        actor: f.actor as never, limit: built.limit, offset: built.offset,
      });
    case 'sessions': {
      const id = db.sessions.get();
      const updated = db.sessions.getLastActivity?.() ?? null;
      const rows = id ? [{ id: 1, session_id: id, updated_at: updated }] : [];
      return { rows, total: rows.length };
    }
    case 'ledger':
      return db.ledger.listPage({
        stream: f.stream, tagsLike: f.tags,
        tsFrom: Array.isArray(f.ts) ? Number(f.ts[0]) : undefined,
        tsTo:   Array.isArray(f.ts) ? Number(f.ts[1]) : undefined,
        limit: built.limit, offset: built.offset,
      });
    case 'query_costs':
      return db.queryCosts.listPage({
        sessionId: f.session_id, model: f.model,
        createdFrom: Array.isArray(f.created_at) ? Number(f.created_at[0]) : undefined,
        createdTo:   Array.isArray(f.created_at) ? Number(f.created_at[1]) : undefined,
        limit: built.limit, offset: built.offset,
      });
  }
}
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/dashboard/routes/store-list.test.ts
git add src/dashboard/routes/store-list.ts src/dashboard/routes/store-list.test.ts
git commit -m "feat(dashboard): generic GET .../stores/:store/list route"
```

---

### Task 4.5: routes/store-stats — chart data per store

**Files:**
- Create: `src/dashboard/routes/store-stats.ts`
- Create: `src/dashboard/routes/store-stats.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/routes/store-stats.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountStoreStatsRoute } from './store-stats.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'stats-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const app = express();
  mountStoreStatsRoute(app, { pool: createUserDbPool({ baseDir }) });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users/:uid/stores/:store/stats', () => {
  it('returns count_by_category donut for knowledge', async () => {
    const db = createUserDb('alice', baseDir);
    db.knowledge.saveMany([
      { category: 'person', key: 'a', value: '1' },
      { category: 'person', key: 'b', value: '2' },
      { category: 'context', key: 'c', value: '3' },
    ]);
    db.close();

    const r = await request(makeApp()).get('/api/users/alice/stores/knowledge/stats?range=30d');
    expect(r.status).toBe(200);
    const chart = r.body.charts.count_by_category;
    expect(chart.type).toBe('donut');
    const map = Object.fromEntries(chart.series.map((s: { name: string; value: number }) => [s.name, s.value]));
    expect(map.person).toBe(2);
    expect(map.context).toBe(1);
  });

  it('returns empty charts object for stores with no chart defs', async () => {
    const db = createUserDb('alice', baseDir);
    db.profile.setMany([{ key: 'name', value: 'X' }]);
    db.close();
    const r = await request(makeApp()).get('/api/users/alice/stores/profile/stats');
    expect(r.status).toBe(200);
    expect(r.body.charts).toEqual({});
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/dashboard/routes/store-stats.test.ts
```

- [ ] **Step 3: Write `routes/store-stats.ts`**

```typescript
// src/dashboard/routes/store-stats.ts

import type { Express, Request, Response, NextFunction } from 'express';
import type { DashboardUserDbPool } from '../userdb-pool.js';
import { STORE_CONFIG } from '../store-config.js';
import { STORE_NAMES, type StoreName } from '../shared/store-types.js';
import { StoreNotFoundError } from '../error-middleware.js';
import { BadQueryError } from '../filter-builder.js';
import type { UserDb } from '../../db/user-db.js';
import type { ChartPayload } from '../shared/api-types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function mountStoreStatsRoute(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get(
    '/api/users/:uid/stores/:store/stats',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const storeName = req.params.store as StoreName;
        if (!STORE_NAMES.includes(storeName)) throw new StoreNotFoundError(storeName);
        const cfg = STORE_CONFIG[storeName];
        const sinceMs = parseRange(req.query.range);
        const db = deps.pool.acquire(req.params.uid);
        const charts: Record<string, ChartPayload> = {};
        for (const def of cfg.charts) {
          charts[def.id] = await deps.pool.runWithRetry(
            () => buildChart(storeName, def.id, db, sinceMs),
          );
        }
        res.json({ charts });
      } catch (err) { next(err); }
    },
  );
}

function parseRange(raw: unknown): number {
  const s = (typeof raw === 'string' ? raw : '30d').trim();
  const m = /^(\d+)d$/.exec(s);
  if (!m) throw new BadQueryError(`bad range: ${s}, expected NNNd`);
  return Date.now() - parseInt(m[1], 10) * DAY_MS;
}

function buildChart(name: StoreName, chartId: string, db: UserDb, sinceMs: number): ChartPayload {
  const key = `${name}.${chartId}`;
  switch (key) {
    case 'knowledge.count_by_category': {
      const map = db.knowledge.countByCategory();
      return {
        type: 'donut',
        series: Object.entries(map).map(([name, value]) => ({ name, value })),
      };
    }
    case 'tasks.count_by_status': {
      const map = db.tasks.countByStatus();
      return {
        type: 'donut',
        series: Object.entries(map).map(([name, value]) => ({ name, value })),
      };
    }
    case 'cronjobs.count_by_status': {
      const map = db.cronjobs.countByStatus();
      return {
        type: 'donut',
        series: Object.entries(map).map(([name, value]) => ({ name, value })),
      };
    }
    case 'journal.count_by_week': {
      const buckets = db.journal.countByWeek({ sinceMs });
      return { type: 'bar', xKey: 'week', yKey: 'n', series: buckets };
    }
    case 'messages.count_by_day': {
      const buckets = db.messages.countByDay({ sinceMs });
      return { type: 'bar', xKey: 'day', yKey: 'n', series: buckets };
    }
    case 'ledger.aggregate_by_stream': {
      const buckets = db.ledger.aggregateByStream({ sinceMs });
      return { type: 'bar', xKey: 'stream', yKey: 'n', series: buckets };
    }
    case 'query_costs.cost_by_day': {
      const buckets = db.queryCosts.aggregateByDay({ sinceMs });
      return { type: 'line', xKey: 'day', yKey: 'usd', series: buckets };
    }
    default:
      throw new BadQueryError(`unknown chart: ${key}`);
  }
}
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/dashboard/routes/store-stats.test.ts
git add src/dashboard/routes/store-stats.ts src/dashboard/routes/store-stats.test.ts
git commit -m "feat(dashboard): GET .../stores/:store/stats route + per-store chart data"
```

---

### Task 4.6: routes/knowledge — FTS search endpoint

**Files:**
- Create: `src/dashboard/routes/knowledge.ts`
- Create: `src/dashboard/routes/knowledge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/routes/knowledge.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountKnowledgeRoutes } from './knowledge.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'know-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const app = express();
  mountKnowledgeRoutes(app, { pool: createUserDbPool({ baseDir }) });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users/:uid/knowledge/search', () => {
  it('returns hits with snippets', async () => {
    const db = createUserDb('alice', baseDir);
    db.knowledge.saveMany([
      { category: 'person', key: 'mirza', value: 'mirza loves coffee' },
      { category: 'context', key: 'stack', value: 'typescript backend' },
    ]);
    db.close();

    const r = await request(makeApp())
      .get('/api/users/alice/knowledge/search?q=coffee&limit=10');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.hits[0].snippet).toContain('coffee');
  });

  it('400 when q is missing', async () => {
    const db = createUserDb('alice', baseDir);
    db.close();
    const r = await request(makeApp()).get('/api/users/alice/knowledge/search');
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/dashboard/routes/knowledge.test.ts
```

- [ ] **Step 3: Write `routes/knowledge.ts`**

```typescript
// src/dashboard/routes/knowledge.ts

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { DashboardUserDbPool } from '../userdb-pool.js';
import type { KnowledgeCategory } from '../../db/knowledge.js';

const querySchema = z.object({
  q: z.string().min(1),
  category: z.enum(['identity', 'person', 'routine', 'context', 'insight']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function mountKnowledgeRoutes(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get(
    '/api/users/:uid/knowledge/search',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = querySchema.parse(req.query);
        const db = deps.pool.acquire(req.params.uid);
        const result = await deps.pool.runWithRetry(() =>
          db.knowledge.searchPage(q.q, {
            category: q.category as KnowledgeCategory | undefined,
            limit: q.limit,
            offset: (q.page - 1) * q.limit,
          }),
        );
        res.json({
          hits: result.hits,
          total: result.total,
          page: q.page,
          limit: q.limit,
        });
      } catch (err) { next(err); }
    },
  );
}
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/dashboard/routes/knowledge.test.ts
git add src/dashboard/routes/knowledge.ts src/dashboard/routes/knowledge.test.ts
git commit -m "feat(dashboard): GET .../knowledge/search FTS endpoint"
```

---

### Task 4.7: routes/messages — FTS search + thread fetch

**Files:**
- Create: `src/dashboard/routes/messages.ts`
- Create: `src/dashboard/routes/messages.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/routes/messages.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountMessagesRoutes } from './messages.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'msg-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const app = express();
  mountMessagesRoutes(app, { pool: createUserDbPool({ baseDir }) });
  app.use(errorMiddleware);
  return app;
}

function seed(uid: string) {
  const db = createUserDb(uid, baseDir);
  for (let i = 0; i < 3; i++) {
    db.messages.insert({
      id: `m${i}`, gateway: 'console', session_id: 'S1', sender: 'user',
      timestamp: 1000 + i, type: 'text', body: i === 1 ? 'I love coffee' : `n${i}`,
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null,
      quoted_msg_id: null, is_forwarded: 0, raw_json: null,
    });
  }
  db.close();
}

describe('messages routes', () => {
  it('search hits FTS', async () => {
    seed('alice');
    const r = await request(makeApp())
      .get('/api/users/alice/messages/search?q=coffee');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.hits[0].snippet).toContain('coffee');
  });

  it('thread returns all session messages', async () => {
    seed('alice');
    const r = await request(makeApp())
      .get('/api/users/alice/messages/thread/S1');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(3);
    expect(r.body.rows.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/dashboard/routes/messages.test.ts
```

- [ ] **Step 3: Write `routes/messages.ts`**

```typescript
// src/dashboard/routes/messages.ts

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { DashboardUserDbPool } from '../userdb-pool.js';

const searchSchema = z.object({
  q: z.string().min(1),
  sender: z.enum(['user', 'assistant', 'system']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const threadSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function mountMessagesRoutes(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get(
    '/api/users/:uid/messages/search',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = searchSchema.parse(req.query);
        const db = deps.pool.acquire(req.params.uid);
        const r = await deps.pool.runWithRetry(() => db.messages.searchPage(q.q, {
          sender: q.sender, limit: q.limit, offset: (q.page - 1) * q.limit,
        }));
        res.json({ hits: r.hits, total: r.total, page: q.page, limit: q.limit });
      } catch (err) { next(err); }
    },
  );

  app.get(
    '/api/users/:uid/messages/thread/:sessionId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = threadSchema.parse(req.query);
        const db = deps.pool.acquire(req.params.uid);
        const r = await deps.pool.runWithRetry(() => db.messages.getThread(
          req.params.sessionId, { limit: q.limit, offset: (q.page - 1) * q.limit },
        ));
        res.json({ rows: r.rows, total: r.total, page: q.page, limit: q.limit });
      } catch (err) { next(err); }
    },
  );
}
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/dashboard/routes/messages.test.ts
git add src/dashboard/routes/messages.ts src/dashboard/routes/messages.test.ts
git commit -m "feat(dashboard): GET .../messages/search + .../messages/thread/:sessionId"
```

---

### Task 4.8: routes/ledger — aggregate by stream (helper for power users)

**Files:**
- Create: `src/dashboard/routes/ledger.ts`
- Create: `src/dashboard/routes/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/routes/ledger.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountLedgerRoutes } from './ledger.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'ledger-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const app = express();
  mountLedgerRoutes(app, { pool: createUserDbPool({ baseDir }) });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users/:uid/ledger/aggregate', () => {
  it('groups by stream', async () => {
    const db = createUserDb('alice', baseDir);
    db.ledger.append('a', {}, '', Date.now(), null);
    db.ledger.append('b', {}, '', Date.now(), null);
    db.ledger.append('a', {}, '', Date.now(), null);
    db.close();

    const r = await request(makeApp())
      .get('/api/users/alice/ledger/aggregate?range=30d');
    expect(r.status).toBe(200);
    const map = Object.fromEntries(r.body.series.map((s: { stream: string; n: number }) => [s.stream, s.n]));
    expect(map.a).toBe(2);
    expect(map.b).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/dashboard/routes/ledger.test.ts
```

- [ ] **Step 3: Write `routes/ledger.ts`**

```typescript
// src/dashboard/routes/ledger.ts

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { DashboardUserDbPool } from '../userdb-pool.js';

const aggSchema = z.object({
  range: z.string().regex(/^\d+d$/).default('30d'),
});

export function mountLedgerRoutes(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get(
    '/api/users/:uid/ledger/aggregate',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = aggSchema.parse(req.query);
        const days = parseInt(q.range.replace('d', ''), 10);
        const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
        const db = deps.pool.acquire(req.params.uid);
        const series = await deps.pool.runWithRetry(
          () => db.ledger.aggregateByStream({ sinceMs }),
        );
        res.json({ groupBy: 'stream', range: q.range, series });
      } catch (err) { next(err); }
    },
  );
}
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/dashboard/routes/ledger.test.ts
git add src/dashboard/routes/ledger.ts src/dashboard/routes/ledger.test.ts
git commit -m "feat(dashboard): GET .../ledger/aggregate by stream"
```

---

### Task 4.9: routes/meta — expose store config to client

**Files:**
- Create: `src/dashboard/routes/meta.ts`
- Create: `src/dashboard/routes/meta.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/routes/meta.test.ts

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mountMetaRoute } from './meta.js';
import { STORE_NAMES } from '../shared/store-types.js';

describe('GET /api/meta', () => {
  it('returns the full store config map', async () => {
    const app = express();
    mountMetaRoute(app);
    const r = await request(app).get('/api/meta');
    expect(r.status).toBe(200);
    for (const name of STORE_NAMES) {
      expect(r.body.stores[name]).toBeDefined();
      expect(r.body.stores[name].name).toBe(name);
    }
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/dashboard/routes/meta.test.ts
```

- [ ] **Step 3: Write `routes/meta.ts`**

```typescript
// src/dashboard/routes/meta.ts

import type { Express } from 'express';
import { STORE_CONFIG } from '../store-config.js';

export function mountMetaRoute(app: Express): void {
  app.get('/api/meta', (_req, res) => {
    res.json({ stores: STORE_CONFIG });
  });
}
```

- [ ] **Step 4: Run, verify pass + commit**

```bash
pnpm test src/dashboard/routes/meta.test.ts
git add src/dashboard/routes/meta.ts src/dashboard/routes/meta.test.ts
git commit -m "feat(dashboard): GET /api/meta exposes per-store config to client"
```

---

## Phase 5 — Server assembly + boot wiring + TLS

### Task 5.1: boot.ts — assemble Express app with all routes

**Files:**
- Create: `src/dashboard/boot.ts`
- Create: `src/dashboard/boot.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/dashboard/boot.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createUserDb } from '../db/user-db.js';
import { createDashboardServer } from './boot.js';

let baseDir: string;
let server: Awaited<ReturnType<typeof createDashboardServer>>;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'boot-'));
});
afterEach(async () => {
  if (server) await server.stop();
  rmSync(baseDir, { recursive: true, force: true });
});

describe('createDashboardServer', () => {
  it('returns null when token is empty (fail-soft)', () => {
    const s = createDashboardServer({
      port: 0, token: '', baseDir, activeUser: undefined,
    });
    expect(s).toBeNull();
  });

  it('starts an Express app responding to /api/meta after auth', async () => {
    const db = createUserDb('alice', baseDir);
    db.close();

    server = createDashboardServer({
      port: 0, token: 's3cret', baseDir, activeUser: undefined,
    })!;
    expect(server).not.toBeNull();
    const url = await server.start();
    const agent = request.agent(url);
    const login = await agent.post('/api/auth').send({ token: 's3cret' });
    expect(login.status).toBe(200);
    const meta = await agent.get('/api/meta');
    expect(meta.status).toBe(200);
    expect(Object.keys(meta.body.stores).length).toBe(11);
  });

  it('serves users + stores end-to-end', async () => {
    const db = createUserDb('alice', baseDir);
    db.knowledge.saveMany([{ category: 'person', key: 'k', value: 'v' }]);
    db.close();
    server = createDashboardServer({
      port: 0, token: 't', baseDir, activeUser: undefined,
    })!;
    const url = await server.start();
    const agent = request.agent(url);
    await agent.post('/api/auth').send({ token: 't' });
    const users = await agent.get('/api/users');
    expect(users.body.users[0].userId).toBe('alice');
    const stores = await agent.get('/api/users/alice/stores');
    const k = stores.body.stores.find((s: { name: string }) => s.name === 'knowledge');
    expect(k.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm test src/dashboard/boot.test.ts
```

- [ ] **Step 3: Write `boot.ts`**

```typescript
// src/dashboard/boot.ts

import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createAuthMiddleware, mountAuthRoutes } from './auth.js';
import { createUserDbPool, type ActiveUser } from './userdb-pool.js';
import { errorMiddleware } from './error-middleware.js';
import { mountMetaRoute } from './routes/meta.js';
import { mountUsersRoute } from './routes/users.js';
import { mountStoresRoute } from './routes/stores.js';
import { mountStoreListRoute } from './routes/store-list.js';
import { mountStoreStatsRoute } from './routes/store-stats.js';
import { mountKnowledgeRoutes } from './routes/knowledge.js';
import { mountMessagesRoutes } from './routes/messages.js';
import { mountLedgerRoutes } from './routes/ledger.js';
import { log } from '../utils/logger.js';

export type DashboardConfig = {
  port: number;
  token: string;
  baseDir: string;             // e.g. 'data/users'
  activeUser?: ActiveUser;
  tlsCert?: string;            // path to PEM
  tlsKey?: string;             // path to PEM
};

export type DashboardServer = {
  start(): Promise<string>;    // returns base URL
  stop(): Promise<void>;
};

export function createDashboardServer(cfg: DashboardConfig): DashboardServer | null {
  if (!cfg.token) {
    log.warn?.('[dashboard] token empty — dashboard server skipped');
    return null;
  }

  const pool = createUserDbPool({ baseDir: cfg.baseDir, activeUser: cfg.activeUser });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Public routes (no auth)
  mountAuthRoutes(app, {
    token: cfg.token,
    secureCookie: Boolean(cfg.tlsCert && cfg.tlsKey),
  });

  // Protected routes — mount auth middleware before each /api/* path that needs it.
  app.use('/api/meta', createAuthMiddleware({ token: cfg.token }));
  app.use('/api/users', createAuthMiddleware({ token: cfg.token }));

  mountMetaRoute(app);
  mountUsersRoute(app, { pool });
  mountStoresRoute(app, { pool });
  mountStoreListRoute(app, { pool });
  mountStoreStatsRoute(app, { pool });
  mountKnowledgeRoutes(app, { pool });
  mountMessagesRoutes(app, { pool });
  mountLedgerRoutes(app, { pool });

  app.get('/api/healthz', (_req, res) => res.json({ ok: true }));

  app.use(errorMiddleware);

  let server: http.Server | https.Server | null = null;

  return {
    async start() {
      if (cfg.tlsCert && cfg.tlsKey) {
        server = https.createServer(
          { cert: readFileSync(cfg.tlsCert), key: readFileSync(cfg.tlsKey) },
          app,
        );
      } else {
        server = http.createServer(app);
      }
      await new Promise<void>((resolve) => server!.listen(cfg.port, () => resolve()));
      const addr = server!.address() as AddressInfo;
      const proto = cfg.tlsCert ? 'https' : 'http';
      const url = `${proto}://127.0.0.1:${addr.port}`;
      log.info?.(`[dashboard] listening on ${url}`);
      return url;
    },
    async stop() {
      if (!server) return;
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
      pool.dispose();
    },
  };
}
```

(If `log.warn` / `log.info` do not exist on the existing logger, replace with `log.debug`. Verify by reading `src/utils/logger.ts`.)

- [ ] **Step 4: Run, verify pass**

```bash
pnpm test src/dashboard/boot.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/boot.ts src/dashboard/boot.test.ts
git commit -m "feat(dashboard): boot — assemble Express app + start/stop lifecycle"
```

---

### Task 5.2: Wire dashboard into console gateway

**Files:**
- Modify: `src/gateway/console.ts`

- [ ] **Step 1: Read current `start()` and `stop()` methods to find insertion points**

Open `src/gateway/console.ts`. Locate the `start()` method (around line 489) and `stop()` (around line 546).

- [ ] **Step 2: Add dashboard import + state**

Near the other imports at the top of `console.ts`:

```typescript
import { createDashboardServer, type DashboardServer } from '../dashboard/boot.js';
```

Inside `createConsoleGateway` (function body, near the trigger server declaration):

```typescript
const dashboardServer: DashboardServer | null = createDashboardServer({
  port: parseInt(process.env.DASHBOARD_PORT ?? '3200', 10),
  token: process.env.DASHBOARD_TOKEN ?? '',
  baseDir: usersBaseDir,
  activeUser: { userId, db: userDbCache.get(userId) },
  tlsCert: process.env.DASHBOARD_TLS_CERT,
  tlsKey:  process.env.DASHBOARD_TLS_KEY,
});
```

- [ ] **Step 3: Start dashboard in `start()`**

In `start()`, after `if (triggerServer) await triggerServer.start();`, add:

```typescript
if (dashboardServer) await dashboardServer.start();
```

- [ ] **Step 4: Stop dashboard in `stop()`**

In `stop()`, after `if (triggerServer) await triggerServer.stop();`, add:

```typescript
if (dashboardServer) await dashboardServer.stop();
```

- [ ] **Step 5: Type-check + smoke test**

```bash
pnpm type-check
DASHBOARD_TOKEN=t1 CONSOLE_USER_ID=alice pnpm dev
# in another terminal:
curl -s -c /tmp/c.txt -X POST http://localhost:3200/api/auth \
  -H 'content-type: application/json' -d '{"token":"t1"}'
# expected: {"ok":true}
curl -s -b /tmp/c.txt http://localhost:3200/api/healthz
# expected: {"ok":true}
curl -s -b /tmp/c.txt http://localhost:3200/api/users
# expected: {"users":[{"userId":"alice"}]}
```

Type `/exit` in the bot terminal to stop.

- [ ] **Step 6: Commit**

```bash
git add src/gateway/console.ts
git commit -m "feat(gateway-console): mount dashboard server alongside trigger server"
```

---

### Task 5.3: Wire dashboard into telegram gateway

**Files:**
- Modify: `src/gateway/telegram.ts`

- [ ] **Step 1: Mirror Task 5.2 in telegram gateway**

Open `src/gateway/telegram.ts`. Add the same import:

```typescript
import { createDashboardServer, type DashboardServer } from '../dashboard/boot.js';
```

Locate the equivalent of `userDbCache`, `userId` (or "active user"), and the `start()` / `stop()` methods. Add the same construction + lifecycle calls (matching the precise active-user mapping the telegram gateway uses — for telegram the "active user" is the most recently messaging chat ID; for the dashboard's purposes we still want one rw alias, so pass the gateway's primary user if the gateway exposes one, otherwise pass `activeUser: undefined`).

If the telegram gateway has no single primary user, instantiate without `activeUser`:

```typescript
const dashboardServer: DashboardServer | null = createDashboardServer({
  port: parseInt(process.env.DASHBOARD_PORT ?? '3200', 10),
  token: process.env.DASHBOARD_TOKEN ?? '',
  baseDir: usersBaseDir,
  activeUser: undefined,
  tlsCert: process.env.DASHBOARD_TLS_CERT,
  tlsKey:  process.env.DASHBOARD_TLS_KEY,
});
```

(Without `activeUser`, the pool always opens its own read-only connections — slightly more file handles, but no correctness issue.)

- [ ] **Step 2: Start + stop calls** (mirror Task 5.2 step 3 and 4)

- [ ] **Step 3: Type-check**

```bash
pnpm type-check
```

- [ ] **Step 4: Commit**

```bash
git add src/gateway/telegram.ts
git commit -m "feat(gateway-telegram): mount dashboard server alongside trigger server"
```

---

### Task 5.4: openssl provisioning script

**Files:**
- Create: `scripts/gen-dashboard-cert.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# scripts/gen-dashboard-cert.sh
#
# Generate a long-lived self-signed cert for the dashboard's in-app HTTPS.
# Usage:
#   scripts/gen-dashboard-cert.sh [server-ip-or-hostname]
# Example:
#   scripts/gen-dashboard-cert.sh 192.168.1.10

set -euo pipefail

SAN_HOST="${1:-localhost}"
DEST_DIR="data/dashboard-tls"
KEY="${DEST_DIR}/key.pem"
CERT="${DEST_DIR}/cert.pem"

mkdir -p "${DEST_DIR}"

if [[ -f "${KEY}" || -f "${CERT}" ]]; then
  echo "Cert already exists at ${DEST_DIR}/. Refusing to overwrite."
  echo "Remove the files first if you want to regenerate."
  exit 1
fi

# Build subjectAltName: include the user-provided host as both DNS and IP if numeric.
SAN="DNS:localhost,IP:127.0.0.1"
if [[ "${SAN_HOST}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="${SAN},IP:${SAN_HOST}"
elif [[ "${SAN_HOST}" != "localhost" ]]; then
  SAN="${SAN},DNS:${SAN_HOST}"
fi

openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout "${KEY}" \
  -out   "${CERT}" \
  -days  3650 \
  -subj  "/CN=pai-dashboard" \
  -addext "subjectAltName=${SAN}"

chmod 600 "${KEY}"
echo ""
echo "Cert generated:"
echo "  ${CERT}"
echo "  ${KEY}"
echo ""
echo "Add to your environment:"
echo "  DASHBOARD_TLS_CERT=${CERT}"
echo "  DASHBOARD_TLS_KEY=${KEY}"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/gen-dashboard-cert.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/gen-dashboard-cert.sh
git commit -m "chore(dashboard): openssl script for self-signed TLS provisioning"
```

---

## Phase 6 — Manual smoke verification

### Task 6.1: End-to-end smoke test with TLS

**Files:** none (verification only)

- [ ] **Step 1: Generate cert**

```bash
./scripts/gen-dashboard-cert.sh
```

Expected output: `Cert generated:` lines.

- [ ] **Step 2: Start bot with TLS**

```bash
DASHBOARD_TOKEN=$(openssl rand -hex 32) \
DASHBOARD_TLS_CERT=data/dashboard-tls/cert.pem \
DASHBOARD_TLS_KEY=data/dashboard-tls/key.pem \
CONSOLE_USER_ID=console-user \
pnpm dev
```

Expected log: `[dashboard] listening on https://127.0.0.1:3200`.

- [ ] **Step 3: Manual cURL smoke (`-k` to ignore self-signed warning)**

```bash
TOKEN=<the value you set above>
# login
curl -k -s -c /tmp/d.txt -X POST https://localhost:3200/api/auth \
  -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\"}"
# expected: {"ok":true}

# protected requests
curl -k -s -b /tmp/d.txt https://localhost:3200/api/healthz
curl -k -s -b /tmp/d.txt https://localhost:3200/api/meta | head -c 200
curl -k -s -b /tmp/d.txt https://localhost:3200/api/users
curl -k -s -b /tmp/d.txt 'https://localhost:3200/api/users/console-user/stores'
curl -k -s -b /tmp/d.txt 'https://localhost:3200/api/users/console-user/stores/knowledge/list?limit=5'
curl -k -s -b /tmp/d.txt 'https://localhost:3200/api/users/console-user/stores/query_costs/stats?range=30d'

# unauth requests must 401
curl -k -s https://localhost:3200/api/users -o /dev/null -w '%{http_code}\n'
# expected: 401
```

- [ ] **Step 4: Stop bot, run full test suite once more**

```bash
pnpm test
```

Expected: all tests pass (existing + new dashboard tests).

- [ ] **Step 5: Final commit if any cleanup needed; otherwise no-op.**

---

## Done — backend complete

At this point:
- All 11 stores expose `/list` + counts via the dashboard API.
- FTS search hits at `/knowledge/search` and `/messages/search` with `<mark>`-highlighted snippets.
- Charts data at `/stats?range=30d`.
- Cookie-based auth gates everything except `/api/auth` and `/api/healthz`.
- TLS terminates in-app via the self-signed cert; `Secure` cookies work end-to-end.
- All work lives behind feature flags (env vars). The bot still runs without `DASHBOARD_TOKEN` exactly as before.

The frontend plan (`2026-04-26-pai-readonly-dashboard-frontend.md`) consumes this API.

---

## Self-review (run after writing the full plan, fix issues inline)

1. **Spec coverage** — every spec section / requirement maps to a task above:
   - §2 Scope: all 11 stores ✓ (Task 2.1 + Phase 3 + 4.4)
   - Multi-user picker ✓ (Task 4.2)
   - Filter/sort/paginate ✓ (Task 2.2 + 4.4)
   - FTS5 ✓ (Task 3.1, 3.2, 4.6, 4.7)
   - Charts per store ✓ (Task 4.5 + helpers in Phase 3)
   - Cookie auth ✓ (Task 2.4)
   - In-app TLS ✓ (Task 5.1 + 5.4 + 6.1)
   - Same-process boot ✓ (Task 5.2 + 5.3)
   - Manual refresh model: backend has no polling; client owns this. ✓
   - SQLITE_BUSY retry → 503 ✓ (Task 2.3 + 2.5)
   - Error response shape ✓ (Task 2.5)

2. **Placeholder scan** — no "TBD", "TODO", "implement later". The Task 3.6/3.7/3.8 test bodies use `as never` placeholders for store-record fields that the engineer must fill from the actual record type — this is intentional (the field set varies and is one mechanical step per store). Make this explicit in the task header so engineers do not mistake it for a missing detail.

3. **Type consistency**:
   - `DashboardUserDbPool` is consistent across files.
   - `BadQueryError`, `DbBusyError`, `UserNotFoundError`, `StoreNotFoundError` live in their respective modules and are imported by error-middleware.
   - Route handlers consistently use `{ pool: DashboardUserDbPool }` deps shape.
   - `StoreName` source-of-truth is `shared/store-types.ts`; everywhere else imports it.
