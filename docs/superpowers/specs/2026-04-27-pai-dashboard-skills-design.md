# PAI Dashboard — Skills Sub-System

**Date:** 2026-04-27
**Branch:** `feat/agnostic-infra-foundation` (target — actual implementation may branch off)
**Status:** Design draft, awaiting user review
**Builds on:** [`2026-04-26-pai-readonly-dashboard-design.md`](./2026-04-26-pai-readonly-dashboard-design.md)

---

## 1. Motivation

The dashboard from the previous spec covers all 11 SQLite stores per user. It does not cover **Claude skills** — per-user markdown procedures stored on the filesystem at `<dataDir>/users/<userId>/.claude/skills/<name>/SKILL.md`.

Each user owns their own skills directory (the assistant runs with `cwd` rooted at the user's data dir, so the Claude Agent SDK loads only that user's skills). Today there is no UX to inspect what skills exist for a given user, when they were last modified, or what they contain — the only way to audit is to SSH in and `cat` files.

Three pain points overlap with the SQLite-store pain points:

- **Inspection / audit** — see what skills exist per user, including descriptions and modification times, without SSH.
- **Debug AI behavior** — when the assistant references (or fails to reference) a skill, quickly cross-check the actual file contents to verify what guidance was available to it.
- **Markdown rendering** — viewing raw `SKILL.md` via the shell is ergonomically poor for skills with code blocks, tables, and structured headings.

This spec extends the read-only dashboard with a Skills sub-system that surfaces both **active** (`.claude/skills/`) and **archived** (`.archived-skills/`) skills per user, with a two-pane list + markdown preview UX.

## 2. Scope

### In scope (MVP)

- **Read-only** listing of skills per user, both active and archived scopes (separate sub-routes).
- **Two-pane UI** — list of skills on the left, markdown-rendered preview on the right.
- **Full-text search** — case-insensitive substring across `name + description + body` of all skills in the current scope.
- **Detail endpoint** — return full body for a single skill on click.
- **Skills count card** on the existing overview page.
- **Sidebar grouping** — new "Configuration" group containing `skills (active)` and `skills (archived)`.
- **Multi-user** — works across all `userId`s already enumerated by the dashboard.
- **Same auth, same error envelope, same logging** as existing `/api/*` routes.

### Out of scope (MVP)

- Mutation (create / update / archive / restore) of any skill — same constraint as the parent spec.
- Pagination — skill counts per user are small (tens at most).
- Charts — skills have no useful time-series in MVP.
- Syntax highlighting in code blocks — plain `<pre>` with Tailwind only.
- Cross-linking from skills to other stores (e.g., "messages where the AI cited this skill"). Future.
- Frontmatter editing UX. Future.
- Diff view between archived and active versions of the same skill name. Future.

## 3. Architecture

The Skills sub-system is **parallel to**, not part of, the existing store sub-system. It does not extend `StoreName`, `store-config.ts`, `userdb-pool.ts`, or `filter-builder.ts` — those are SQLite-specific abstractions and forcing skills into them would muddy the boundary. Skills get their own filesystem reader, route file, and frontend view.

```
src/dashboard/
├── skills-reader.ts           # NEW — filesystem reader, parser, in-memory cache
├── routes/
│   └── skills.ts              # NEW — list / detail / count endpoints
└── shared/
    └── skills-types.ts        # NEW — SkillSummary, SkillDetail, SkillScope

web/dashboard/src/
├── routes/skills/
│   └── $scope.tsx             # NEW — /u/:uid/skills/:scope (active|archived)
├── components/
│   └── SkillsView.tsx         # NEW — two-pane list + markdown preview
├── api/
│   └── skills.ts              # NEW — typed API wrappers
└── components/Sidebar.tsx     # MODIFIED — add Configuration group
```

**Key choices:**

- **Filesystem reader, not SQL.** `skills-reader.ts` reads directories with `fs.readdir` + `fs.readFile`. No DB.
- **In-memory cache for listings (frontmatter only).** TTL 10s, keyed by `${userId}:${scope}`. Body is read fresh on each detail click — bodies are small and clicks are infrequent.
- **`react-markdown` + `remark-gfm`** for rendering. New dependencies in `web/dashboard/package.json`. No syntax-highlighting library.
- **Shares auth, error middleware, logging** with existing `/api/*` routes — only the routing path is new.
- **Defense in depth:** the reader exposes no write methods at all. Even if a route handler were buggy, the sub-system has no path to mutate the filesystem.

## 4. Components

### 4.1 `src/dashboard/skills-reader.ts`

Single source of truth for filesystem access. Public surface:

