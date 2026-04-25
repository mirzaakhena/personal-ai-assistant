# Phase B: Tasks `triggered_by` + Briefing Surface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add condition-based task triggers (e.g., "kalau ke indomaret"). Tasks gain `trigger_type` (`time` / `event` / `always`) and `trigger_pattern` columns; pending event-tasks surface in the wake-up briefing as `<active_event_tasks>`. AI matches user replies against patterns using behavior in CLAUDE.md (no pre-query hook — infra surfaces state, behavior owns decisions).

**Architecture:** Schema additions are additive (nullable columns) — existing rows default to `trigger_type=NULL` (treated as `'always'`). Briefing renderer adds one new block surface, only when `count > 0`. No new MCP tool — `create_task` / `update_task` gain optional fields. CLAUDE.md template gains a behavior section for new users.

**Tech Stack:** TypeScript, vitest, better-sqlite3, Claude Agent SDK. SQLite `ALTER TABLE ADD COLUMN` for legacy DBs (idempotent via `PRAGMA table_info` check).

**Spec reference:** [`docs/superpowers/specs/2026-04-25-pai-agnostic-infra-foundation-design.md`](../specs/2026-04-25-pai-agnostic-infra-foundation-design.md) §5 (Phase B).

---

## File Structure

**Modify:**
- `src/db/tasks.ts` — add `trigger_type` and `trigger_pattern` to schema, `TaskRecord`, `create()`/`update()`, and a new `listEventTasks()` query method.
- `src/db/tasks.test.ts` — extend with cases for the new columns and `listEventTasks`.
- `src/tools/tasks.ts` — extend `create_task` / `update_task` MCP tools with `trigger_type` (enum) and `trigger_pattern` (string) inputs; surface in `TaskResult`.
- `src/core/types.ts` — add `activeEventTasks: ActiveEventTask[]` to `WakeUpBriefingData`.
- `src/core/wake-up.ts` — fetch event tasks in `buildWakeUpBriefing`; render `<active_event_tasks>` block in `renderWakeUpBriefing`.
- `src/core/wake-up.test.ts` — add cases for the new block (empty, populated, escaping).
- `src/skills/templates.ts` — extend `CLAUDE_MD_TEMPLATE` with an "Event-triggered tasks" guidance section.
- `src/skills/templates.test.ts` — assert the new section is present.

**Not touched:**
- `src/cron/scheduler.ts` — `trigger_type='time'` tasks remain coupled to cronjobs as today (no double-source-of-truth changes in this phase).
- `src/gateway/*` — behavior is surfaced via briefing alone; no wiring change.

---

## Task 1: Schema additions to `tasks` table

**Files:**
- Modify: `src/db/tasks.ts`
- Test: `src/db/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/db/tasks.test.ts` inside the existing `describe('tasks store (v5)', ...)` block (before the closing brace):

```typescript
  it('persists trigger_type and trigger_pattern when provided', () => {
    const s = createTaskStore(db);
    const t = s.create({
      title: 'beli batere, sikat gigi, sabun',
      trigger_type: 'event',
      trigger_pattern: 'kalau ke indomaret',
    });
    expect(t.trigger_type).toBe('event');
    expect(t.trigger_pattern).toBe('kalau ke indomaret');

    const got = s.get(t.id);
    expect(got?.trigger_type).toBe('event');
    expect(got?.trigger_pattern).toBe('kalau ke indomaret');
  });

  it('defaults trigger_type and trigger_pattern to null when omitted', () => {
    const s = createTaskStore(db);
    const t = s.create({ title: 'plain todo' });
    expect(t.trigger_type).toBeNull();
    expect(t.trigger_pattern).toBeNull();
  });

  it('rejects invalid trigger_type', () => {
    const s = createTaskStore(db);
    expect(() =>
      s.create({ title: 'x', trigger_type: 'bogus' as any })
    ).toThrow(/invalid TaskTriggerType/);
  });

  it('legacy DB without trigger columns is auto-migrated on store init', () => {
    db.exec(`DROP TABLE IF EXISTS tasks`);
    db.exec(`
      CREATE TABLE tasks (
        id             TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        notes          TEXT,
        status         TEXT NOT NULL DEFAULT 'pending',
        due_date       TEXT,
        source_msg_id  TEXT,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      )
    `);
    db.prepare(
      `INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`
    ).run('legacy-1', 'pre-existing', Date.now(), Date.now());

    const s = createTaskStore(db);
    const got = s.get('legacy-1');
    expect(got?.title).toBe('pre-existing');
    expect(got?.trigger_type).toBeNull();
    expect(got?.trigger_pattern).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/db/tasks.test.ts -- --run
```

