# PAI Read-Only Dashboard

**Date:** 2026-04-26
**Branch:** `feat/agnostic-infra-foundation` (target — actual implementation may branch off)
**Status:** Design draft, awaiting user review

---

## 1. Motivation

PAI's user data lives across 11 SQLite stores per user (`profile`, `preferences`, `knowledge`, `journal`, `tasks`, `cronjobs`, `cronjob_executions`, `ledger`, `messages`, `reactions`, `sessions`, `query_costs`). Today the only ways to inspect or audit these are:

- Via the assistant in chat (slow, narrative, easy for the AI to misreport).
- Via raw SQLite CLI (powerful but inconvenient, no FTS UX, no charts).

Three pain points compound:

- **Debug** — when the assistant remembers/forgets something unexpectedly, there is no fast way to see what is actually in the store.
- **Curation** — fixing typos, removing wrong knowledge entries, recategorizing items via chat is slow and error-prone.
- **Bulk inspection** — questions like "all journal entries mentioning X this month" or "ledger spending grouped by stream" cannot be answered ergonomically through chat.

This spec defines a **read-only web dashboard**, mounted in-process with the bot, that exposes filter/search/charts across all 11 stores for a privileged operator (the bot owner). Editing is deliberately out of scope for this iteration to avoid SQLite multi-process write contention and to ship a useful tool sooner.

## 2. Scope

### In scope (MVP)

- **Read-only** views of all 11 per-user stores.
- **Multi-user** picker — operator can select any `userId` present under `data/users/`.
- **Filter / sort / pagination** for every store, configured per-store via a whitelist.
- **FTS5 search** for stores that already have FTS (`knowledge`, `messages`).
- **Charts per store** where useful (token cost trends, message volume, journal counts, ledger aggregates, etc.).
- **Single-token auth** (shared token via env var, validated server-side, exchanged for an `HttpOnly` `Secure` `SameSite=Lax` session cookie).
- **Same-process deployment** — the dashboard's HTTP server is mounted inside the bot process on a separate port (`3200`).
- **Manual refresh** model (no polling, no live push).

### Out of scope (MVP)

- Mutation (create / update / delete) on any store.
- Cross-store navigation by `source_msg_id` (e.g., "click knowledge → see source message"). Future.
- Custom SQL builder for ledger (Q9 L3). Future.
- Telegram-based auth (Q7 D). Future.
- HTTPS / TLS termination in-app. Operator runs a reverse proxy.
- E2E browser tests, performance/load tests.
- Mobile / responsive polish — desktop Chrome is the target.

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Bot Process (single Node)                   │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │  Gateway     │   │  Cron        │   │  Trigger HTTP   │  │
│  │  (telegram   │   │  Scheduler   │   │  (port 3100,    │  │
│  │   /console)  │   │              │   │   existing)     │  │
│  └──────┬───────┘   └──────┬───────┘   └────────┬────────┘  │
│         │                  │                    │            │
│         ▼                  ▼                    ▼            │
│  ┌──────────────────────────────────────────────────────┐    │
│  │                   UserDb pool                        │    │
│  │  active user (rw) + dashboard readers (ro, on-demand)│    │
│  └──────────────────────────────────────────────────────┘    │
│         ▲                                                    │
│         │ read-only                                          │
│  ┌──────┴────────────────────────────────────────────────┐   │
│  │           Dashboard HTTP server (NEW, port 3200)      │   │
│  │  Auth gate + REST API + static SPA                    │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTPS via reverse proxy
                              │
                         User browser
                         (React SPA)
