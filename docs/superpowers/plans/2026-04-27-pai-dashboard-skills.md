# PAI Dashboard — Skills Sub-System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Skills view to the PAI dashboard. Users browse `.claude/skills/` and `.archived-skills/` per user, search across name/description/body, and preview rendered markdown in a two-pane layout.

**Architecture:** Skills sub-system runs parallel to the existing SQLite store sub-system. New filesystem reader (`skills-reader.ts`) + dedicated route file (`routes/skills.ts`) on the backend. New view component (`SkillsView.tsx`) + sub-route on the frontend. No changes to `userdb-pool`, `store-config`, or `filter-builder`.

**Tech Stack:** TypeScript, Express 5, Zod, Vitest + supertest, React 19, TanStack Query, React Router 7, react-markdown + remark-gfm, Tailwind.

**Spec:** `docs/superpowers/specs/2026-04-27-pai-dashboard-skills-design.md`

---

## File Structure

**Backend (create):**
- `src/dashboard/skills-reader.ts` — filesystem reader, frontmatter parser, in-memory cache, search/list/detail/count
- `src/dashboard/skills-reader.test.ts` — unit tests
- `src/dashboard/routes/skills.ts` — Express route handlers
- `src/dashboard/routes/skills.test.ts` — route integration tests
- `src/dashboard/shared/skills-types.ts` — types shared with frontend

**Backend (modify):**
- `src/dashboard/error-middleware.ts` — add `SkillNotFoundError` mapping
- `src/dashboard/boot.ts` — mount new routes under auth gate

**Frontend (create):**
- `web/dashboard/src/api/skills.ts` — typed API client wrappers
- `web/dashboard/src/components/SkillsView.tsx` — two-pane layout with markdown preview
- `web/dashboard/src/routes/skills/$scope.tsx` — route component for `/u/:uid/skills/:scope`
- `web/dashboard/src/components/SkillsView.test.tsx` — smoke test

**Frontend (modify):**
- `web/dashboard/package.json` — add `react-markdown`, `remark-gfm`
- `web/dashboard/src/App.tsx` — register new route
- `web/dashboard/src/components/Sidebar.tsx` — add Configuration group
- `web/dashboard/src/routes/overview.tsx` — add Skills card

---

## Task 1: Shared types

**Files:**
- Create: `src/dashboard/shared/skills-types.ts`

- [ ] **Step 1: Write the file**

```ts
// src/dashboard/shared/skills-types.ts

export type SkillScope = 'active' | 'archived';

export type SkillSummary = {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  body_size: number;
  scope: SkillScope;
};

export type SkillDetail = SkillSummary & { body: string };

export type SkillsListResponse = {
  rows: SkillSummary[];
  total: number;
  scope: SkillScope;
};

export type SkillsCountResponse = { active: number; archived: number };
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc -b`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/shared/skills-types.ts
git commit -m "feat(dashboard): shared types for skills sub-system"
```

---

## Task 2: Skills reader — listing happy path

**Files:**
- Create: `src/dashboard/skills-reader.ts`
- Create: `src/dashboard/skills-reader.test.ts`

The reader is the only place that touches the filesystem for skills. Tests use `writeSkill()` from `src/skills/storage.ts` to create fixtures so file format always matches the bot's writer.

- [ ] **Step 1: Write the failing test**

```ts
// src/dashboard/skills-reader.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSkill } from '../skills/storage.js';
import { createSkillsReader } from './skills-reader.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'skills-reader-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