Expected: FAIL on the four new cases — `trigger_type`/`trigger_pattern` not part of the type or schema.

- [ ] **Step 3: Implement schema + types**

Edit `src/db/tasks.ts`. At the top, after the existing `TASK_STATUSES` constant, add:

```typescript
export const TASK_TRIGGER_TYPES = ['time', 'event', 'always'] as const;
export type TaskTriggerType = (typeof TASK_TRIGGER_TYPES)[number];
```

Update `TaskRecord` to include the two new nullable fields:

```typescript
export interface TaskRecord {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  due_date: string | null;
  source_msg_id: string | null;
  trigger_type: TaskTriggerType | null;
  trigger_pattern: string | null;
  created_at: number;
  updated_at: number;
}
```

Update `TaskStore.create` signature to accept the new fields:

```typescript
create(rec: {
  title: string;
  notes?: string;
  due_date?: string;
  source_msg_id?: string;
  trigger_type?: TaskTriggerType;
  trigger_pattern?: string;
}): TaskRecord;
```

(Keep the rest of the `TaskStore` interface unchanged for now — `update` and `listEventTasks` extensions land in Tasks 2 and 3.)

Update the DDL to include the two new columns AND add a one-shot legacy migration helper:

```typescript
const DDL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    due_date        TEXT,
    source_msg_id   TEXT,
    trigger_type    TEXT,
    trigger_pattern TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date) WHERE due_date IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_trigger ON tasks(trigger_type) WHERE trigger_type IS NOT NULL;
`;

function ensureTriggerColumns(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const existing = new Set(cols.map((c) => c.name));
  if (!existing.has('trigger_type')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN trigger_type TEXT`);
  }
  if (!existing.has('trigger_pattern')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN trigger_pattern TEXT`);
  }
}
```

In `createTaskStore`, run the DDL THEN `ensureTriggerColumns` before preparing statements:

```typescript
export function createTaskStore(db: Database.Database): TaskStore {
  db.exec(DDL);
  ensureTriggerColumns(db);

  // ... rest of the function
}
```

Update the `insert` prepared statement and the `create` body to pass through the new fields:

```typescript
const insert = db.prepare<TaskRecord>(`
  INSERT INTO tasks (id, title, notes, status, due_date, source_msg_id,
                     trigger_type, trigger_pattern, created_at, updated_at)
  VALUES (@id, @title, @notes, @status, @due_date, @source_msg_id,
          @trigger_type, @trigger_pattern, @created_at, @updated_at)
`);

function create(rec: {
  title: string; notes?: string; due_date?: string; source_msg_id?: string;
  trigger_type?: TaskTriggerType; trigger_pattern?: string;
}): TaskRecord {
  if (rec.trigger_type && !TASK_TRIGGER_TYPES.includes(rec.trigger_type)) {
    throw new Error(`invalid TaskTriggerType: ${rec.trigger_type}`);
  }
  const now = Date.now();
  const row: TaskRecord = {
    id: randomUUID(),
    title: rec.title,
    notes: rec.notes ?? null,
    status: 'pending',
    due_date: rec.due_date ?? null,
    source_msg_id: rec.source_msg_id ?? null,
    trigger_type: rec.trigger_type ?? null,
    trigger_pattern: rec.trigger_pattern ?? null,
    created_at: now,
    updated_at: now,
  };
  insert.run(row);
  return row;
}
```

The existing `update` function will need its `next` object updated too, BUT that's Task 3's concern. For Task 1, the `update` body should still work (the existing UPDATE statement only sets specific named columns; trigger_type/pattern are preserved as-is via row replacement only if we update the spread). Make this minimal change to the `update` function body to preserve trigger fields when other fields are patched:

```typescript
const next: TaskRecord = {
  ...current,
  status: patch.status ?? current.status,
  title: patch.title ?? current.title,
  notes: patch.notes !== undefined ? patch.notes : current.notes,
  due_date: patch.due_date !== undefined ? patch.due_date : current.due_date,
  // trigger_type / trigger_pattern preserved from current via spread
  updated_at: Date.now(),
};
```

(No change needed to the spread line — `current` already carries the new fields.)

Note the existing UPDATE statement at the end of `update()` does NOT touch `trigger_type` or `trigger_pattern` — that's fine for Task 1 (Task 3 will add support for patching them).

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/db/tasks.test.ts -- --run
```