```ts
type SkillScope = 'active' | 'archived';

type SkillSummary = {
  name: string;
  description: string;
  created_at: string;     // ISO 8601
  updated_at: string;     // ISO 8601
  body_size: number;      // bytes
  scope: SkillScope;
};

type SkillDetail = SkillSummary & { body: string };

interface SkillsReader {
  list(userId: string, scope: SkillScope): Promise<SkillSummary[]>;
  search(userId: string, scope: SkillScope, q: string): Promise<SkillSummary[]>;
  detail(userId: string, scope: SkillScope, name: string): Promise<SkillDetail>;
  count(userId: string): Promise<{ active: number; archived: number }>;
}
```

**Path resolution:**
- `active` → `<dataDir>/users/<userId>/.claude/skills/`
- `archived` → `<dataDir>/users/<userId>/.archived-skills/`

**Listing flow (`list`):**
1. Resolve directory. If it does not exist → return `[]` (user with no skills yet).
2. `readdir`, filter to entries that are directories AND match `SKILL_NAME_RE` (imported from `src/skills/storage.ts`).
3. For each candidate: read `<dir>/<name>/SKILL.md`. If missing → skip. If frontmatter parse fails → skip with `[skills-reader] warn: malformed frontmatter at <path>`.
4. Build `SkillSummary` (name from folder, the rest from frontmatter; `body_size` = `Buffer.byteLength(body)`).
5. Sort by `updated_at` desc.
6. Cache the array under `${userId}:${scope}` with `readAt = Date.now()`.

**Cache:**
- `Map<string, { entries: SkillSummary[]; readAt: number }>`
- TTL 10s. On lookup: if `Date.now() - readAt < 10000` → return cached entries. Otherwise refresh.
- Cache stores **frontmatter only**. Detail bodies are not cached — re-read on each call.

**Search flow (`search`):**
1. Get cached frontmatter via `list()`.
2. Lowercase `q`.
3. First pass: filter where `name.toLowerCase().includes(q) || description.toLowerCase().includes(q)`. These are returned without re-reading the body.
4. Second pass: for entries that did NOT match in pass 1, read body from disk and check `body.toLowerCase().includes(q)`. Include matches.
5. Concatenate (preserving sort order). No deduplication needed since pass 2 starts from the misses.
6. Return.

**Detail flow (`detail`):**
1. Validate `name` against `SKILL_NAME_RE`. On failure → throw `INVALID_NAME` (400 at route layer).
2. Build path. If file does not exist → throw `SKILL_NOT_FOUND` (404).
3. Read file, parse frontmatter, return `SkillDetail`.

**Count flow (`count`):**
- For each scope, `readdir` + filter directories matching `SKILL_NAME_RE`. Do **not** read `SKILL.md` contents — count is cheap.
- Return `{ active, archived }`.

**Frontmatter parser:**
- The format is fixed (see `src/skills/storage.ts:renderFrontmatter`): `---\n` + four `key: value\n` lines + `---\n`. A ~30-line custom parser is sufficient. No new dependency.
- Tolerant: if any of `name`, `description`, `created_at`, `updated_at` is missing, the entry is skipped with a warning rather than failing the whole listing.

### 4.2 `src/dashboard/routes/skills.ts`