```

**Key choices:**

- **Same process as bot.** The dashboard server is started from `src/index.ts` after `startGateway`. Trade-off: dashboard goes down when bot restarts (acceptable — they ship together).
- **Express** (not Fastify). Familiar, sufficient for the throughput. Express 5 has native async error forwarding, no `express-async-errors` needed.
- **Port `3200`** hardcoded in MVP. May move to `DASHBOARD_PORT` env later.
- **Reverse proxy external.** App serves plain HTTP on `0.0.0.0:3200`. Operator runs an external TLS terminator. Production *requires* HTTPS because the session cookie carries the `Secure` flag. Recommended options: Caddy + Let's Encrypt, Cloudflare Tunnel, or Tailscale Funnel — all handle TLS without app-side changes.
- **Read-only `UserDb` cache.** Bot's active user keeps its rw connection. Other users opened on demand with `readonly: true`, cached with TTL (5 min idle). The active user's rw connection is *reused* — never opened twice.
- **`SQLITE_BUSY` handling.** Even readonly readers can collide with the bot's writes in DELETE journal mode. Wrap each query in a small retry (3 attempts: 50ms / 100ms / 200ms backoff). After exhaustion → 503 `DB_BUSY`.

### 3.1 Boundary table

| Need | Component |
|---|---|
| HTTP framework | Express 5 |
| Static SPA serving | `express.static` from `dist/dashboard/` |
| Per-user DB access | `userdb-pool.ts` (read-only, TTL cache) |
| Filter / sort / pagination from query params | `filter-builder.ts` (whitelist-based) |
| Per-store metadata (columns, filters, charts) | `store-config.ts` |
| FTS5 search | Reuse / extend store API methods (e.g., `knowledge.search`) |
| Aggregations for charts | New methods on store API (e.g., `messages.countByDay`) |
| Frontend state | TanStack Query (server state) + React local state |
| Frontend routing | React Router data router |
| Charts | recharts |
| Styling | Tailwind |

## 4. Components

### 4.1 Backend (`src/dashboard/`)

```
src/dashboard/
├── server.ts              # Express app factory + lifecycle
├── auth.ts                # Bearer-token middleware (constant-time compare)
├── userdb-pool.ts         # Read-only UserDb cache (open on-demand, TTL, retry on busy)
├── routes/
│   ├── auth.ts            #   POST /api/auth         → validate token, set session cookie
│   │                      #   POST /api/auth/logout  → clear session cookie
│   ├── users.ts           #   GET  /api/users        → list userIds from data/users/
│   ├── stores.ts          #   GET  /api/users/:uid/stores
│   │                      #                          → store summary (name, count)
│   ├── store-list.ts      #   GET  /api/users/:uid/stores/:store/list
│   │                      #                          → paginated rows + total
│   ├── store-stats.ts     #   GET  /api/users/:uid/stores/:store/stats?range=30d
│   │                      #                          → chart data
│   ├── knowledge.ts       #   GET  /api/users/:uid/knowledge/search
│   ├── messages.ts        #   GET  /api/users/:uid/messages/search
│   │                      #   GET  /api/users/:uid/messages/thread/:sessionId
│   └── ledger.ts          #   GET  /api/users/:uid/ledger/aggregate?groupBy=stream
├── store-config.ts        # Per-store metadata: columns, filters, sort fields, charts
├── filter-builder.ts      # Whitelist-based WHERE/ORDER/LIMIT builder (parameterized)
└── static.ts              # express.static + SPA index.html fallback
```

**Notes:**

- **`userdb-pool.ts`** holds `Map<userId, { db: UserDb, expiresAt }>`. Opens DB with `new Database(path, { readonly: true, fileMustExist: true })`. The bot's active-user `UserDb` instance is injected at construction and *aliased* in the cache so requests for that user reuse the writable connection (zero file-handle duplication).
- **`store-config.ts`** is the single source of truth for "store name → visible columns, allowed filter keys, allowed sort keys, chart definitions". This config is also exposed to the client via `GET /api/meta` so the SPA renders the generic table from the same definitions.
- **`filter-builder.ts`** does *not* accept raw SQL. Client query params shape: `?filter[category]=person&sort=updated_at:desc&page=2&limit=50`. Builder validates each `filter[...]` key against the store's allow-list before binding as a parameterized clause. This is the primary defense against injection / param tampering.
- **Auth middleware** parses the session cookie (via `cookie-parser`) and constant-time compares its value with `process.env.DASHBOARD_TOKEN`. No `Authorization` header path.

### 4.2 Shared types (`src/dashboard/shared/`)

```
src/dashboard/shared/
├── store-types.ts         # type StoreName = 'profile' | 'knowledge' | ...
├── api-types.ts           # request / response shapes
└── store-meta.ts          # StoreConfig type (column defs, filter defs, chart defs)
```

Imported by both Express handlers and the SPA. Vite is configured to resolve `@shared/*` to this folder.

### 4.3 Frontend (`web/dashboard/`)

```
web/dashboard/
├── index.html
├── vite.config.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx                    # Router root
│   ├── api/
│   │   ├── client.ts              # fetch wrapper (auth header, error normalization)
│   │   ├── stores.ts              # typed API calls per endpoint
│   │   └── react-query.ts         # TanStack Query setup
│   ├── routes/
│   │   ├── login.tsx
│   │   ├── overview.tsx           # User picker + store summary cards
│   │   └── store/
│   │       ├── $store.tsx         # Generic foundation route
│   │       └── store-views/
│   │           ├── KnowledgeView.tsx    # FTS box, category tabs
│   │           ├── LedgerView.tsx       # JSON payload viewer, tag chips
│   │           ├── MessagesView.tsx     # Thread expansion
│   │           ├── TasksView.tsx        # Status badges
│   │           └── ...                  # one per store
│   ├── components/
│   │   ├── StoreTable.tsx         # Generic paginated table (config-driven)
│   │   ├── FilterBar.tsx          # Renders filters from store config
│   │   ├── ChartCard.tsx          # Wrapper for line/bar/heatmap
│   │   ├── UserPicker.tsx         # Top-bar dropdown
│   │   └── Sidebar.tsx            # Grouped store nav
│   ├── lib/
│   │   ├── store-meta.ts          # Re-export from shared, with UI-only adornments
│   │   └── format.ts              # Date/number formatters (Jakarta TZ)
│   └── styles/
│       └── tailwind.css
```

**Frontend behavior:**

- **TanStack Query** caches every API response. "Refresh" button calls `queryClient.invalidateQueries(['store', name])` — manual model from Q8. Default `retry: false` for 4xx; `retry: 1` with 1s delay for 503.
- **Auth from the client side**: login form `POST /api/auth` with `{ token }` in body and `credentials: 'include'`. Server sets `HttpOnly` cookie; the SPA never touches the token after that. All API calls use `credentials: 'include'`; no `Authorization` header. Logout is `POST /api/auth/logout`.
- **`StoreTable`** is config-driven: renders columns from `StoreConfig.columns` (label, accessor, formatter, width). Reused across all 11 stores.
- **Per-store View** files compose `StoreTable` + store-specific affordances (FTS box for `KnowledgeView`, JSON drawer for `LedgerView`, thread expansion for `MessagesView`, status pills for `TasksView`).

### 4.4 Sidebar grouping

```
Memory                  Activity                System
  • profile               • tasks                  • sessions
  • preferences           • cronjobs               • ledger
  • knowledge             • messages               • query_costs
  • journal               • reactions
```

## 5. Data Flow

### 5.1 Boot

```
src/index.ts
  ├─► createUserDb(activeUserId)            # existing
  ├─► startGateway(...)                     # existing
  └─► startDashboardServer({                # NEW
        port: 3200,
        token: process.env.DASHBOARD_TOKEN, # may be undefined → log + skip
        activeUserDb,                       # share rw instance
        dataDir: 'data/users',
      })
        ├─► createUserDbPool(activeUserDb, dataDir)
        ├─► express()
        ├─►   .use(authMiddleware)
        ├─►   .use('/api', apiRouter)
        ├─►   .use('/', staticHandler)      # SPA + index.html fallback
        └─►   .listen(3200)
```

If `DASHBOARD_TOKEN` is undefined, the dashboard does not start — log `[dashboard] DASHBOARD_TOKEN not set; dashboard server skipped`. Bot continues normally. This is fail-soft because the dashboard is optional observability, distinct from load-bearing config like `ANTHROPIC_API_KEY`. The fail-fast principle still holds: behavior is **explicit in the log**, never silent.

If port `3200` is already bound, log error and exit — port conflicts are deployment bugs that must surface immediately.

### 5.2 Request lifecycle (example: `GET /api/users/123/knowledge/search?q=mirza&category=person&page=2`)

1. `authMiddleware` verifies `Authorization: Bearer <token>` (constant-time compare). On mismatch → 401 `UNAUTHENTICATED`.
2. Route handler in `routes/knowledge.ts`:
   - Parse + validate query params with Zod. On failure → 400 `INVALID_QUERY` with `details: error.issues`.
   - Acquire `UserDb` from pool. Cache hit returns cached `db`; miss opens read-only and inserts into cache.
   - Call existing `knowledge.search(q, category)` store API. If pagination or snippet support is missing, **extend the store API** — handlers never reach into raw SQLite.
3. Shape response: `{ rows, total, page, snippets }`. Return 200 JSON.

If any store call throws `SQLITE_BUSY`, the pool wrapper retries 3x (50/100/200ms). On exhaustion it throws `DbBusyError`, which the global error middleware translates to 503 `DB_BUSY`.

### 5.3 Charts

Endpoint: `GET /api/users/:uid/stores/:store/stats?range=30d`

- `StoreConfig.charts` is an object keyed by `chartId`, each value is a typed function `(db: UserDb, range: string) => ChartPayload`.
- Example:
  ```
  charts: {
    cost_by_day: (db, range) => db.queryCosts.aggregateByDay(range),
  }
  ```
- Response shape:
  ```
  { charts: { cost_by_day: { type: 'line', xKey: 'day', yKey: 'usd', series: [...] } } }
  ```
- Frontend `<ChartCard chartId="cost_by_day">` reads from this response and renders via recharts.

**Default range**: `30d` for all stores in MVP. Configurable per request.

### 5.4 New store API methods needed

To avoid raw SQL in the dashboard, the following methods are expected to be added to existing stores. The implementation plan will list them concretely; this design only declares the principle:

- Aggregation helpers per store with chart definitions (`countByDay`, `aggregateByStream`, `countByCategory`, etc.).
- Pagination + total-count variants of existing list methods.
- FTS snippet helpers (using SQLite FTS5 `snippet()`) for `knowledge` and `messages`.

If a method does not exist, it is added in the store module, fully tested, before the dashboard handler depends on it.

### 5.5 Dev vs Build

**Dev:**
```
Terminal 1: pnpm dev                    # bot + Express :3200 (API only)
Terminal 2: pnpm --filter dashboard dev # Vite :5173, proxies /api → :3200 (with cookies)
Browser:    http://localhost:5173
```

Vite dev proxy must forward cookies — `server.proxy['/api'] = { target: 'http://localhost:3200', changeOrigin: true, cookieDomainRewrite: 'localhost' }`. Browsers treat `localhost` as a secure context, so `Secure` cookies work in dev without TLS.

**Production build:**
```
1. Vite build  → dist/dashboard/{index.html, assets/...}
2. tsc build   → dist/{...backend...}
3. Boot:       Express serves dist/dashboard/ at /, /api/* on Express
Browser: https://your-domain/  (via reverse proxy → :3200)
```

`pnpm build` at root runs both (Vite + tsc) sequentially.

## 6. Error Handling

### 6.1 Response shape

Every `/api/*` error responds with:

```json
{ "error": { "code": "INVALID_QUERY", "message": "...", "details": { ... } } }
```

### 6.2 Categories

| HTTP | `error.code` | Trigger | UI behavior |
|---|---|---|---|
| 400 | `INVALID_QUERY` | Zod validation fails | Toast + highlight field, no retry |
| 401 | `UNAUTHENTICATED` | Missing / invalid token | Redirect to `/login` |
| 404 | `USER_NOT_FOUND` / `STORE_NOT_FOUND` | Unknown userId or store name | Empty state |
| 503 | `DB_BUSY` | `SQLITE_BUSY` after 3 retries | Yellow banner "Bot is writing — click refresh" |
| 500 | `INTERNAL` | Uncaught exception | Generic toast; full stack logged server-side |

### 6.3 Server

- **Single error middleware** mounted last in `apiRouter`. Maps thrown errors to the shape above.
- **Logger** uses the existing in-memory ring buffer (`/log` command surfaces it). Every `/api/*` request is logged at info level (path, ms, status). May be tuned down later.
- **Express 5 native async** support — handlers may throw or reject; no manual `try/catch` per route.
- **No DB writes attempted** anywhere in the dashboard — defense in depth in addition to readonly mode.

### 6.4 Client

- TanStack Query global `onError`: if `error.code === 'UNAUTHENTICATED'`, clear token + push `/login`.
- Per-query banner / toast as table above.
- 503 retries once after 1s; subsequent failures show banner.

## 7. Testing

### 7.1 Unit (backend, Vitest)

| Target | Cakupan |
|---|---|
| `filter-builder.ts` | Whitelist enforcement, parameterized output, rejection of unknown filter keys, error messages. **Critical** — primary injection defense. |
| `userdb-pool.ts` | Cache hit/miss, TTL eviction, active-user reuse (no double-open), retry on `SQLITE_BUSY` (mocked), `DbBusyError` after retries exhausted. |
| `auth.ts` | Cookie present + valid → next, missing/wrong → 401. Login sets cookie with correct flags (`HttpOnly`, `SameSite=Lax`, `Secure` in prod). Logout clears it. Functional only; timing-attack resistance assumed from `crypto.timingSafeEqual`. |
| `store-config.ts` | Every `StoreName` has a config entry; declared columns exist on the corresponding store API. |

### 7.2 Integration (backend, Vitest + supertest)

Real Express app, real SQLite temp files (no mocks — pattern matches `journal.test.ts`, `tasks.test.ts`).

| Target | Cakupan |
|---|---|
| `routes/store-list.test.ts` | Pagination correctness, total counts, filter whitelist, sort whitelist. |
| `routes/knowledge.test.ts` | FTS hit ranking, category filter, snippet shape. |
| `routes/messages.test.ts` | FTS body search, thread fetch by sessionId. |
| `routes/ledger.test.ts` | Aggregate by stream / by tag, date ranges. |
| `routes/users.test.ts` | Multi-user listing, isolation (user A cannot read user B's data via param swap). |
| `routes/auth.test.ts` | Login with correct token sets cookie + 200; wrong token → 401. Request without cookie → 401. Request with cookie → OK. Logout clears cookie. |

### 7.3 Frontend (Vitest + React Testing Library, minimal)

| Target | Cakupan |
|---|---|
| `StoreTable` | Render rows from config, paginate, sort. |
| `FilterBar` | Render filters from config, emit change events. |
| `api/client` | Token header attached, error response normalized. |

Per-store View files: smoke render only, manual QA covers the rest.

### 7.4 Manual QA checklist

- [ ] Login with token via Chrome desktop.
- [ ] Visit each of 11 stores; click refresh.
- [ ] FTS search on `knowledge` and `messages`; verify snippets / highlights.
- [ ] Switch between two userIds; verify data isolation.
- [ ] Trigger a write from the bot (e.g., save knowledge via Telegram); refresh dashboard; new row appears.
- [ ] Hit `/api/users/...` without token → 401 / redirect to login.
- [ ] Verify charts render for stores that declare them (counts > 0 in the data).

### 7.5 Out of scope for this iteration

- Playwright / E2E browser tests.
- Performance / load tests.
- Deterministic multi-process locking tests (covered functionally by retry + 503).

## 8. Open questions / future work

- **Telegram-based auth (Q7 D)** — login via "send code to bot". Reuses Telegram identity. Eliminates a static token entirely. To revisit after MVP.
- **Cross-store linking by `source_msg_id`** — click a knowledge row to open the source message in the messages view. Natural follow-up once read-only usage shows what the operator clicks most.
- **Power-user query (Q9 L3)** — exposing `ledger.query()` (already gated by `assertSafeSelect`) as a UI for custom `SELECT json_extract(...) FROM ledger ...`. Saved queries / bookmarks.
- **Pagination on wide messages tables** — performance review once `messages` per user gets large; consider keyset pagination if `OFFSET` becomes slow.
- **`DASHBOARD_PORT` env var** — move from hardcoded `3200` once a second deployment needs a different port.
- **Mutation** — the eventual edit dashboard is a separate spec. Switching the bot DB to WAL mode and routing writes through the bot process (option C of Q5) are the two leading approaches; both will be re-evaluated when there is a concrete edit use case driving it.

## 9. Decisions log (from brainstorm)

| ID | Question | Decision |
|---|---|---|
| Q1 | Pain point | Mix: debug + curation + bulk inspection |
| Q2 | Deployment | Server, remote-accessed |
| Q3 | Multi-user | Picker (scan `data/users/`) |
| Q4 | Edit scope | None — read-only (per pivot mid-brainstorm) |
| Q5 | Process | Same process as bot |
| Q6 | UI stack | React + Vite + Tailwind |
| Q7 | Auth | Shared token via env (Telegram-based future) |
| Q8 | Freshness | Manual refresh |
| Q9 | Query depth | L2 — filter / sort / paginate + FTS5 |
| Q10 | Charts | Full per-store |
| Q11 | Store coverage | All 11 |
| §1 | HTTP framework | Express 5 |
| §1 | Port | `3200` hardcoded |
| §1 | TLS | External reverse proxy |
| §2 | Charts library | recharts |
| §2 | State management | TanStack Query + React local |
| §2 | Frontend folder | `web/dashboard/` |
| §3 | SQLITE_BUSY policy | 3 retries (50/100/200ms) → 503 |
| §3 | Default chart range | `30d` |
| §3 | Aggregations | Add methods to store API |
| §4 | Auth transport | `HttpOnly` `Secure` `SameSite=Lax` session cookie (token in env, exchanged at login) |
| §4 | Boot when token missing | Skip dashboard, log warning |
| §4 | Request logging | Log all `/api/*` (info) |
| §5 | Frontend tests | Minimal — `StoreTable`, `FilterBar`, `api/client` only |
| §5 | Test HTTP client | supertest |