Expected: PASS — original 6 cases + 4 new = 10 green.

- [ ] **Step 5: Type-check**

```bash
pnpm type-check
```

Expected: clean. If `TaskRecord` shape changes break consumers (`src/tools/tasks.ts`, briefing code), Tasks 2-7 will fix them — keep notes for the consumers but DON'T modify them in Task 1.

If type-check ALREADY fails because consumers reference fields that don't exist or destructure wrongly, that's a real break — investigate and report. Most likely you'll see errors in `src/tools/tasks.ts:20-26` (`sanitize`) — add the two new fields to the sanitized result for now to satisfy the type:

```typescript
function sanitize(r: TaskRecord): TaskResult {
  return {
    id: r.id, title: r.title, notes: r.notes, status: r.status,
    due_date: r.due_date, source_msg_id: r.source_msg_id,
    trigger_type: r.trigger_type, trigger_pattern: r.trigger_pattern,
    created_at: toIsoJakarta(r.created_at),
    updated_at: toIsoJakarta(r.updated_at),
  };
}
```

And `TaskResult`:

```typescript
export interface TaskResult {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  due_date: string | null;
  source_msg_id: string | null;
  trigger_type: TaskTriggerType | null;
  trigger_pattern: string | null;
  created_at: string;
  updated_at: string;
}
```

(Import `TaskTriggerType` from `'../db/tasks.js'` alongside `TaskStatus`.)

This keeps the schema consumer chain valid; Task 4 will expand the MCP tool inputs.

- [ ] **Step 6: Commit**