Three endpoints under existing auth middleware:

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/users/:uid/skills?scope=active|archived&q=<string>` | `{ rows: SkillSummary[]; total: number; scope }` |
| `GET` | `/api/users/:uid/skills/:scope/:name` | `SkillDetail` |
| `GET` | `/api/users/:uid/skills/_count` | `{ active: number; archived: number }` |

**Validation (Zod):**
- `:uid` — must exist under `data/users/` (reuse helper from `routes/users.ts`).
- `scope` — enum `'active' | 'archived'`. Default `'active'` when absent on the list endpoint.
- `q` — optional string, max 200 chars.
- `:name` — must match `SKILL_NAME_RE`. Validation failure → 400 `INVALID_QUERY`.

**Errors:**

| HTTP | `error.code` | Trigger |
|---|---|---|
| 400 | `INVALID_QUERY` | Zod validation failure on params/query |
| 404 | `USER_NOT_FOUND` | userId not under `data/users/` |
| 404 | `SKILL_NOT_FOUND` | detail endpoint when file missing |
| 500 | `INTERNAL` | Unexpected fs error |

All errors flow through the existing global error middleware — no new error infrastructure.

**Logging:** infos via existing access-log middleware. No PII in URLs (skill names are kebab-case identifiers).

### 4.3 `src/dashboard/shared/skills-types.ts`

Re-exported types for both backend and frontend:

```ts
export type SkillScope = 'active' | 'archived';
export type SkillSummary = { /* see 4.1 */ };
export type SkillDetail = SkillSummary & { body: string };
export type SkillsListResponse = { rows: SkillSummary[]; total: number; scope: SkillScope };
export type SkillsCountResponse = { active: number; archived: number };
```

Resolved through the existing `@shared/*` Vite alias.

### 4.4 Frontend — `SkillsView.tsx`

Two-pane layout:

```
┌─────────────────────────┬──────────────────────────────────────┐
│ [search box]            │ # writing-skills                     │
│                         │ description: ...                     │
│ ▸ chain-checkin         │ updated 2026-04-25 22:21             │
│   2.1 KB · updated 2d   │ ─────────────────────────────────────│
│ ▸ memory-by-reference   │                                      │
│   1.8 KB · updated 1d   │ <react-markdown + remark-gfm>        │
│ ▸ writing-skills  ◄ sel │                                      │
│   3.4 KB · updated 4d   │                                      │
└─────────────────────────┴──────────────────────────────────────┘
   list pane (~340px)            preview pane (flex-1, scroll)
```

- **List pane (left, ~340px fixed):**
  - Search input at top, debounced 200ms, sends `?q=` when non-empty.
  - Each row: `name` (mono), `description` (1-line truncate), `body_size` (KB) + relative `updated_at` ("2d ago").
  - Selected row gets accent border + highlight background.
- **Preview pane (right, flex-1, scroll):**
  - Header: skill name (h1), description, badges for `created_at` and `updated_at`. If scope is archived, also show an `archived` badge.
  - Body: `react-markdown` + `remark-gfm` renders markdown. Code blocks use plain `<pre>` styled via Tailwind `prose` plugin (already in dashboard) — no syntax highlighter.
- **Empty states:**
  - No skill selected → placeholder text "Pilih skill untuk preview".
  - List empty (no skills in scope) → "User ini belum punya skill di scope `<scope>`" + link to the other scope.
- **Routing & state:** URL carries `?selected=<name>` so refresh / share-link preserve the selection. TanStack Query caches `(uid, scope)` for the list and `(uid, scope, name)` for the detail.

### 4.5 Frontend — `routes/skills/$scope.tsx`

Thin route wrapper:
- Reads `:scope` and `:uid` from React Router params, validates against `'active' | 'archived'`.
- Reads `?selected=` from search params.
- Renders `<SkillsView userId={uid} scope={scope} selectedName={selected} onSelect={...} />`.

### 4.6 Frontend — `components/Sidebar.tsx` (modified)

Add a fourth group at the bottom:

```
Configuration
  • skills (active)      → /u/:uid/skills/active
  • skills (archived)    → /u/:uid/skills/archived
```

The Configuration group is rendered from a small const local to `Sidebar.tsx` — it does **not** flow through `store-config.ts`, since these are not stores.

### 4.7 Frontend — overview card

The existing overview page (`routes/overview.tsx`) gets one additional card:

- Title: "Skills"
- Body: `<active> active · <archived> archived` (calls `/skills/_count`)
- Click → navigates to `/u/:uid/skills/active`

### 4.8 Frontend — API client (`api/skills.ts`)

Three typed wrappers:
```ts
listSkills(uid: string, scope: SkillScope, q?: string): Promise<SkillsListResponse>
getSkill(uid: string, scope: SkillScope, name: string): Promise<SkillDetail>
countSkills(uid: string): Promise<SkillsCountResponse>
```

All use the shared `apiFetch` helper (cookie auth, error normalization).

## 5. Data Flow

### 5.1 List

1. `/u/1121398977/skills/active` → `<SkillsView>` mounts.
2. TanStack Query: `useQuery(['skills', uid, 'active', q], () => listSkills(uid, 'active', q))`.
3. Backend `routes/skills.ts` → `skillsReader.list(uid, 'active')` (or `.search(...)` if `q` is non-empty).
4. Cache hit (10s TTL) → return cached `SkillSummary[]`. Miss → `readdir`, parse, cache, return.
5. Frontend renders list.

### 5.2 Search

1. User types in search box → debounced 200ms.
2. Same query key with new `q` → refetch.
3. Backend pass 1: filter cached frontmatter by `name+description` substring.
4. Backend pass 2: read bodies for the misses, filter by body substring.
5. Concat results, return.

### 5.3 Detail (click row)

1. URL updates to `?selected=writing-skills`. TanStack Query mounts second query.
2. `useQuery(['skill', uid, scope, name], () => getSkill(uid, scope, name))`.
3. Backend reads file fresh from disk (no body cache).
4. Preview pane renders markdown.

### 5.4 Cache invalidation

- Global Refresh button (existing) → `queryClient.invalidateQueries(['skills'])` and `['skill']`.
- Backend cache TTL 10s — bot just wrote a skill, dashboard catches up within 10s on next list fetch (or instantly via Refresh).

## 6. Error Handling

Reuses the existing envelope `{ error: { code, message, details? } }` and global error middleware.

| HTTP | `error.code` | Trigger | UI behavior |
|---|---|---|---|
| 400 | `INVALID_QUERY` | Zod fail on `scope`, `q`, `:name` | Toast |
| 401 | `UNAUTHENTICATED` | Missing/invalid session cookie | Redirect to `/login` (existing global handler) |
| 404 | `USER_NOT_FOUND` | userId not in `data/users/` | Empty state + redirect-back option |
| 404 | `SKILL_NOT_FOUND` | Detail endpoint, file missing | Preview pane: "Skill tidak ditemukan, mungkin baru saja di-archive" |
| 500 | `INTERNAL` | Unexpected fs error | Generic toast; full stack server-side |

Frontmatter parse errors are **silently skipped with a warning log** at the reader layer — they do not propagate. Rationale: the bot may briefly write a file with malformed frontmatter mid-write; the listing should remain useful.

## 7. Testing

### 7.1 Unit (backend, Vitest, real filesystem temp dirs)

| Target | Coverage |
|---|---|
| `skills-reader.test.ts` | Listing returns frontmatter array; cache hit/miss/TTL expiry; missing dir → `[]`; malformed frontmatter → skipped with warning; folders with bad names → skipped; archived dir resolution; sort order; `body_size` correct. |
| `skills-reader.test.ts` (search) | Substring case-insensitive in name; in description; in body (only); empty `q` returns all; `q` longer than any field. |
| `skills-reader.test.ts` (detail) | Returns `SkillDetail`; `SKILL_NOT_FOUND` for missing file; `INVALID_NAME` for non-regex name; parse error throws. |
| `skills-reader.test.ts` (count) | Counts both scopes; missing dirs → 0; ignores non-skill folders. |

### 7.2 Integration (backend, Vitest + supertest)

| Target | Coverage |
|---|---|
| `routes/skills.test.ts` | List with and without `q`; scope param; bad scope → 400; bad name → 400; user not found → 404; detail happy path; detail missing → 404; count endpoint; isolation between two userIds (cannot read user A via param swap). |

### 7.3 Frontend (Vitest + RTL, smoke)

| Target | Coverage |
|---|---|
| `SkillsView.test.tsx` | Renders list rows; click row updates URL `?selected=`; empty state when list empty; no-selection state. |
| `api/skills.test.ts` | Typed response shapes; error normalization. |

### 7.4 Manual QA

- [ ] `/u/1121398977/skills/active` → 3 skills (`chain-checkin`, `memory-by-reference`, `writing-skills`) listed.
- [ ] Click `writing-skills` → markdown rendered with headings, lists, code blocks.
- [ ] Search "frontmatter" → `writing-skills` matches via body substring.
- [ ] Switch to `archived` tab → empty (or shows archived skills if any).
- [ ] Refresh button → list re-fetches.
- [ ] Switch to a different `userId` (e.g. `console-user`) → independent skills shown.
- [ ] Sidebar Configuration group visible; overview card shows count.

### 7.5 Out of scope

- Pagination tests (no pagination).
- Chart tests (no charts).
- Performance / large-skill tests.
- E2E browser tests.

## 8. Open questions / future work

- **Markdown links to other stores** — render `[message #abc123]` style links into deep links to the messages view. Natural extension once cross-store linking arrives in the parent dashboard.
- **Diff view between active and archived versions of the same skill name** — useful when iterating on a skill.
- **Restore from archived** — minor mutation feature, fits a future "skills curation" spec.
- **Skill content size limit / warning** — if skills grow beyond ~100KB, the search-pass-2 cost rises; revisit caching strategy then.
- **Frontmatter schema validation** — currently tolerant; could surface a "X skills have malformed frontmatter" banner.

## 9. Decisions log (from brainstorm)

| ID | Question | Decision |
|---|---|---|
| Q1 | Pain point | Mix: inspection + AI-debug + ergonomic markdown viewing |
| Q2 | Active vs archived | Separate sub-routes, two entries in sidebar |
| Q3 | Sidebar grouping | New "Configuration" group |
| Q4 | List + detail UX | Two-pane list + preview |
| Q5 | Search depth | Full-text including body; case-insensitive substring; no toggle |
| §3 | Architecture | Parallel sub-system, not a `StoreName` |
| §4 | Frontmatter parser | Custom inline (~30 lines), no new backend dep |
| §4 | Markdown lib | `react-markdown` + `remark-gfm`; no syntax highlighter |
| §4 | Cache | 10s TTL on listing only; body always fresh |
| §4 | Pagination | None (small N) |
| §4 | Charts | None |