describe('SkillsReader.list', () => {
  it('returns empty array when user dir does not exist', async () => {
    const reader = createSkillsReader({ baseDir });
    expect(await reader.list('nobody', 'active')).toEqual([]);
  });

  it('lists active skills with parsed frontmatter', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'foo-skill',
      description: 'foo description', body: '# Foo\nbody here' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'bar-skill',
      description: 'bar description', body: 'bar body' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.list('alice', 'active');

    expect(rows).toHaveLength(2);
    const foo = rows.find((r) => r.name === 'foo-skill')!;
    expect(foo.description).toBe('foo description');
    expect(foo.scope).toBe('active');
    expect(foo.body_size).toBeGreaterThan(0);
    expect(foo.created_at).toMatch(/^\d{4}-/);
    expect(foo.updated_at).toMatch(/^\d{4}-/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/dashboard/skills-reader.test.ts`
Expected: FAIL — module `./skills-reader.js` not found.

- [ ] **Step 3: Implement the minimal reader**

```ts
// src/dashboard/skills-reader.ts

import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_NAME_RE } from '../skills/storage.js';
import type {
  SkillScope, SkillSummary, SkillDetail,
} from './shared/skills-types.js';
import { log } from '../utils/logger.js';

export type SkillsReader = {
  list(userId: string, scope: SkillScope): Promise<SkillSummary[]>;
  search(userId: string, scope: SkillScope, q: string): Promise<SkillSummary[]>;
  detail(userId: string, scope: SkillScope, name: string): Promise<SkillDetail>;
  count(userId: string): Promise<{ active: number; archived: number }>;
};

export class SkillNotFoundError extends Error {
  constructor(public skillName: string) {
    super(`SKILL_NOT_FOUND: ${skillName}`);
    this.name = 'SkillNotFoundError';
  }
}

function scopeDir(baseDir: string, userId: string, scope: SkillScope): string {
  return scope === 'active'
    ? join(baseDir, userId, '.claude', 'skills')
    : join(baseDir, userId, '.archived-skills');
}

type Frontmatter = {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

function parseFrontmatter(text: string): { fm: Frontmatter; body: string } | null {
  // Format produced by src/skills/storage.ts:renderFrontmatter:
  //   ---\nname: ...\ndescription: ...\ncreated_at: ...\nupdated_at: ...\n---\n\n<body>
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const header = text.slice(4, end);
  const body = text.slice(end + 5).replace(/^\n/, '');

  const lines = header.split('\n');
  const map = new Map<string, string>();
  for (const line of lines) {
    const idx = line.indexOf(': ');
    if (idx < 0) return null;
    map.set(line.slice(0, idx), line.slice(idx + 2));
  }
  const name = map.get('name');
  const description = map.get('description');
  const created_at = map.get('created_at');
  const updated_at = map.get('updated_at');
  if (!name || !description || !created_at || !updated_at) return null;
  return { fm: { name, description, created_at, updated_at }, body };
}

export function createSkillsReader(opts: { baseDir: string }): SkillsReader {
  const { baseDir } = opts;

  async function readSkill(
    dir: string, name: string, scope: SkillScope,
  ): Promise<{ summary: SkillSummary; body: string } | null> {
    const path = join(dir, name, 'SKILL.md');
    let text: string;
    try {
      text = await fs.readFile(path, 'utf8');
    } catch { return null; }
    const parsed = parseFrontmatter(text);
    if (!parsed) {
      log.warn(`[skills-reader] malformed frontmatter at ${path}`);
      return null;
    }
    return {
      summary: {
        name,
        description: parsed.fm.description,
        created_at: parsed.fm.created_at,
        updated_at: parsed.fm.updated_at,
        body_size: Buffer.byteLength(parsed.body, 'utf8'),
        scope,
      },
      body: parsed.body,
    };
  }

  async function list(userId: string, scope: SkillScope): Promise<SkillSummary[]> {
    const dir = scopeDir(baseDir, userId, scope);
    if (!existsSync(dir)) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: SkillSummary[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!SKILL_NAME_RE.test(e.name)) continue;
      const got = await readSkill(dir, e.name, scope);
      if (got) out.push(got.summary);
    }
    out.sort((a, b) => {
      if (a.updated_at !== b.updated_at) return b.updated_at.localeCompare(a.updated_at);
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  async function search(): Promise<SkillSummary[]> { throw new Error('not yet'); }
  async function detail(): Promise<SkillDetail> { throw new Error('not yet'); }
  async function count(): Promise<{ active: number; archived: number }> {
    throw new Error('not yet');
  }

  return { list, search, detail, count };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/dashboard/skills-reader.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/skills-reader.ts src/dashboard/skills-reader.test.ts
git commit -m "feat(dashboard): SkillsReader.list with frontmatter parsing"
```

---

## Task 3: Skills reader — edge cases (malformed, archived, sort)

**Files:**
- Modify: `src/dashboard/skills-reader.test.ts`

- [ ] **Step 1: Add failing tests**

Append to the existing `describe('SkillsReader.list', ...)` block:

```ts
  it('skips folders with malformed frontmatter', async () => {
    const dir = join(baseDir, 'users', 'alice', '.claude', 'skills', 'broken-one');
    await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }));
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(join(dir, 'SKILL.md'), 'no frontmatter here', 'utf8'));
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'good-one',
      description: 'ok', body: 'ok body' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.list('alice', 'active');
    expect(rows.map((r) => r.name)).toEqual(['good-one']);
  });

  it('skips folders that do not match the skill name regex', async () => {
    const fs = await import('node:fs/promises');
    const dir = join(baseDir, 'users', 'alice', '.claude', 'skills', 'BAD_NAME');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'SKILL.md'), 'whatever', 'utf8');
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'good-one',
      description: 'ok', body: 'ok body' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.list('alice', 'active');
    expect(rows.map((r) => r.name)).toEqual(['good-one']);
  });

  it('reads the archived directory when scope is archived', async () => {
    const fs = await import('node:fs/promises');
    const dir = join(baseDir, 'users', 'alice', '.archived-skills', 'old-skill');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'SKILL.md'),
      `---\nname: old-skill\ndescription: archived one\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-02T00:00:00.000Z\n---\n\nbody\n`,
      'utf8');

    const reader = createSkillsReader({ baseDir });
    const active = await reader.list('alice', 'active');
    const archived = await reader.list('alice', 'archived');
    expect(active).toEqual([]);
    expect(archived.map((r) => r.name)).toEqual(['old-skill']);
    expect(archived[0].scope).toBe('archived');
  });

  it('sorts by updated_at desc, name asc as tiebreaker', async () => {
    const fs = await import('node:fs/promises');
    const mk = async (name: string, updated: string) => {
      const d = join(baseDir, 'users', 'alice', '.claude', 'skills', name);
      await fs.mkdir(d, { recursive: true });
      await fs.writeFile(join(d, 'SKILL.md'),
        `---\nname: ${name}\ndescription: x\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: ${updated}\n---\n\n`,
        'utf8');
    };
    await mk('a-skill', '2026-04-01T00:00:00.000Z');
    await mk('b-skill', '2026-04-10T00:00:00.000Z');
    await mk('c-skill', '2026-04-10T00:00:00.000Z');

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.list('alice', 'active');
    expect(rows.map((r) => r.name)).toEqual(['b-skill', 'c-skill', 'a-skill']);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

The reader implementation from Task 2 already covers all four cases (regex filter, parse-error skip, scope dir, sort).

Run: `pnpm vitest run src/dashboard/skills-reader.test.ts`
Expected: PASS — all six tests green.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/skills-reader.test.ts
git commit -m "test(dashboard): SkillsReader.list edge cases"
```

---

## Task 4: Skills reader — caching with TTL

**Files:**
- Modify: `src/dashboard/skills-reader.ts`
- Modify: `src/dashboard/skills-reader.test.ts`

The reader must cache listings per `(userId, scope)` for 10 seconds. After TTL expiry, the next call re-reads.

- [ ] **Step 1: Write the failing test**

Append to `skills-reader.test.ts`:

```ts
describe('SkillsReader cache', () => {
  it('serves listings from cache within TTL', async () => {
    const fs = await import('node:fs/promises');
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'first',
      description: 'one', body: '' });

    const reader = createSkillsReader({ baseDir });
    const before = await reader.list('alice', 'active');
    expect(before).toHaveLength(1);

    // Add a second skill straight to disk (bypassing cache invalidation).
    const d = join(baseDir, 'users', 'alice', '.claude', 'skills', 'second');
    await fs.mkdir(d, { recursive: true });
    await fs.writeFile(join(d, 'SKILL.md'),
      `---\nname: second\ndescription: two\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n---\n\n`,
      'utf8');

    const after = await reader.list('alice', 'active');
    expect(after).toHaveLength(1); // cache returns stale list
  });

  it('refreshes after TTL', async () => {
    vi.useFakeTimers();
    try {
      const fs = await import('node:fs/promises');
      await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'first',
        description: 'one', body: '' });

      const reader = createSkillsReader({ baseDir });
      await reader.list('alice', 'active');

      const d = join(baseDir, 'users', 'alice', '.claude', 'skills', 'second');
      await fs.mkdir(d, { recursive: true });
      await fs.writeFile(join(d, 'SKILL.md'),
        `---\nname: second\ndescription: two\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n---\n\n`,
        'utf8');

      vi.advanceTimersByTime(11_000);
      const after = await reader.list('alice', 'active');
      expect(after).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Add at the top: `import { vi } from 'vitest';` (alongside the existing imports).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/dashboard/skills-reader.test.ts`
Expected: FAIL — first cache test sees `after.length === 2` (no cache yet).

- [ ] **Step 3: Add cache to the reader**

Replace the `list` function in `src/dashboard/skills-reader.ts` and add cache state:

```ts
const TTL_MS = 10_000;

type CacheEntry = { entries: SkillSummary[]; readAt: number };

export function createSkillsReader(opts: { baseDir: string }): SkillsReader {
  const { baseDir } = opts;
  const cache = new Map<string, CacheEntry>();

  async function readSkill(
    dir: string, name: string, scope: SkillScope,
  ): Promise<{ summary: SkillSummary; body: string } | null> {
    // ...unchanged...
  }

  async function listFresh(userId: string, scope: SkillScope): Promise<SkillSummary[]> {
    const dir = scopeDir(baseDir, userId, scope);
    if (!existsSync(dir)) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: SkillSummary[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!SKILL_NAME_RE.test(e.name)) continue;
      const got = await readSkill(dir, e.name, scope);
      if (got) out.push(got.summary);
    }
    out.sort((a, b) => {
      if (a.updated_at !== b.updated_at) return b.updated_at.localeCompare(a.updated_at);
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  async function list(userId: string, scope: SkillScope): Promise<SkillSummary[]> {
    const key = `${userId}:${scope}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.readAt < TTL_MS) return cached.entries;
    const entries = await listFresh(userId, scope);
    cache.set(key, { entries, readAt: Date.now() });
    return entries;
  }

  // ...rest unchanged...
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/dashboard/skills-reader.test.ts`
Expected: PASS — all eight tests green.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/skills-reader.ts src/dashboard/skills-reader.test.ts
git commit -m "feat(dashboard): SkillsReader 10s TTL cache for listings"
```

---

## Task 5: Skills reader — search

**Files:**
- Modify: `src/dashboard/skills-reader.ts`
- Modify: `src/dashboard/skills-reader.test.ts`

Two-pass search: pass 1 matches name+description from cached frontmatter; pass 2 reads bodies for the misses and matches body. Order preserved.

- [ ] **Step 1: Write the failing tests**

Append to `skills-reader.test.ts`:

```ts
describe('SkillsReader.search', () => {
  it('matches name substring case-insensitively', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'expense-tracker',
      description: 'log expenses', body: 'irrelevant' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'mood-log',
      description: 'log moods', body: 'irrelevant' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.search('alice', 'active', 'EXPENSE');
    expect(rows.map((r) => r.name)).toEqual(['expense-tracker']);
  });

  it('matches description substring case-insensitively', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'a-one',
      description: 'tracks moods over time', body: 'body' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'b-one',
      description: 'unrelated', body: 'body' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.search('alice', 'active', 'moods');
    expect(rows.map((r) => r.name)).toEqual(['a-one']);
  });

  it('matches body substring when name+description do not match', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'one',
      description: 'short', body: 'mentions kebab-case in detail' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'two',
      description: 'short', body: 'unrelated' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.search('alice', 'active', 'kebab-case');
    expect(rows.map((r) => r.name)).toEqual(['one']);
  });

  it('returns all entries when q is empty string', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'one',
      description: 'x', body: '' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'two',
      description: 'y', body: '' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.search('alice', 'active', '');
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/dashboard/skills-reader.test.ts`
Expected: FAIL — `search` throws "not yet".

- [ ] **Step 3: Implement search**

Replace the stub `search` in `src/dashboard/skills-reader.ts`:

```ts
  async function search(
    userId: string, scope: SkillScope, q: string,
  ): Promise<SkillSummary[]> {
    const all = await list(userId, scope);
    if (q === '') return all;
    const needle = q.toLowerCase();

    const dir = scopeDir(baseDir, userId, scope);
    const out: SkillSummary[] = [];
    for (const s of all) {
      if (
        s.name.toLowerCase().includes(needle) ||
        s.description.toLowerCase().includes(needle)
      ) {
        out.push(s);
        continue;
      }
      // Pass 2: read body and check
      try {
        const body = await fs.readFile(join(dir, s.name, 'SKILL.md'), 'utf8');
        if (body.toLowerCase().includes(needle)) out.push(s);
      } catch {
        // skill removed between list and search; skip
      }
    }
    return out;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/dashboard/skills-reader.test.ts`
Expected: PASS — all twelve tests green.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/skills-reader.ts src/dashboard/skills-reader.test.ts
git commit -m "feat(dashboard): SkillsReader.search two-pass substring match"
```

---

## Task 6: Skills reader — detail

**Files:**
- Modify: `src/dashboard/skills-reader.ts`
- Modify: `src/dashboard/skills-reader.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `skills-reader.test.ts`:

```ts
import { SkillNotFoundError } from './skills-reader.js';
// ... add to existing import line

describe('SkillsReader.detail', () => {
  it('returns the full body for a known skill', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'foo-skill',
      description: 'foo desc', body: '# Heading\n\nbody here\n' });

    const reader = createSkillsReader({ baseDir });
    const d = await reader.detail('alice', 'active', 'foo-skill');
    expect(d.name).toBe('foo-skill');
    expect(d.description).toBe('foo desc');
    expect(d.body).toBe('# Heading\n\nbody here\n');
    expect(d.body_size).toBe(Buffer.byteLength(d.body, 'utf8'));
    expect(d.scope).toBe('active');
  });

  it('throws SkillNotFoundError when file is missing', async () => {
    const reader = createSkillsReader({ baseDir });
    await expect(reader.detail('alice', 'active', 'nope'))
      .rejects.toBeInstanceOf(SkillNotFoundError);
  });

  it('throws SkillNotFoundError when name is invalid', async () => {
    const reader = createSkillsReader({ baseDir });
    await expect(reader.detail('alice', 'active', 'BAD_NAME'))
      .rejects.toBeInstanceOf(SkillNotFoundError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/dashboard/skills-reader.test.ts`
Expected: FAIL — `detail` throws "not yet".

- [ ] **Step 3: Implement detail**

Replace the stub `detail` in `src/dashboard/skills-reader.ts`:

```ts
  async function detail(
    userId: string, scope: SkillScope, name: string,
  ): Promise<SkillDetail> {
    if (!SKILL_NAME_RE.test(name)) throw new SkillNotFoundError(name);
    const dir = scopeDir(baseDir, userId, scope);
    const got = await readSkill(dir, name, scope);
    if (!got) throw new SkillNotFoundError(name);
    return { ...got.summary, body: got.body };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/dashboard/skills-reader.test.ts`
Expected: PASS — all fifteen tests green.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/skills-reader.ts src/dashboard/skills-reader.test.ts
git commit -m "feat(dashboard): SkillsReader.detail with SkillNotFoundError"
```

---

## Task 7: Skills reader — count

**Files:**
- Modify: `src/dashboard/skills-reader.ts`
- Modify: `src/dashboard/skills-reader.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `skills-reader.test.ts`:

```ts
describe('SkillsReader.count', () => {
  it('returns zeros when no dirs exist', async () => {
    const reader = createSkillsReader({ baseDir });
    expect(await reader.count('alice')).toEqual({ active: 0, archived: 0 });
  });

  it('counts both scopes, ignoring non-matching folder names', async () => {
    const fs = await import('node:fs/promises');
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'a-one',
      description: 'x', body: '' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'a-two',
      description: 'x', body: '' });
    await fs.mkdir(join(baseDir, 'users', 'alice', '.claude', 'skills', 'BAD'),
      { recursive: true });

    const arch = join(baseDir, 'users', 'alice', '.archived-skills', 'old-one');
    await fs.mkdir(arch, { recursive: true });
    await fs.writeFile(join(arch, 'SKILL.md'),
      `---\nname: old-one\ndescription: x\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n---\n\n`,
      'utf8');

    const reader = createSkillsReader({ baseDir });
    expect(await reader.count('alice')).toEqual({ active: 2, archived: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/dashboard/skills-reader.test.ts`
Expected: FAIL — `count` throws "not yet".

- [ ] **Step 3: Implement count**

Replace the stub `count` in `src/dashboard/skills-reader.ts`:

```ts
  async function countDir(dir: string): Promise<number> {
    if (!existsSync(dir)) return 0;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let n = 0;
    for (const e of entries) {
      if (e.isDirectory() && SKILL_NAME_RE.test(e.name)) n++;
    }
    return n;
  }

  async function count(userId: string): Promise<{ active: number; archived: number }> {
    const [active, archived] = await Promise.all([
      countDir(scopeDir(baseDir, userId, 'active')),
      countDir(scopeDir(baseDir, userId, 'archived')),
    ]);
    return { active, archived };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/dashboard/skills-reader.test.ts`
Expected: PASS — all seventeen tests green.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/skills-reader.ts src/dashboard/skills-reader.test.ts
git commit -m "feat(dashboard): SkillsReader.count cheap scope counts"
```

---

## Task 8: Wire SkillNotFoundError into error middleware

**Files:**
- Modify: `src/dashboard/error-middleware.ts`
- Modify: `src/dashboard/error-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

Open `src/dashboard/error-middleware.test.ts` and append the test below at the end of the file (inside the existing top-level `describe` block if there is one — match the pattern of nearby tests for `BadQueryError`, `UserNotFoundError`, etc.):

```ts
// Add to imports at top of the file (skip lines that already exist):
import express from 'express';
import request from 'supertest';
import { errorMiddleware } from './error-middleware.js';
import { SkillNotFoundError } from './skills-reader.js';

it('maps SkillNotFoundError to 404 SKILL_NOT_FOUND', async () => {
  const app = express();
  app.get('/throw', (_req, _res, next) => next(new SkillNotFoundError('foo')));
  app.use(errorMiddleware);
  const r = await request(app).get('/throw');
  expect(r.status).toBe(404);
  expect(r.body.error.code).toBe('SKILL_NOT_FOUND');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/dashboard/error-middleware.test.ts`
Expected: FAIL — error mapped to 500 INTERNAL.

- [ ] **Step 3: Add the mapping**

Modify `src/dashboard/error-middleware.ts`. After the existing `StoreNotFoundError` block, add:

```ts
import { SkillNotFoundError } from './skills-reader.js';

// ...inside errorMiddleware, after the StoreNotFoundError block:
  if (err instanceof SkillNotFoundError) {
    res.status(404).json({
      error: { code: 'SKILL_NOT_FOUND', message: err.message },
    });
    return;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/dashboard/error-middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/error-middleware.ts src/dashboard/error-middleware.test.ts
git commit -m "feat(dashboard): map SkillNotFoundError to 404"
```

---

## Task 9: Skills route — list endpoint

**Files:**
- Create: `src/dashboard/routes/skills.ts`
- Create: `src/dashboard/routes/skills.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/dashboard/routes/skills.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { writeSkill } from '../../skills/storage.js';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { createSkillsReader } from '../skills-reader.js';
import { mountSkillsRoutes } from './skills.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'skills-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeUser(uid: string) {
  const db = createUserDb(uid, baseDir);
  db.close();
}

function makeApp() {
  const pool = createUserDbPool({ baseDir });
  const reader = createSkillsReader({ baseDir });
  const app = express();
  mountSkillsRoutes(app, { pool, reader });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users/:uid/skills', () => {
  it('returns 404 when user does not exist', async () => {
    const r = await request(makeApp()).get('/api/users/ghost/skills');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns active skills by default', async () => {
    makeUser('alice');
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'one',
      description: 'first', body: 'body one' });

    const r = await request(makeApp()).get('/api/users/alice/skills');
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('active');
    expect(r.body.total).toBe(1);
    expect(r.body.rows[0].name).toBe('one');
  });

  it('returns archived skills when scope=archived', async () => {
    makeUser('alice');
    const fs = await import('node:fs/promises');
    const dir = join(baseDir, 'users', 'alice', '.archived-skills', 'old');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'SKILL.md'),
      `---\nname: old\ndescription: x\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n---\n\n`,
      'utf8');

    const r = await request(makeApp()).get('/api/users/alice/skills?scope=archived');
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('archived');
    expect(r.body.rows.map((row: { name: string }) => row.name)).toEqual(['old']);
  });

  it('filters by q (substring across name/description/body)', async () => {
    makeUser('alice');
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'one',
      description: 'first', body: 'mentions xyz' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'two',
      description: 'second', body: 'unrelated' });

    const r = await request(makeApp()).get('/api/users/alice/skills?q=xyz');
    expect(r.status).toBe(200);
    expect(r.body.rows.map((row: { name: string }) => row.name)).toEqual(['one']);
  });

  it('rejects bad scope with 400 INVALID_QUERY', async () => {
    makeUser('alice');
    const r = await request(makeApp()).get('/api/users/alice/skills?scope=junk');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_QUERY');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/dashboard/routes/skills.test.ts`
Expected: FAIL — module `./skills.js` not found.

- [ ] **Step 3: Implement the route**

```ts
// src/dashboard/routes/skills.ts

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { DashboardUserDbPool } from '../userdb-pool.js';
import { UserNotFoundError } from '../userdb-pool.js';
import type { SkillsReader } from '../skills-reader.js';

const listQuery = z.object({
  scope: z.enum(['active', 'archived']).default('active'),
  q: z.string().max(200).optional(),
});

function assertUserExists(pool: DashboardUserDbPool, uid: string): void {
  if (!pool.listUserIds().includes(uid)) throw new UserNotFoundError(uid);
}

export function mountSkillsRoutes(
  app: Express,
  deps: { pool: DashboardUserDbPool; reader: SkillsReader },
): void {
  app.get('/api/users/:uid/skills',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.params['uid'] as string;
        assertUserExists(deps.pool, uid);
        const { scope, q } = listQuery.parse(req.query);
        const rows = q && q.length > 0
          ? await deps.reader.search(uid, scope, q)
          : await deps.reader.list(uid, scope);
        res.json({ rows, total: rows.length, scope });
      } catch (err) { next(err); }
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/dashboard/routes/skills.test.ts`
Expected: PASS — all five tests green.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/routes/skills.ts src/dashboard/routes/skills.test.ts
git commit -m "feat(dashboard): GET /api/users/:uid/skills list + search"
```

---

## Task 10: Skills route — detail endpoint

**Files:**
- Modify: `src/dashboard/routes/skills.ts`
- Modify: `src/dashboard/routes/skills.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/dashboard/routes/skills.test.ts`:

```ts
describe('GET /api/users/:uid/skills/:scope/:name', () => {
  it('returns the skill detail', async () => {
    makeUser('alice');
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'foo',
      description: 'foo desc', body: '# Hi\n\nbody\n' });

    const r = await request(makeApp()).get('/api/users/alice/skills/active/foo');
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('foo');
    expect(r.body.description).toBe('foo desc');
    expect(r.body.body).toBe('# Hi\n\nbody\n');
    expect(r.body.scope).toBe('active');
  });

  it('returns 404 SKILL_NOT_FOUND when skill is missing', async () => {
    makeUser('alice');
    const r = await request(makeApp()).get('/api/users/alice/skills/active/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('SKILL_NOT_FOUND');
  });

  it('returns 404 SKILL_NOT_FOUND for invalid skill name', async () => {
    makeUser('alice');
    const r = await request(makeApp()).get('/api/users/alice/skills/active/BAD_NAME');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('SKILL_NOT_FOUND');
  });

  it('returns 400 for invalid scope', async () => {
    makeUser('alice');
    const r = await request(makeApp()).get('/api/users/alice/skills/junk/foo');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_QUERY');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/dashboard/routes/skills.test.ts`
Expected: FAIL — handler missing.

- [ ] **Step 3: Add the detail handler**

Append in `src/dashboard/routes/skills.ts` inside `mountSkillsRoutes`:

```ts
  const scopeSchema = z.enum(['active', 'archived']);

  app.get('/api/users/:uid/skills/:scope/:name',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.params['uid'] as string;
        assertUserExists(deps.pool, uid);
        const scope = scopeSchema.parse(req.params['scope']);
        const name = req.params['name'] as string;
        const detail = await deps.reader.detail(uid, scope, name);
        res.json(detail);
      } catch (err) { next(err); }
    },
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/dashboard/routes/skills.test.ts`
Expected: PASS — all nine tests green.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/routes/skills.ts src/dashboard/routes/skills.test.ts
git commit -m "feat(dashboard): GET /api/users/:uid/skills/:scope/:name detail"
```

---

## Task 11: Skills route — count endpoint

**Files:**
- Modify: `src/dashboard/routes/skills.ts`
- Modify: `src/dashboard/routes/skills.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/dashboard/routes/skills.test.ts`:

```ts
describe('GET /api/users/:uid/skills/_count', () => {
  it('returns zero counts for user with no skills', async () => {
    makeUser('alice');
    const r = await request(makeApp()).get('/api/users/alice/skills/_count');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ active: 0, archived: 0 });
  });

  it('returns counts for both scopes', async () => {
    makeUser('alice');
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'one',
      description: 'x', body: '' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'two',
      description: 'x', body: '' });
    const fs = await import('node:fs/promises');
    const arch = join(baseDir, 'users', 'alice', '.archived-skills', 'old');
    await fs.mkdir(arch, { recursive: true });
    await fs.writeFile(join(arch, 'SKILL.md'),
      `---\nname: old\ndescription: x\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n---\n\n`,
      'utf8');

    const r = await request(makeApp()).get('/api/users/alice/skills/_count');
    expect(r.body).toEqual({ active: 2, archived: 1 });
  });

  it('returns 404 USER_NOT_FOUND for unknown user', async () => {
    const r = await request(makeApp()).get('/api/users/ghost/skills/_count');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('USER_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/dashboard/routes/skills.test.ts`
Expected: FAIL — handler missing.

Note: the path `/skills/_count` MUST be registered **before** `/skills/:scope/:name`, or Express will route `_count` into the detail handler with `:scope = "_count"`. Since Express matches in registration order, place this handler first inside `mountSkillsRoutes`.

- [ ] **Step 3: Add the count handler**

Modify `src/dashboard/routes/skills.ts` so the count handler is registered FIRST inside `mountSkillsRoutes` (before list and detail):

```ts
export function mountSkillsRoutes(
  app: Express,
  deps: { pool: DashboardUserDbPool; reader: SkillsReader },
): void {
  // Registered first — must precede /skills/:scope/:name to avoid being matched as detail.
  app.get('/api/users/:uid/skills/_count',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.params['uid'] as string;
        assertUserExists(deps.pool, uid);
        const counts = await deps.reader.count(uid);
        res.json(counts);
      } catch (err) { next(err); }
    },
  );

  app.get('/api/users/:uid/skills',
    /* existing list handler */
  );

  const scopeSchema = z.enum(['active', 'archived']);

  app.get('/api/users/:uid/skills/:scope/:name',
    /* existing detail handler */
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/dashboard/routes/skills.test.ts`
Expected: PASS — all twelve tests green.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/routes/skills.ts src/dashboard/routes/skills.test.ts
git commit -m "feat(dashboard): GET /api/users/:uid/skills/_count"
```

---

## Task 12: Wire skills routes into boot

**Files:**
- Modify: `src/dashboard/boot.ts`

The new route file mounts under the same auth middleware that gates `/api/users`.

- [ ] **Step 1: Modify boot.ts**

In `src/dashboard/boot.ts`:

Add imports near the other route imports:
```ts
import { mountSkillsRoutes } from './routes/skills.js';
import { createSkillsReader } from './skills-reader.js';
```

Inside `createDashboardServer`, after the existing route mounts (after `mountLedgerRoutes(app, { pool });`), add:
```ts
  const skillsReader = createSkillsReader({ baseDir: cfg.baseDir });
  mountSkillsRoutes(app, { pool, reader: skillsReader });
```

The auth middleware `app.use('/api/users', auth)` already covers `/api/users/:uid/skills/...` — no extra auth wiring needed.

- [ ] **Step 2: Type-check + run all dashboard tests**

Run: `pnpm tsc -b && pnpm vitest run src/dashboard`
Expected: PASS — every test in `src/dashboard/**` green.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/boot.ts
git commit -m "feat(dashboard): mount skills routes alongside store routes"
```

---

## Task 13: Add markdown rendering deps to frontend

**Files:**
- Modify: `web/dashboard/package.json`

- [ ] **Step 1: Install deps**

```bash
cd web/dashboard
pnpm add react-markdown remark-gfm
cd ../..
```

- [ ] **Step 2: Verify package.json updated**

Open `web/dashboard/package.json`. Confirm `dependencies` now has `react-markdown` and `remark-gfm`.

- [ ] **Step 3: Type-check**

Run: `pnpm --filter pai-dashboard type-check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/dashboard/package.json web/dashboard/pnpm-lock.yaml pnpm-lock.yaml
git commit -m "chore(dashboard): add react-markdown + remark-gfm"
```

(If only one of the lockfiles exists, commit the one that changed.)

---

## Task 14: Frontend — typed API client for skills

**Files:**
- Create: `web/dashboard/src/api/skills.ts`

- [ ] **Step 1: Write the file**

```ts
// web/dashboard/src/api/skills.ts

import { apiGet } from './client.js';
import type {
  SkillScope,
  SkillsListResponse,
  SkillsCountResponse,
  SkillDetail,
} from '@shared/skills-types.js';

export const skillsApi = {
  list: (uid: string, scope: SkillScope, q?: string) => {
    const qs = new URLSearchParams({ scope });
    if (q) qs.set('q', q);
    return apiGet<SkillsListResponse>(`/api/users/${uid}/skills?${qs}`);
  },
  detail: (uid: string, scope: SkillScope, name: string) =>
    apiGet<SkillDetail>(`/api/users/${uid}/skills/${scope}/${name}`),
  count: (uid: string) =>
    apiGet<SkillsCountResponse>(`/api/users/${uid}/skills/_count`),
};
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter pai-dashboard type-check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/dashboard/src/api/skills.ts
git commit -m "feat(web-dashboard): typed skills API client"
```

---

## Task 15: Frontend — SkillsView (list pane only)

**Files:**
- Create: `web/dashboard/src/components/SkillsView.tsx`
- Create: `web/dashboard/src/components/SkillsView.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

```tsx
// web/dashboard/src/components/SkillsView.test.tsx

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SkillsView } from './SkillsView.js';

vi.mock('../api/skills.js', () => ({
  skillsApi: {
    list: vi.fn().mockResolvedValue({
      scope: 'active',
      total: 1,
      rows: [{
        name: 'foo-skill', description: 'foo desc', body_size: 100,
        created_at: '2026-04-25T00:00:00.000Z',
        updated_at: '2026-04-26T00:00:00.000Z',
        scope: 'active',
      }],
    }),
    detail: vi.fn(),
  },
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SkillsView', () => {
  it('renders list rows from the API', async () => {
    wrap(<SkillsView userId="alice" scope="active" selected={null} onSelect={() => {}} />);
    expect(await screen.findByText('foo-skill')).toBeInTheDocument();
    expect(screen.getByText('foo desc')).toBeInTheDocument();
  });

  it('shows empty state when list is empty', async () => {
    const { skillsApi } = await import('../api/skills.js');
    (skillsApi.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      scope: 'active', total: 0, rows: [],
    });
    wrap(<SkillsView userId="alice" scope="active" selected={null} onSelect={() => {}} />);
    expect(await screen.findByText(/belum punya skill/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter pai-dashboard test -- --run`
Expected: FAIL — module `./SkillsView.js` not found.

- [ ] **Step 3: Implement SkillsView (list pane only — preview pane is Task 16)**

```tsx
// web/dashboard/src/components/SkillsView.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { skillsApi } from '../api/skills.js';
import type { SkillScope } from '@shared/skills-types.js';

type Props = {
  userId: string;
  scope: SkillScope;
  selected: string | null;
  onSelect: (name: string | null) => void;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (ms < day) return 'today';
  const days = Math.floor(ms / day);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function SkillsView({ userId, scope, selected, onSelect }: Props) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  // Debounce search input by 200ms.
  useDebouncedEffect(() => setDebounced(q), 200, [q]);

  const list = useQuery({
    queryKey: ['skills', userId, scope, debounced],
    queryFn: () => skillsApi.list(userId, scope, debounced || undefined),
  });

  return (
    <div className="flex h-full">
      <div className="w-[340px] border-r flex flex-col">
        <div className="p-2 border-b">
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Cari di name, description, body…"
            className="w-full px-2 py-1 border rounded text-sm"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {list.isLoading && <div className="p-3 text-sm">Loading…</div>}
          {list.data && list.data.rows.length === 0 && (
            <div className="p-3 text-sm text-slate-500">
              User ini belum punya skill di scope <code>{scope}</code>.
            </div>
          )}
          {list.data?.rows.map((row) => (
            <button
              key={row.name}
              onClick={() => onSelect(row.name)}
              className={`block w-full text-left px-3 py-2 border-b hover:bg-slate-50 ${
                selected === row.name ? 'bg-slate-100 border-l-4 border-l-blue-500' : ''
              }`}
            >
              <div className="font-mono text-sm">{row.name}</div>
              <div className="text-xs text-slate-600 truncate">{row.description}</div>
              <div className="text-xs text-slate-400 mt-1">
                {formatBytes(row.body_size)} · updated {formatRelative(row.updated_at)}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {!selected && <div className="text-slate-400">Pilih skill untuk preview.</div>}
        {/* Preview pane implemented in Task 16 */}
      </div>
    </div>
  );
}

import { useEffect } from 'react';
function useDebouncedEffect(fn: () => void, ms: number, deps: unknown[]) {
  useEffect(() => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter pai-dashboard test -- --run`
Expected: PASS — both smoke tests green.

- [ ] **Step 5: Commit**

```bash
git add web/dashboard/src/components/SkillsView.tsx web/dashboard/src/components/SkillsView.test.tsx
git commit -m "feat(web-dashboard): SkillsView list pane with debounced search"
```

---

## Task 16: Frontend — SkillsView preview pane

**Files:**
- Modify: `web/dashboard/src/components/SkillsView.tsx`

- [ ] **Step 1: Implement preview**

In `web/dashboard/src/components/SkillsView.tsx`, replace the placeholder preview block with a full preview component.

Add at the top of the file:
```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
```

Add a sub-component above `SkillsView`:

```tsx
function SkillPreview({ userId, scope, name }: {
  userId: string; scope: SkillScope; name: string;
}) {
  const detail = useQuery({
    queryKey: ['skill', userId, scope, name],
    queryFn: () => skillsApi.detail(userId, scope, name),
  });

  if (detail.isLoading) return <div>Loading…</div>;
  if (detail.isError) return <div className="text-red-600">
    Skill tidak ditemukan, mungkin baru saja di-archive.
  </div>;
  if (!detail.data) return null;

  const d = detail.data;
  return (
    <article>
      <header className="border-b pb-3 mb-4">
        <h1 className="text-2xl font-mono">{d.name}</h1>
        <p className="text-slate-600 mt-1">{d.description}</p>
        <div className="text-xs text-slate-400 mt-2 flex gap-3">
          <span>created {new Date(d.created_at).toLocaleString()}</span>
          <span>updated {new Date(d.updated_at).toLocaleString()}</span>
          {d.scope === 'archived' && (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
              archived
            </span>
          )}
        </div>
      </header>
      <div className="prose prose-slate max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{d.body}</ReactMarkdown>
      </div>
    </article>
  );
}
```

Replace the placeholder preview block in `SkillsView` with:

```tsx
      <div className="flex-1 overflow-y-auto p-6">
        {!selected
          ? <div className="text-slate-400">Pilih skill untuk preview.</div>
          : <SkillPreview userId={userId} scope={scope} name={selected} />}
      </div>
```

- [ ] **Step 2: Verify the existing tests still pass**

Run: `pnpm --filter pai-dashboard test -- --run`
Expected: PASS — list-pane tests still green (preview only mounts when `selected` is set).

- [ ] **Step 3: Type-check**

Run: `pnpm --filter pai-dashboard type-check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/dashboard/src/components/SkillsView.tsx
git commit -m "feat(web-dashboard): SkillsView preview pane with markdown rendering"
```

---

## Task 17: Frontend — Skills route + register in App

**Files:**
- Create: `web/dashboard/src/routes/skills/$scope.tsx`
- Modify: `web/dashboard/src/App.tsx`

- [ ] **Step 1: Create the route component**

```tsx
// web/dashboard/src/routes/skills/$scope.tsx

import { useParams, useSearchParams, Navigate } from 'react-router-dom';
import { SkillsView } from '../../components/SkillsView.js';
import { RefreshButton } from '../../components/RefreshButton.js';
import type { SkillScope } from '@shared/skills-types.js';

export function SkillsRoute() {
  const { uid, scope } = useParams<{ uid: string; scope: string }>();
  const [params, setParams] = useSearchParams();

  if (!uid) return <Navigate to="/" replace />;
  if (scope !== 'active' && scope !== 'archived') {
    return <Navigate to={`/u/${uid}/skills/active`} replace />;
  }

  const selected = params.get('selected');
  const onSelect = (name: string | null) => {
    if (name) params.set('selected', name); else params.delete('selected');
    setParams(params, { replace: true });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <h1 className="text-lg font-semibold">
          Skills — {uid} <span className="text-slate-400">({scope})</span>
        </h1>
        <RefreshButton queryKey={['skills', uid, scope as SkillScope]} />
      </div>
      <div className="flex-1 overflow-hidden">
        <SkillsView
          userId={uid} scope={scope as SkillScope}
          selected={selected} onSelect={onSelect}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route in App.tsx**

In `web/dashboard/src/App.tsx`, add the import:
```tsx
import { SkillsRoute } from './routes/skills/$scope.js';
```

Add a new entry to the children array, after the existing store entry:
```tsx
      { path: '/u/:uid/skills/:scope',        element: <SkillsRoute /> },
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter pai-dashboard type-check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/dashboard/src/routes/skills/$scope.tsx web/dashboard/src/App.tsx
git commit -m "feat(web-dashboard): /u/:uid/skills/:scope route"
```

---

## Task 18: Frontend — Sidebar Configuration group

**Files:**
- Modify: `web/dashboard/src/components/Sidebar.tsx`

- [ ] **Step 1: Add the Configuration group**

In `web/dashboard/src/components/Sidebar.tsx`, after the existing `CATEGORY_ORDER.map(...)` block but before the closing `</aside>`, add:

```tsx
        <div className="mt-4">
          <div className="text-xs uppercase font-semibold text-slate-500 mb-1">
            Configuration
          </div>
          <NavLink to={`/u/${uid}/skills/active`}
            className={({ isActive }) =>
              `block py-1 px-2 rounded ${isActive ? 'bg-slate-300' : 'hover:bg-slate-200'}`}>
            skills (active)
          </NavLink>
          <NavLink to={`/u/${uid}/skills/archived`}
            className={({ isActive }) =>
              `block py-1 px-2 rounded ${isActive ? 'bg-slate-300' : 'hover:bg-slate-200'}`}>
            skills (archived)
          </NavLink>
        </div>
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter pai-dashboard type-check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/dashboard/src/components/Sidebar.tsx
git commit -m "feat(web-dashboard): Configuration group with skills links"
```

---

## Task 19: Frontend — Skills card on overview

**Files:**
- Modify: `web/dashboard/src/routes/overview.tsx`

- [ ] **Step 1: Add the Skills card**

In `web/dashboard/src/routes/overview.tsx`:

Add import:
```tsx
import { skillsApi } from '../api/skills.js';
```

Inside `Overview()`, after the existing `q` query, add:
```tsx
  const skillsCount = useQuery({
    queryKey: ['skills', uid, '_count'],
    queryFn: () => skillsApi.count(uid),
  });
```

Inside the grid (`<div className="grid grid-cols-3 gap-4">`), AFTER the existing `q.data.stores.map(...)` block, add a Skills card:

```tsx
          <Link to={`/u/${uid}/skills/active`}
            className="block bg-slate-50 rounded p-4 border hover:border-slate-400">
            <div className="text-xs uppercase text-slate-500">configuration</div>
            <div className="text-lg font-medium">skills</div>
            <div className="text-3xl mt-2">
              {skillsCount.data
                ? `${skillsCount.data.active} · ${skillsCount.data.archived}`
                : '…'}
            </div>
            <div className="text-xs text-slate-400 mt-1">active · archived</div>
          </Link>
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter pai-dashboard type-check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/dashboard/src/routes/overview.tsx
git commit -m "feat(web-dashboard): skills count card on overview"
```

---

## Task 20: Final verification

**Files:** none — this is a verification task.

- [ ] **Step 1: Run all tests**

Run: `pnpm tsc -b && pnpm vitest run && pnpm --filter pai-dashboard test -- --run`
Expected: all green.

- [ ] **Step 2: Build the SPA**

Run: `pnpm --filter pai-dashboard build`
Expected: `dist/dashboard/` populated, no errors.

- [ ] **Step 3: Manual QA checklist (run dev server, test in browser)**

- [ ] Start the bot with `DASHBOARD_TOKEN` set, login at `/login`.
- [ ] Visit overview → see "skills" card with counts (e.g., `0 · 0` or actual counts).
- [ ] Click skills card → land on `/u/<uid>/skills/active`.
- [ ] If user has skills: list shows them, click row → markdown renders in preview pane, URL gains `?selected=<name>`.
- [ ] Refresh browser → selection preserved via URL.
- [ ] Type a string into search box → list filters after 200ms.
- [ ] Search a body-only term → still finds the matching skill.
- [ ] Switch to `/u/<uid>/skills/archived` via sidebar → independent listing.
- [ ] Click Refresh button → query refetches.
- [ ] Switch user via UserPicker → sidebar links update; lists are user-scoped.

- [ ] **Step 4: No commit needed**

This task only verifies; previous commits stand.

---