```bash
git add src/db/tasks.ts src/db/tasks.test.ts src/tools/tasks.ts
git commit -m "feat(tasks): schema + types for trigger_type and trigger_pattern

Additive nullable columns. Idempotent ALTER for legacy DBs via
PRAGMA table_info check. TaskRecord and TaskResult gain the two
fields; create() accepts and validates trigger_type.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `listEventTasks` query method

**Files:**
- Modify: `src/db/tasks.ts`
- Test: `src/db/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/db/tasks.test.ts`:

```typescript
  it('listEventTasks returns only pending tasks with trigger_type=event', () => {
    const s = createTaskStore(db);
    s.create({ title: 'plain', });
    s.create({ title: 'time-trigger', trigger_type: 'time', trigger_pattern: '0 18 * * *' });
    const e1 = s.create({
      title: 'beli batere, sikat gigi, sabun',
      trigger_type: 'event',
      trigger_pattern: 'kalau ke indomaret',
    });
    const e2 = s.create({
      title: 'makan silverqueen',
      trigger_type: 'event',
      trigger_pattern: 'kalau ARC keluar',
    });
    s.update(e2.id, { status: 'done' });

    const events = s.listEventTasks({ cap: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(e1.id);
    expect(events[0].trigger_pattern).toBe('kalau ke indomaret');
  });

  it('listEventTasks honors the cap and orders newest-first', async () => {
    const s = createTaskStore(db);
    for (let i = 0; i < 5; i++) {
      s.create({
        title: `task-${i}`,
        trigger_type: 'event',
        trigger_pattern: `pattern-${i}`,
      });
      // small delay so created_at differs
      await new Promise((r) => setTimeout(r, 2));
    }
    const limited = s.listEventTasks({ cap: 3 });
    expect(limited).toHaveLength(3);
    expect(limited[0].title).toBe('task-4');
    expect(limited[2].title).toBe('task-2');
  });

  it('listEventTasks defaults cap to 20 when unspecified', () => {
    const s = createTaskStore(db);
    for (let i = 0; i < 25; i++) {
      s.create({
        title: `t${i}`,
        trigger_type: 'event',
        trigger_pattern: `p${i}`,
      });
    }
    expect(s.listEventTasks({}).length).toBe(20);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/db/tasks.test.ts -- --run
```

Expected: FAIL — `s.listEventTasks is not a function`.

- [ ] **Step 3: Implement**

Add to the `TaskStore` interface in `src/db/tasks.ts`:

```typescript
export interface TaskStore {
  // ... existing methods ...
  listEventTasks(filter: { cap?: number }): TaskRecord[];
}
```

In `createTaskStore`, prepare the statement and add the method:

```typescript
const selectEvents = db.prepare<{ cap: number }, TaskRecord>(
  `SELECT * FROM tasks
   WHERE status = 'pending' AND trigger_type = 'event'
   ORDER BY created_at DESC
   LIMIT @cap`
);

function listEventTasks(filter: { cap?: number }): TaskRecord[] {
  return selectEvents.all({ cap: filter.cap ?? 20 });
}
```

Add `listEventTasks` to the returned object:

```typescript
return { create, update, listPending, listEventTasks, get, delete: deleteOne };
```

- [ ] **Step 4: Run test**

```bash
pnpm test src/db/tasks.test.ts -- --run
```

Expected: 13 tests PASS (10 from before + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/db/tasks.ts src/db/tasks.test.ts
git commit -m "feat(tasks): add listEventTasks query (pending + trigger_type=event)

Cap defaults to 20, ordered newest-first by created_at.
Briefing renderer (Task 5) will use this surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `update_task` patches `trigger_type` / `trigger_pattern`

**Files:**
- Modify: `src/db/tasks.ts`
- Test: `src/db/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/db/tasks.test.ts`:

```typescript
  it('update can promote a plain task to event-triggered', () => {
    const s = createTaskStore(db);
    const t = s.create({ title: 'cek pintu' });
    const res = s.update(t.id, {
      trigger_type: 'event',
      trigger_pattern: 'kalau keluar rumah',
    });
    expect(res.updated).toBe(true);
    expect(res.task?.trigger_type).toBe('event');
    expect(res.task?.trigger_pattern).toBe('kalau keluar rumah');
    expect(s.get(t.id)?.trigger_type).toBe('event');
  });

  it('update can clear trigger_type and trigger_pattern by passing null', () => {
    const s = createTaskStore(db);
    const t = s.create({
      title: 'x',
      trigger_type: 'event',
      trigger_pattern: 'p',
    });
    const res = s.update(t.id, { trigger_type: null, trigger_pattern: null });
    expect(res.task?.trigger_type).toBeNull();
    expect(res.task?.trigger_pattern).toBeNull();
  });

  it('update rejects invalid trigger_type', () => {
    const s = createTaskStore(db);
    const t = s.create({ title: 'x' });
    expect(() =>
      s.update(t.id, { trigger_type: 'bogus' as any })
    ).toThrow(/invalid TaskTriggerType/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/db/tasks.test.ts -- --run
```

Expected: FAIL — patch shape doesn't include `trigger_type` / `trigger_pattern`.

- [ ] **Step 3: Implement**

In `src/db/tasks.ts`, update the `TaskStore.update` signature:

```typescript
update(id: string, patch: {
  status?: TaskStatus;
  title?: string;
  notes?: string;
  due_date?: string | null;
  trigger_type?: TaskTriggerType | null;
  trigger_pattern?: string | null;
}): { updated: boolean; task?: TaskRecord };
```

In the `update` body, add validation and extend the `next` object + the UPDATE statement:

```typescript
function update(id: string, patch: {
  status?: TaskStatus;
  title?: string;
  notes?: string;
  due_date?: string | null;
  trigger_type?: TaskTriggerType | null;
  trigger_pattern?: string | null;
}): { updated: boolean; task?: TaskRecord } {
  const current = selectById.get({ id });
  if (!current) return { updated: false };
  if (patch.status && !TASK_STATUSES.includes(patch.status)) {
    throw new Error(`invalid TaskStatus: ${patch.status}`);
  }
  if (patch.trigger_type && !TASK_TRIGGER_TYPES.includes(patch.trigger_type)) {
    throw new Error(`invalid TaskTriggerType: ${patch.trigger_type}`);
  }
  const next: TaskRecord = {
    ...current,
    status: patch.status ?? current.status,
    title: patch.title ?? current.title,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    due_date: patch.due_date !== undefined ? patch.due_date : current.due_date,
    trigger_type:
      patch.trigger_type !== undefined ? patch.trigger_type : current.trigger_type,
    trigger_pattern:
      patch.trigger_pattern !== undefined ? patch.trigger_pattern : current.trigger_pattern,
    updated_at: Date.now(),
  };
  db.prepare(`
    UPDATE tasks SET status = @status, title = @title, notes = @notes,
                     due_date = @due_date,
                     trigger_type = @trigger_type, trigger_pattern = @trigger_pattern,
                     updated_at = @updated_at
    WHERE id = @id
  `).run(next);
  return { updated: true, task: next };
}
```

- [ ] **Step 4: Run test**

```bash
pnpm test src/db/tasks.test.ts -- --run
```

Expected: 16 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/tasks.ts src/db/tasks.test.ts
git commit -m "feat(tasks): update can patch trigger_type and trigger_pattern

Pass null to clear; pass a value to set or change. Validation
mirrors create(). Existing patches without these fields preserve
current values via spread.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: MCP tool surface — `create_task` and `update_task`

**Files:**
- Modify: `src/tools/tasks.ts`

- [ ] **Step 1: Update the MCP tool inputs**

In `src/tools/tasks.ts`, import `TASK_TRIGGER_TYPES`:

```typescript
import { TASK_STATUSES, TASK_TRIGGER_TYPES } from '../db/tasks.js';
```

Update `TaskHandlers.createTask` and `updateTask` signatures to accept the new optional fields:

```typescript
export interface TaskHandlers {
  createTask(rec: {
    title: string;
    notes?: string;
    due_date?: string;
    source_msg_id?: string;
    trigger_type?: TaskTriggerType;
    trigger_pattern?: string;
  }): TaskResult;
  updateTask(id: string, patch: {
    status?: TaskStatus;
    title?: string;
    notes?: string;
    due_date?: string | null;
    trigger_type?: TaskTriggerType | null;
    trigger_pattern?: string | null;
  }): { updated: boolean; task?: TaskResult };
  listTasks(filter?: { status?: TaskStatus }): TaskResult[];
  deleteTask(id: string): { deleted: boolean };
}
```

The existing `createTaskHandlers` body needs no change — it already passes-through unknown extra fields via the spread? No, it doesn't — it explicitly destructures. Update `createTaskHandlers`:

```typescript
export function createTaskHandlers(store: TaskStore): TaskHandlers {
  return {
    createTask: (rec) => sanitize(store.create(rec)),
    updateTask: (id, patch) => {
      const res = store.update(id, patch);
      return { updated: res.updated, task: res.task ? sanitize(res.task) : undefined };
    },
    listTasks: (filter) => store.listPending({ status: filter?.status, cap: 500 }).map(sanitize),
    deleteTask: (id) => ({ deleted: store.delete(id) }),
  };
}
```

(`createTask: (rec) => sanitize(store.create(rec))` already passes `rec` through; same for `updateTask`. The strengthened signatures are the change.)

In the MCP tool defs, extend `create_task`'s zod schema with two new optional fields:

```typescript
tool(
  'create_task',
  'Create a new pending task. due_date is YYYY-MM-DD in user timezone. ' +
  'trigger_type=event with a free-text trigger_pattern (e.g. "kalau ke indomaret") ' +
  'makes the task surface in the briefing as an active event-task; the AI matches ' +
  'the pattern against future user messages. trigger_type=time mirrors the cron-driven ' +
  'flow and is rarely needed since cronjob already covers time-based reminders.',
  {
    title: z.string().min(1),
    notes: z.string().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    source_msg_id: z.string().optional(),
    trigger_type: z.enum(TASK_TRIGGER_TYPES).optional(),
    trigger_pattern: z.string().min(1).max(500).optional(),
  },
  async (rec) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(h.createTask(rec)) }],
  })
),
```

And `update_task`:

```typescript
tool(
  'update_task',
  'Update a task — change status, edit fields, or attach/clear an event trigger. ' +
  'Pass trigger_type=null and trigger_pattern=null to clear an existing trigger.',
  {
    id: z.string().min(1),
    status: z.enum(TASK_STATUSES).optional(),
    title: z.string().min(1).optional(),
    notes: z.string().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    trigger_type: z.enum(TASK_TRIGGER_TYPES).nullable().optional(),
    trigger_pattern: z.string().min(1).max(500).nullable().optional(),
  },
  async ({ id, ...patch }) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(h.updateTask(id, patch)) }],
  })
),
```

- [ ] **Step 2: Type-check + tests**

```bash
pnpm type-check && pnpm test -- --run
```

Expected: clean type-check, all tests still green.

- [ ] **Step 3: Commit**

```bash
git add src/tools/tasks.ts
git commit -m "feat(tools): create_task / update_task accept trigger_type and pattern

Tool descriptions explain the briefing surface so the AI uses event
triggers correctly. trigger_pattern bounded to 500 chars.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `WakeUpBriefingData` carries active event tasks

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Extend the briefing data type**

Replace the content of `src/core/types.ts` with:

```typescript
// src/core/types.ts

import type { ProfileKey } from '../db/profile.js';
import type { PreferenceRow } from '../db/preferences.js';
import type { KnowledgeCategory } from '../db/knowledge.js';
import type { MessageRecord } from '../db/message.js';

export interface WakeUpContextHints {
  tasks: number;
  tasks_due_today: number;
  journal_recent_7d: number;
  knowledge_total: number;
  knowledge_by_category: Record<KnowledgeCategory, number>;
}

export interface ActiveEventTask {
  id: string;
  pattern: string;
  title: string;
}

export interface WakeUpBriefingData {
  now: Date;
  timezone: string;
  last_user_msg_gap: string | null;
  profile: Partial<Record<ProfileKey, string>>;
  preferences: PreferenceRow[];
  hints: WakeUpContextHints;
  recentMessages: MessageRecord[];
  activeEventTasks: ActiveEventTask[];
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm type-check
```

Expected: TYPE ERROR — `buildWakeUpBriefing` in `src/core/wake-up.ts` doesn't yet populate `activeEventTasks`. Task 6 fixes this. For Task 5, leave the type breakage — it's load-bearing for Task 6's TDD red phase.

- [ ] **Step 3: Commit (don't worry about the broken type-check for THIS commit only)**

```bash
git add src/core/types.ts
git commit -m "feat(core): add ActiveEventTask + activeEventTasks field to briefing data

Briefing types now carry the surface that <active_event_tasks> renders
(Task 7). Producers populate in Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Yes, this commit lands a temporarily-broken type-check. Tasks 6 & 7 land in immediate succession to repair it. Per the plan's atomicity, this 3-task sequence (5 → 6 → 7) is one logical unit; type-check is verified clean again at end of Task 7.)

---

## Task 6: `buildWakeUpBriefing` fetches active event tasks

**Files:**
- Modify: `src/core/wake-up.ts`

- [ ] **Step 1: Update `buildWakeUpBriefing`**

In `src/core/wake-up.ts`, populate `activeEventTasks` in the returned object:

```typescript
export function buildWakeUpBriefing(opts: {
  userId: string;
  now: Date;
  timezone: string;
  userDb: UserDb;
  recentMessagesCount?: number;
}): WakeUpBriefingData {
  const {
    now, timezone, userDb,
    recentMessagesCount = DEFAULT_RECENT_MESSAGES_COUNT,
  } = opts;

  const profile = getProfile(userDb);
  const preferences = userDb.preferences.list();
  const hints = getContextHintCounts(userDb, now);
  const last_user_msg_gap = computeLastUserMsgGap(userDb, now);
  const recentMessages = userDb.messages.getRecentMessages({
    limit: recentMessagesCount, since: 0,
  });
  const activeEventTasks = userDb.tasks.listEventTasks({ cap: 20 }).map((t) => ({
    id: t.id,
    pattern: t.trigger_pattern ?? '',
    title: t.title,
  }));

  return {
    now, timezone, last_user_msg_gap, profile, preferences, hints,
    recentMessages, activeEventTasks,
  };
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm type-check
```

Expected: still failing on the renderer side (Task 7), but the producer is now correct. If you see type errors in any test file using `buildWakeUpBriefing`'s return value with destructuring that doesn't include `activeEventTasks`, that's fine — destructuring is forgiving.

- [ ] **Step 3: Commit**

```bash
git add src/core/wake-up.ts
git commit -m "feat(wake-up): populate activeEventTasks from tasks store

Top 20 pending tasks where trigger_type='event', mapped to the
ActiveEventTask shape the briefing renderer consumes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `renderWakeUpBriefing` produces `<active_event_tasks>` block

**Files:**
- Modify: `src/core/wake-up.ts`
- Test: `src/core/wake-up.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/core/wake-up.test.ts` inside `describe('renderWakeUpBriefing', ...)` (before the closing brace):

```typescript
  it('omits <active_event_tasks> block when no event tasks exist', () => {
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).not.toContain('<active_event_tasks');
  });

  it('renders <active_event_tasks> block with count and entries when populated', () => {
    db.tasks.create({
      title: 'beli batere, sikat gigi, sabun',
      trigger_type: 'event',
      trigger_pattern: 'kalau ke indomaret',
    });
    db.tasks.create({
      title: 'cek pintu, kran, setrika, kompor',
      trigger_type: 'event',
      trigger_pattern: 'kalau keluar rumah',
    });
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).toContain('<active_event_tasks count="2">');
    expect(out).toContain('pattern="kalau ke indomaret"');
    expect(out).toContain('beli batere, sikat gigi, sabun');
    expect(out).toContain('pattern="kalau keluar rumah"');
    expect(out).toContain('cek pintu, kran, setrika, kompor');
    expect(out).toContain('</active_event_tasks>');
  });

  it('includes a self-documenting comment inside <active_event_tasks>', () => {
    db.tasks.create({
      title: 'x',
      trigger_type: 'event',
      trigger_pattern: 'p',
    });
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).toMatch(/<!--[^>]*trigger condition[^>]*-->/);
  });

  it('escapes XML special characters in pattern and title', () => {
    db.tasks.create({
      title: 'a & b <c>',
      trigger_type: 'event',
      trigger_pattern: 'kalau "x" & y',
    });
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).toContain('a &amp; b &lt;c&gt;');
    expect(out).toContain('pattern="kalau &quot;x&quot; &amp; y"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/core/wake-up.test.ts -- --run
```

Expected: FAIL on the four new cases — `<active_event_tasks>` block not in output.

- [ ] **Step 3: Implement**

In `src/core/wake-up.ts`, append a new block to `renderWakeUpBriefing` AFTER the `<recent_messages>` block and BEFORE the closing `</wake_up_briefing>`. Locate the line `lines.push('</wake_up_briefing>');` and insert above it:

```typescript
  // <active_event_tasks> — pending tasks with trigger_type='event'.
  // Self-documenting: AI watches user message for matches against pattern.
  if (data.activeEventTasks.length > 0) {
    lines.push(`<active_event_tasks count="${data.activeEventTasks.length}">`);
    lines.push(
      `  <!-- If the user signals one of these trigger conditions, act on the matching task. -->`
    );
    for (const t of data.activeEventTasks) {
      lines.push(
        `  <task id="${escapeXml(t.id)}" pattern="${escapeXml(t.pattern)}">${escapeXml(t.title)}</task>`
      );
    }
    lines.push('</active_event_tasks>', '');
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/core/wake-up.test.ts -- --run
```

Expected: all wake-up tests PASS (existing 9 + 4 new = 13).

- [ ] **Step 5: Type-check + full suite**

```bash
pnpm type-check && pnpm test -- --run
```

Expected: clean type-check, full suite green (originally 117 + 4 new wake-up + 6 new tasks store + 0 from tools = 127).

- [ ] **Step 6: Commit**

```bash
git add src/core/wake-up.ts src/core/wake-up.test.ts
git commit -m "feat(wake-up): render <active_event_tasks> block in briefing

Surface for AI to match user replies against pending event-task patterns.
Block is omitted when count=0; includes a self-documenting comment so the
AI sees the matching directive without engine-prompt coupling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `CLAUDE_MD_TEMPLATE` gains event-trigger guidance

**Files:**
- Modify: `src/skills/templates.ts`
- Test: `src/skills/templates.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/skills/templates.test.ts` inside `describe('CLAUDE_MD_TEMPLATE', ...)` (before its closing brace):

```typescript
  it('includes event-trigger guidance for active_event_tasks surface', () => {
    expect(CLAUDE_MD_TEMPLATE).toContain('## Event-Triggered Tasks');
    expect(CLAUDE_MD_TEMPLATE).toContain('active_event_tasks');
    expect(CLAUDE_MD_TEMPLATE).toContain('trigger_pattern');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/skills/templates.test.ts -- --run
```

Expected: FAIL — the section not yet present.

- [ ] **Step 3: Implement**

In `src/skills/templates.ts`, insert before the closing backtick of `CLAUDE_MD_TEMPLATE` (just after the `## Extending Yourself` block):

```typescript
## Event-Triggered Tasks

When the briefing surfaces \`<active_event_tasks>\`, scan each task's
\`pattern\` against the current user message. The pattern is free-text
("kalau ke indomaret", "kalau ARC keluar"). If the user signals the
trigger condition has occurred, act on the matching task immediately —
weave it into your reply naturally, then mark the task done via
\`update_task\` once handled.

Use \`trigger_type='event'\` with a clear \`trigger_pattern\` whenever the
user mentions a condition that's not time-based (e.g. "ingatkan kalau aku
mau X"). For time-based reminders, use a cronjob.
```

- [ ] **Step 4: Run test**

```bash
pnpm test src/skills/templates.test.ts -- --run
```

Expected: PASS — 8 templates tests green.

- [ ] **Step 5: Note for existing users**

Existing users who already have `data/users/<id>/CLAUDE.md` provisioned will NOT pick up this new section — `ensureUserClaudeMd` is idempotent on existence. The briefing's self-documenting comment (Task 7) is the safety net: AI still sees `<active_event_tasks>` with its inline directive even if CLAUDE.md is older. Document this in the soak notes section of the PR.

- [ ] **Step 6: Commit**

```bash
git add src/skills/templates.ts src/skills/templates.test.ts
git commit -m "feat(skills): CLAUDE.md template — event-trigger task guidance

New users get explicit guidance on the <active_event_tasks> surface and
when to use trigger_type=event. Existing users rely on the briefing's
inline comment (Task 7) until they regenerate their CLAUDE.md.

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

Expected: all tests green. New count: ~127 (was 117 after Phase A; +4 wake-up, +6 tasks).

- [ ] **Step 3: Programmatic smoke — briefing output**

Inside the repo root, create a smoke `.mts` file (since `pnpm tsx -e` defaults to CJS outside the project):

```bash
cat > .pai-smoke-b.mts <<'EOF'
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserDb } from './src/db/user-db.js';
import { buildWakeUpBriefing, renderWakeUpBriefing } from './src/core/wake-up.js';

const tmp = mkdtempSync(join(tmpdir(), 'pai-smoke-b-'));
const db = createUserDb('u', tmp);

db.tasks.create({
  title: 'beli batere, sikat gigi, sabun',
  trigger_type: 'event',
  trigger_pattern: 'kalau ke indomaret',
});
db.tasks.create({
  title: 'cek pintu, kran, setrika, kompor',
  trigger_type: 'event',
  trigger_pattern: 'kalau keluar rumah',
});

const data = buildWakeUpBriefing({
  userId: 'u',
  now: new Date(),
  timezone: 'Asia/Jakarta',
  userDb: db,
});
const briefing = renderWakeUpBriefing(data);
console.log(briefing);
db.close();
rmSync(tmp, { recursive: true, force: true });
EOF
pnpm tsx .pai-smoke-b.mts
rm .pai-smoke-b.mts
```

Verify the output contains:
- `<active_event_tasks count="2">`
- `<!-- If the user signals one of these trigger conditions, act on the matching task. -->`
- `pattern="kalau ke indomaret"` and `pattern="kalau keluar rumah"`
- The two task titles

- [ ] **Step 4: No commit needed**

If all checks pass, no commit. If something failed, STOP and report BLOCKED.

---

## Done criteria

- [ ] All tests green (target ~127).
- [ ] `pnpm type-check` clean.
- [ ] `pnpm build` clean.
- [ ] Smoke briefing output shows the `<active_event_tasks>` block correctly.
- [ ] Existing tasks rows (created before this phase) still load via `s.get()` — verified by Task 1's "legacy DB" test.
- [ ] AI behavior confirmed during soak: when user mentions a trigger condition, AI references / acts on the matching event task. (Manual user verification.)

If a regression is observed during soak, rollback path: `git revert` Tasks 5-8 (briefing + CLAUDE.md changes) to remove the surface; the schema additions in Tasks 1-3 are harmless and can stay.
