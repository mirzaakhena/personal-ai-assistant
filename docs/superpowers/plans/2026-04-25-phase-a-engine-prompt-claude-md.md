# Phase A: Engine Prompt Refactor + Per-User CLAUDE.md

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip `CORE_SYSTEM_PROMPT` to protocol invariants only; migrate domain behavior (`<initiative>`, `<memory_discipline>`) to a per-user `CLAUDE.md` auto-loaded by the SDK; migrate the `<skills>` block to a discoverable meta-skill `writing-skills`.

**Architecture:** Four layers with distinct lifetimes — engine systemPrompt (compile-time, ~30 lines, invariants only) → per-user `CLAUDE.md` at `data/users/<id>/CLAUDE.md` (user-edit-time, identity & directives, auto-loaded by SDK from `cwd`) → per-user skills at `data/users/<id>/.claude/skills/*/SKILL.md` (AI-extend-time, situational procedures, including the new `writing-skills` meta-skill) → wake-up briefing (per-query state snapshot, embedded in systemPrompt slot). Engine prompt holds protocol contracts (how messages arrive, how replies leave, the on-wake decision loop); behavior lives in user-controlled layers.

**Tech Stack:** TypeScript, vitest, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Node fs/promises. SDK auto-loads `CLAUDE.md` from `cwd` when `settingSources` includes `'project'` (already configured in `src/ai-engine/options.ts:69`).

**Spec reference:** [`docs/superpowers/specs/2026-04-25-pai-agnostic-infra-foundation-design.md`](../specs/2026-04-25-pai-agnostic-infra-foundation-design.md) §4 (Phase A).

---

## File Structure

**Create:**
- `src/skills/templates.ts` — string constants for the default `CLAUDE.md` and `writing-skills` SKILL body. Single responsibility: hold copy. No logic.
- `src/skills/templates.test.ts` — sanity tests asserting required tokens are present in templates.

**Modify:**
- `src/skills/storage.ts` — add `ensureUserClaudeMd()` and `ensureMetaSkill()` provisioning helpers (idempotent, create-if-missing).
- `src/skills/storage.test.ts` — add tests for the two new helpers.
- `src/core/system-prompt.ts` — replace `CORE_SYSTEM_PROMPT` body with the minimal invariant-only version.
- `src/core/system-prompt.test.ts` — replace assertions to match the new shape (no `<initiative>`, `<memory_discipline>`, `<skills>` tags; bound on length; key invariants present).
- `src/gateway/telegram.ts` — call `ensureUserClaudeMd` and `ensureMetaSkill` alongside the existing `ensureUserSkillDir` in `runQuery` (one site).
- `src/gateway/console.ts` — same as telegram (one site).

**Not touched:**
- `src/core/wake-up.ts` — briefing renderer is unchanged in Phase A. `<active_event_tasks>` is added later in Phase B.
- All MCP tool files (`src/tools/*`) — the migrated behavior content reaches the AI via CLAUDE.md instead of system prompt; tool surfaces are unchanged.

---

## Task 1: Templates module — `CLAUDE.md` default content

**Files:**
- Create: `src/skills/templates.ts`
- Test: `src/skills/templates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/skills/templates.test.ts`:

```typescript
// src/skills/templates.test.ts

import { describe, it, expect } from 'vitest';
import { CLAUDE_MD_TEMPLATE, WRITING_SKILLS_TEMPLATE } from './templates.js';

describe('CLAUDE_MD_TEMPLATE', () => {
  it('declares an Identity section', () => {
    expect(CLAUDE_MD_TEMPLATE).toMatch(/^# Assistant Identity/m);
  });

  it('contains the migrated Initiative guidance', () => {
    expect(CLAUDE_MD_TEMPLATE).toContain('## Initiative');
    expect(CLAUDE_MD_TEMPLATE).toContain('connects dots');
    expect(CLAUDE_MD_TEMPLATE).toContain('heartbeat');
  });

  it('contains the migrated Memory Discipline guidance', () => {
    expect(CLAUDE_MD_TEMPLATE).toContain('## Memory Discipline');
    expect(CLAUDE_MD_TEMPLATE).toContain('SEARCH BEFORE SAVE');
    expect(CLAUDE_MD_TEMPLATE).toContain('BATCH WITH ARRAYS');
    expect(CLAUDE_MD_TEMPLATE).toContain('SAVE SILENTLY');
    expect(CLAUDE_MD_TEMPLATE).toContain('RETRIEVE BEFORE GIVING UP');
  });

  it('points the AI at writing-skills meta when extending', () => {
    expect(CLAUDE_MD_TEMPLATE).toContain('writing-skills');
  });
});

describe('WRITING_SKILLS_TEMPLATE', () => {
  it('describes when to write a skill (not speculatively)', () => {
    expect(WRITING_SKILLS_TEMPLATE).toMatch(/not.*speculatively/i);
  });

  it('documents write_skill input fields', () => {
    expect(WRITING_SKILLS_TEMPLATE).toContain('name');
    expect(WRITING_SKILLS_TEMPLATE).toContain('description');
    expect(WRITING_SKILLS_TEMPLATE).toContain('body');
    expect(WRITING_SKILLS_TEMPLATE).toContain('kebab-case');
  });

  it('warns against overlapping skills and chatty narration', () => {
    expect(WRITING_SKILLS_TEMPLATE).toMatch(/supersedes/i);
    expect(WRITING_SKILLS_TEMPLATE).toMatch(/silently/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/skills/templates.test.ts -- --run
```

Expected: FAIL — `Cannot find module './templates.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/skills/templates.ts`:

```typescript
// src/skills/templates.ts
//
// Default text for per-user CLAUDE.md and the writing-skills meta-skill.
// These are provisioned on first user contact; the user owns their copy
// and may edit freely. Templates only seed the initial state.

export const CLAUDE_MD_TEMPLATE = `# Assistant Identity

You are a personal assistant for the user reached via this chat gateway.
Your role: a warm, proactive manager. Remember what matters, show up at the
right moment, act before being asked.

## Initiative

You are a manager who connects dots, not a reactive chatbot.
After every user message and every tool result, ask:
- What changed — and what else should update because of it?
- Is there a thread (open task, running cronjob, recent journal) this touches?
- Is something the user mentioned earlier due for a follow-up?

If yes, act — don't wait to be re-asked. Concrete triggers:
- User mentions a deadline → create a task, and if it needs a nudge later,
  create a cronjob. Cronjobs are the heartbeat that keeps you active between
  user messages — use them aggressively for follow-ups and check-ins.
- User shares a fact → upsert into profile / preferences / knowledge.
- User frustrated about a recurring issue → propose a concrete next step
  or a tracking mechanism.
- User hits a milestone → celebrate briefly, then check what unblocks next.

Cronjob message discipline: the \`message\` field is a LEAN TRIGGER for
future-you, not a context dump. Write the intent only (e.g. "Send a warm
check-in to the user. Pick a fresh topic."). DO NOT inline a snapshot of
today's topics, recent facts, or user state — that data goes stale between
creation and firing. Future-you will read live context via \`search_messages\`
at execution time.

Avoid: acknowledging without acting ("noted" but nothing saved); generic
empathy when a specific action would help more.

## Memory Discipline

Five stores you actively curate: profile (7 slots, in briefing), preferences
(rule/style, in briefing), knowledge (5 categories, fetched on demand),
journal, tasks. See each tool's description for slots, kinds, and categories.

Plus one passive layer: every user and assistant message is auto-logged.
Read it via \`search_messages\` / \`count_messages\` — treat it as long-term
conversational memory. You don't save messages manually.

1. SEARCH BEFORE SAVE. List/search first; upsert the same (kind, key) or
   (category, key) instead of creating a parallel row.
2. BATCH WITH ARRAYS. Multiple facts in one turn → one call with \`entries: [...]\`.
3. SAVE SILENTLY. Don't announce ("aku simpan ya") unless the user explicitly
   asked to be remembered.
4. RETRIEVE BEFORE GIVING UP. Before "I don't know," try \`search_knowledge\`
   AND \`search_messages\`. The briefing shows only counts — fetch details
   with \`list_*\` when a topic suggests depth.

## Extending Yourself

When you need to write a NEW skill (a persistent procedure for a recurring
situation not covered above), first consult the \`writing-skills\` skill
in your skills directory for the conventions and frontmatter format.
`;

export const WRITING_SKILLS_TEMPLATE = `# Writing Skills

Skills are persistent procedures — markdown files telling you HOW to behave
in a recurring situation. User-specific, invisible to the user in conversation.

## When to write a skill

Write a skill only when a real pattern or explicit request emerges — not
speculatively. For a fact → memory. For a one-off → task. For a scheduled
nudge → cronjob.

## Conventions

Use the \`write_skill\` tool with these inputs:
- \`name\`: kebab-case, 3–60 chars (e.g. \`expense-tracker\`, \`monthly-review\`)
- \`description\`: ≤300 chars, written so future-you knows when to consult it
- \`body\`: a markdown document in English (translate at reply time as needed)

Same name supersedes; never create overlapping skills.
Don't narrate skill-writing to the user — save silently.
`;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/skills/templates.test.ts -- --run
```

Expected: PASS — all 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/skills/templates.ts src/skills/templates.test.ts
git commit -m "feat(skills): add CLAUDE.md and writing-skills templates

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `ensureUserClaudeMd` provisioning helper

**Files:**
- Modify: `src/skills/storage.ts`
- Test: `src/skills/storage.test.ts:159` (append new describe block)

- [ ] **Step 1: Write the failing test**

Append to `src/skills/storage.test.ts`:

```typescript
import {
  writeSkill,
  archiveSkill,
  ensureUserSkillDir,
  ensureUserClaudeMd,
  ensureMetaSkill,
  SKILL_NAME_RE,
} from './storage.js';

describe('ensureUserClaudeMd', () => {
  let dataDir: string;
  const userId = 'u1';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'v4-claude-md-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates CLAUDE.md at the user cwd if missing', async () => {
    await ensureUserClaudeMd({ dataDir, userId });
    const p = join(dataDir, 'users', userId, 'CLAUDE.md');
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, 'utf8');
    expect(content).toContain('# Assistant Identity');
    expect(content).toContain('## Initiative');
    expect(content).toContain('## Memory Discipline');
  });

  it('does NOT overwrite an existing CLAUDE.md (user customization wins)', async () => {
    const p = join(dataDir, 'users', userId, 'CLAUDE.md');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(dataDir, 'users', userId), { recursive: true });
    writeFileSync(p, '# Custom user identity\n\nDo not touch.\n', 'utf8');

    await ensureUserClaudeMd({ dataDir, userId });

    const content = readFileSync(p, 'utf8');
    expect(content).toBe('# Custom user identity\n\nDo not touch.\n');
  });

  it('is idempotent (running twice is a no-op when content already exists)', async () => {
    await ensureUserClaudeMd({ dataDir, userId });
    const p = join(dataDir, 'users', userId, 'CLAUDE.md');
    const first = readFileSync(p, 'utf8');
    await ensureUserClaudeMd({ dataDir, userId });
    const second = readFileSync(p, 'utf8');
    expect(second).toBe(first);
  });
});
```

(Note: `ensureMetaSkill` import is anticipated for Task 3 but added now to avoid two import-line edits.)

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/skills/storage.test.ts -- --run
```

Expected: FAIL — `ensureUserClaudeMd` and `ensureMetaSkill` not exported. (TS errors are fine; vitest will still surface them.)

- [ ] **Step 3: Write minimal implementation**

Edit `src/skills/storage.ts`. Add the import for the template at the top:

```typescript
import { CLAUDE_MD_TEMPLATE, WRITING_SKILLS_TEMPLATE } from './templates.js';
```

Append at the end of the file (after `archiveSkill`):

```typescript
/**
 * Provision per-user CLAUDE.md if it does not exist. Idempotent: never
 * overwrites a user-customized CLAUDE.md. Path:
 *   <dataDir>/users/<userId>/CLAUDE.md
 *
 * The Claude Agent SDK auto-loads this file when `settingSources` includes
 * 'project' and the SDK query's cwd matches this directory (see
 * src/ai-engine/options.ts).
 */
export async function ensureUserClaudeMd(opts: {
  dataDir: string;
  userId: string;
}): Promise<void> {
  const userDir = join(opts.dataDir, 'users', opts.userId);
  const filePath = join(userDir, 'CLAUDE.md');
  if (existsSync(filePath)) return;
  await fs.mkdir(userDir, { recursive: true });
  await fs.writeFile(filePath, CLAUDE_MD_TEMPLATE, 'utf8');
}
```

(Suppress the unused-import warning for `WRITING_SKILLS_TEMPLATE` — it's used in Task 3.)

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/skills/storage.test.ts -- --run
```

Expected: PASS for `ensureUserClaudeMd` describe block. The `ensureMetaSkill` import line will fail until Task 3.

To unblock the test run for now, add a temporary stub at the bottom of `src/skills/storage.ts`:

```typescript
// Temporary stub — real implementation in Task 3.
export async function ensureMetaSkill(_opts: {
  dataDir: string;
  userId: string;
}): Promise<void> {
  void WRITING_SKILLS_TEMPLATE;
  return;
}
```

Re-run: PASS for `ensureUserClaudeMd`; `ensureMetaSkill` not yet tested but importable.

- [ ] **Step 5: Commit**

```bash
git add src/skills/storage.ts src/skills/storage.test.ts
git commit -m "feat(skills): provision per-user CLAUDE.md (ensureUserClaudeMd)

Idempotent: never overwrites user-customized CLAUDE.md. SDK auto-loads
this file from per-user cwd when settingSources includes 'project'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `ensureMetaSkill` — provision the `writing-skills` skill

**Files:**
- Modify: `src/skills/storage.ts`
- Test: `src/skills/storage.test.ts` (append second describe block)

- [ ] **Step 1: Write the failing test**

Append to `src/skills/storage.test.ts`:

```typescript
describe('ensureMetaSkill', () => {
  let dataDir: string;
  const userId = 'u1';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'v4-meta-skill-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates the writing-skills meta-skill at the canonical path', async () => {
    await ensureMetaSkill({ dataDir, userId });
    const p = join(
      dataDir,
      'users',
      userId,
      '.claude',
      'skills',
      'writing-skills',
      'SKILL.md'
    );
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, 'utf8');
    expect(content).toContain('name: writing-skills');
    expect(content).toContain('# Writing Skills');
    expect(content).toMatch(/created_at: /);
    expect(content).toMatch(/updated_at: /);
  });

  it('does NOT overwrite an existing writing-skills/SKILL.md', async () => {
    const dir = join(dataDir, 'users', userId, '.claude', 'skills', 'writing-skills');
    const p = join(dir, 'SKILL.md');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(p, '# user customized writing-skills\n', 'utf8');

    await ensureMetaSkill({ dataDir, userId });

    const content = readFileSync(p, 'utf8');
    expect(content).toBe('# user customized writing-skills\n');
  });

  it('is idempotent', async () => {
    await ensureMetaSkill({ dataDir, userId });
    const p = join(
      dataDir,
      'users',
      userId,
      '.claude',
      'skills',
      'writing-skills',
      'SKILL.md'
    );
    const first = readFileSync(p, 'utf8');
    await ensureMetaSkill({ dataDir, userId });
    const second = readFileSync(p, 'utf8');
    expect(second).toBe(first);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/skills/storage.test.ts -- --run
```

Expected: FAIL — the stub from Task 2 doesn't write any file.

- [ ] **Step 3: Write minimal implementation**

In `src/skills/storage.ts`, replace the temporary stub with the real implementation. The function reuses `writeSkill` to get correct frontmatter rendering, but only when the file does not already exist:

```typescript
/**
 * Provision the writing-skills meta-skill if it does not exist. Idempotent:
 * never overwrites if the user has customized their copy. Provides the AI
 * with on-demand guidance for writing new skills (frontmatter, naming,
 * conventions) — content the engine system prompt no longer carries.
 */
export async function ensureMetaSkill(opts: {
  dataDir: string;
  userId: string;
}): Promise<void> {
  const filePath = join(
    opts.dataDir,
    'users',
    opts.userId,
    '.claude',
    'skills',
    'writing-skills',
    'SKILL.md'
  );
  if (existsSync(filePath)) return;

  await writeSkill({
    dataDir: opts.dataDir,
    userId: opts.userId,
    name: 'writing-skills',
    description:
      'How to write a new skill. Read this before calling write_skill — covers naming, frontmatter, body conventions, and when (not) to write a skill.',
    body: WRITING_SKILLS_TEMPLATE,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/skills/storage.test.ts -- --run
```

Expected: PASS — all describe blocks (`SKILL_NAME_RE`, `writeSkill / archiveSkill / ensureUserSkillDir`, `ensureUserClaudeMd`, `ensureMetaSkill`) green.

- [ ] **Step 5: Commit**

```bash
git add src/skills/storage.ts src/skills/storage.test.ts
git commit -m "feat(skills): provision writing-skills meta-skill (ensureMetaSkill)

Idempotent meta-skill provisioning. Replaces the inline <skills> block
that used to live in CORE_SYSTEM_PROMPT — AI now reads on-demand when
writing new skills.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire provisioning into Telegram gateway

**Files:**
- Modify: `src/gateway/telegram.ts:46` (import) and `src/gateway/telegram.ts:292` (call site)

- [ ] **Step 1: Update the import line**

Find the existing import of `ensureUserSkillDir`:

```typescript
import { ensureUserSkillDir } from '../skills/storage.js';
```

Replace with:

```typescript
import {
  ensureUserSkillDir,
  ensureUserClaudeMd,
  ensureMetaSkill,
} from '../skills/storage.js';
```

- [ ] **Step 2: Add the calls in `runQuery`**

Find this block in `runQuery` (around `src/gateway/telegram.ts:290`):

```typescript
async function runQuery(
  queryUserId: string,
  prompt: string | ContentBlock[]
): Promise<QueryResult> {
  seenUsers.add(queryUserId);

  await ensureUserSkillDir({ dataDir, userId: queryUserId });
```

Replace the last line above with:

```typescript
  await ensureUserSkillDir({ dataDir, userId: queryUserId });
  await ensureUserClaudeMd({ dataDir, userId: queryUserId });
  await ensureMetaSkill({ dataDir, userId: queryUserId });
```

- [ ] **Step 3: Type-check**

```bash
pnpm type-check
```

Expected: clean exit. If there are errors, they are real — fix the import path or argument shape.

- [ ] **Step 4: Run the full test suite**

```bash
pnpm test -- --run
```

Expected: existing tests stay green; no new test for this gateway-integration step (the provisioning helpers are unit-tested in Tasks 2 and 3).

- [ ] **Step 5: Commit**

```bash
git add src/gateway/telegram.ts
git commit -m "feat(telegram): provision per-user CLAUDE.md and writing-skills

Wires ensureUserClaudeMd + ensureMetaSkill into the Telegram gateway's
runQuery, alongside the existing ensureUserSkillDir. First exchange for
any user creates both files (idempotent).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire provisioning into Console gateway

**Files:**
- Modify: `src/gateway/console.ts:32` (import) and `src/gateway/console.ts:162` (call site)

- [ ] **Step 1: Update the import line**

Find:

```typescript
import { ensureUserSkillDir } from '../skills/storage.js';
```

Replace with:

```typescript
import {
  ensureUserSkillDir,
  ensureUserClaudeMd,
  ensureMetaSkill,
} from '../skills/storage.js';
```

- [ ] **Step 2: Add the calls in `runQuery`**

Find this block (around `src/gateway/console.ts:161`):

```typescript
async function runQuery(queryUserId: string, prompt: string | ContentBlock[]): Promise<QueryResult> {
    await ensureUserSkillDir({ dataDir, userId: queryUserId });

    await maybeResetSessionBeforeRun(queryUserId);
```

Insert two new calls after `ensureUserSkillDir`, before the blank line:

```typescript
async function runQuery(queryUserId: string, prompt: string | ContentBlock[]): Promise<QueryResult> {
    await ensureUserSkillDir({ dataDir, userId: queryUserId });
    await ensureUserClaudeMd({ dataDir, userId: queryUserId });
    await ensureMetaSkill({ dataDir, userId: queryUserId });

    await maybeResetSessionBeforeRun(queryUserId);
```

- [ ] **Step 3: Type-check**

```bash
pnpm type-check
```

Expected: clean exit.

- [ ] **Step 4: Run the full test suite**

```bash
pnpm test -- --run
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/gateway/console.ts
git commit -m "feat(console): provision per-user CLAUDE.md and writing-skills

Mirrors the Telegram-side provisioning. Console runs use userId
'console-user' by default, so the file lands at
data/users/console-user/CLAUDE.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Strip `CORE_SYSTEM_PROMPT` to invariants

**Files:**
- Modify: `src/core/system-prompt.ts`
- Test: `src/core/system-prompt.test.ts` (rewrite assertions)

This task is the riskiest in the plan. Write the new test assertions FIRST so the desired prompt shape is locked in before the rewrite.

- [ ] **Step 1: Replace the test assertions**

Replace the entire content of `src/core/system-prompt.test.ts` with:

```typescript
// src/core/system-prompt.test.ts

import { describe, it, expect } from 'vitest';
import { CORE_SYSTEM_PROMPT, assembleSystemPrompt } from './system-prompt.js';

describe('assembleSystemPrompt', () => {
  it('replaces the {{WAKE_UP_BRIEFING}} slot with the provided briefing string', () => {
    const briefing = '<wake_up_briefing>...</wake_up_briefing>';
    const out = assembleSystemPrompt(briefing);
    expect(out).toContain(briefing);
    expect(out).not.toContain('{{WAKE_UP_BRIEFING}}');
  });

  it('preserves the three invariant sections', () => {
    const out = assembleSystemPrompt('');
    expect(out).toContain('<reply_rule>');
    expect(out).toContain('<input_format>');
    expect(out).toContain('<on_wake_up>');
  });

  it('does NOT carry behavior sections (migrated to CLAUDE.md)', () => {
    expect(CORE_SYSTEM_PROMPT).not.toContain('<initiative>');
    expect(CORE_SYSTEM_PROMPT).not.toContain('<memory_discipline>');
    expect(CORE_SYSTEM_PROMPT).not.toContain('<skills>');
  });

  it('does NOT enumerate domain stores (migrated to CLAUDE.md)', () => {
    // These tokens used to live in <memory_discipline>; they belong in
    // CLAUDE.md now, not in the engine prompt.
    expect(CORE_SYSTEM_PROMPT).not.toContain('SEARCH BEFORE SAVE');
    expect(CORE_SYSTEM_PROMPT).not.toContain('BATCH WITH ARRAYS');
    expect(CORE_SYSTEM_PROMPT).not.toContain('heartbeat');
  });

  it('still surfaces the critical reply rule', () => {
    expect(CORE_SYSTEM_PROMPT).toContain('`send_message`');
    expect(CORE_SYSTEM_PROMPT).toContain('never plain text');
  });

  it('still references CLAUDE.md and skills as the behavior layers', () => {
    expect(CORE_SYSTEM_PROMPT).toContain('CLAUDE.md');
    expect(CORE_SYSTEM_PROMPT).toMatch(/skills?\//i);
  });

  it('<on_wake_up> promotes <recent_messages> as primary context', () => {
    expect(CORE_SYSTEM_PROMPT).toContain('<recent_messages>');
    expect(CORE_SYSTEM_PROMPT).toContain('primary fresh-context');
  });

  it('<on_wake_up> handles stale cron messages', () => {
    expect(CORE_SYSTEM_PROMPT).toMatch(/stale/i);
  });

  it('does not reference removed v3 specifics', () => {
    const forbidden = ['prayer', 'Busan', 'KST', 'sholat', 'habit', 'Time-keeper'];
    for (const term of forbidden) {
      expect(CORE_SYSTEM_PROMPT).not.toContain(term);
    }
  });

  it('is bounded in size (engine prompt holds invariants only)', () => {
    // Hard ceiling: pre-refactor was ~2400 chars. Target is well under
    // half that. This guards against accidental drift back to verbose.
    expect(CORE_SYSTEM_PROMPT.length).toBeLessThan(1800);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/core/system-prompt.test.ts -- --run
```

Expected: FAIL on `does NOT carry behavior sections`, `does NOT enumerate domain stores`, `still references CLAUDE.md`, `is bounded in size`. (The current prompt still has all of these tags.)

- [ ] **Step 3: Replace `CORE_SYSTEM_PROMPT`**

Replace the body of `src/core/system-prompt.ts` with:

```typescript
// src/core/system-prompt.ts

/**
 * The agnostic core system prompt. Holds **protocol invariants only**:
 * how messages arrive, how replies leave, the on-wake decision loop.
 *
 * Identity, persona, initiative discipline, and memory-curation rules
 * live in the per-user `CLAUDE.md` (auto-loaded by Claude Agent SDK from
 * the per-user cwd). Situational procedures live in per-user skills
 * under `<cwd>/.claude/skills/`. Runtime state arrives via the
 * {{WAKE_UP_BRIEFING}} slot.
 *
 * Keep this file under ~1800 chars. If it grows, the new content is
 * almost certainly behavior — push it down to CLAUDE.md or a skill.
 */
export const CORE_SYSTEM_PROMPT = `You are the assistant for a user reached via a chat gateway.
Your identity, persona, and prime directives are in CLAUDE.md (auto-loaded).
Situational procedures live in skills/ — consult on demand.

<reply_rule>
ALWAYS reply via the \`send_message\` tool — never plain text.
\`send_message\` accepts an array; splitting into 2–3 short bursts is fine.
Match the user's language and energy.

EXCEPTION: skip \`send_message\` only when a <system_message> arrives but the
user has already moved past that topic.
</reply_rule>

<input_format>
Messages arrive wrapped in XML:
- <user_message timestamp="..."><body>...</body></user_message> — from user.
  May include has_media="true".
- <system_message timestamp="..."><body>...</body></system_message> — scheduler
  trigger (cron fired, external trigger, etc.). Act on it as your own
  initiative; never mention the machinery.
</input_format>

<on_wake_up>
- Read the wake-up briefing below for current state.
- Apply the directives in CLAUDE.md (already in your context).
- Consult skills/ for procedures relevant to the current situation.
- Decide: reply, act, or stay silent.

The briefing's \`<recent_messages>\` block is your primary fresh-context
layer — the last ~20 messages verbatim. Always read it before composing.
Use \`search_messages\` only when you need older history or a keyword
lookup beyond what the block contains.

When the trigger is a <system_message> (cron fired): the cron's
\`message\` field was written earlier and may be stale. Reconcile it with
\`<recent_messages>\`:
- If the user already addressed the cron's topic, or moved on, skip
  \`send_message\` entirely.
- If the user just shared new context (arrived somewhere, finished a task,
  made a decision), weave THAT into your reply — don't fall back on
  suggestions baked into the cron message.
</on_wake_up>

{{WAKE_UP_BRIEFING}}`;

/**
 * Inject the rendered wake-up briefing block into the core prompt's slot.
 */
export function assembleSystemPrompt(briefing: string): string {
  return CORE_SYSTEM_PROMPT.replace('{{WAKE_UP_BRIEFING}}', briefing);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/core/system-prompt.test.ts -- --run
```

Expected: all 10 cases green.

- [ ] **Step 5: Run the full test suite**

```bash
pnpm test -- --run
```

Expected: green. If any other test references the removed sections (e.g., a gateway test that asserts on prompt content), fix it locally — the prompt content has legitimately changed.

- [ ] **Step 6: Commit**

```bash
git add src/core/system-prompt.ts src/core/system-prompt.test.ts
git commit -m "refactor(core): strip CORE_SYSTEM_PROMPT to invariants

Engine prompt now holds protocol contracts only (reply_rule, input_format,
on_wake_up). Identity, initiative, and memory discipline migrated to
per-user CLAUDE.md (provisioned in earlier commits). The <skills> block
moved to the writing-skills meta-skill, discoverable on demand.

Length: ~2400 → ~1500 chars (bounded by test).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Build, type-check, and end-to-end smoke

**Files:** none modified — verification only.

- [ ] **Step 1: Type-check**

```bash
pnpm type-check
```

Expected: clean exit.

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: clean exit, `dist/` updated.

- [ ] **Step 3: Run all tests**

```bash
pnpm test -- --run
```

Expected: every test file green. Note the count for the next phase's regression baseline.

- [ ] **Step 4: Console smoke test**

Start the console gateway with a fresh-data-dir to verify provisioning end-to-end:

```bash
DATA_DIR=/tmp/pai-smoke-$(date +%s) GATEWAY=console pnpm dev
```

In the prompt, type `halo` and wait for a response. Then `/exit`.

Verify both files exist:

```bash
ls -la /tmp/pai-smoke-*/users/console-user/
ls -la /tmp/pai-smoke-*/users/console-user/.claude/skills/writing-skills/
```

Expected:
- `CLAUDE.md` present at the user dir, content matches `CLAUDE_MD_TEMPLATE`.
- `.claude/skills/writing-skills/SKILL.md` present with frontmatter and body matching `WRITING_SKILLS_TEMPLATE`.

- [ ] **Step 5: `/system_prompt` inspection**

In the same console session before `/exit`, type `/system_prompt` and confirm the rendered prompt is the new minimal shape (no `<initiative>`, `<memory_discipline>`, `<skills>` tags) and includes the wake-up briefing.

- [ ] **Step 6: Telegram smoke (manual, optional but recommended)**

If you have the Telegram bot wired up locally, send any message and verify:
- `data/users/<chatId>/CLAUDE.md` is created (idempotent — won't overwrite if already there).
- `data/users/<chatId>/.claude/skills/writing-skills/SKILL.md` is created.
- The bot still replies normally — behavior should be indistinguishable from before, since the migrated content reaches the AI via CLAUDE.md instead of system prompt.

- [ ] **Step 7: Commit (if any changes)**

If Steps 1-6 are clean and produced no source changes, no commit is needed. Otherwise:

```bash
git add -u
git commit -m "chore: post-refactor verification fixes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Open Question verification (spec §9)

The spec lists open questions to verify during implementation. Resolve the two that affect Phase A; defer the rest to their respective phases.

**Files:** none — verification + a possible spec note update.

- [ ] **Step 1: Confirm SDK loads `CLAUDE.md` from `cwd`**

The SDK's `settingSources: ['user', 'project']` is configured in `src/ai-engine/options.ts:69`. With `cwd` set per-user, the SDK should pull `<cwd>/CLAUDE.md` into the project context.

To confirm in the smoke test, run with debug logging:

```bash
DEBUG=1 DATA_DIR=/tmp/pai-smoke-claude-md GATEWAY=console pnpm dev
```

Send a message that should exercise behavior previously in `<initiative>` (e.g., "I have a deadline tomorrow at 5pm"). Expected: AI creates a task and/or cronjob unprompted, exactly as it would have before the refactor. If it does NOT, the SDK is not loading CLAUDE.md as expected — investigate `settingSources` config or file path.

- [ ] **Step 2: Confirm CLAUDE.md size budget is OK**

```bash
wc -c src/skills/templates.ts
```

`CLAUDE_MD_TEMPLATE` should be well under 4000 chars. The SDK's project context allowance is generous; this is a smoke check, not a hard limit.

- [ ] **Step 3: Update spec if a finding contradicts the design**

If §9 Open Question 1 (size budget) or 2 (engine-prompt ↔ CLAUDE.md ordering) reveals an issue, append a `## §10 Implementation Notes` section to the spec at `docs/superpowers/specs/2026-04-25-pai-agnostic-infra-foundation-design.md` and commit:

```bash
git add docs/superpowers/specs/2026-04-25-pai-agnostic-infra-foundation-design.md
git commit -m "docs: spec — Phase A implementation notes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If everything works as designed, no commit is needed.

---

## Done criteria

- [ ] All tests in `pnpm test` pass.
- [ ] `pnpm type-check` is clean.
- [ ] `pnpm build` is clean.
- [ ] Smoke test (Task 7) shows `CLAUDE.md` and `writing-skills/SKILL.md` provisioned at expected paths and the bot still behaves normally.
- [ ] `CORE_SYSTEM_PROMPT.length < 1800` (asserted by test).
- [ ] User has used the system for ≥3 days post-deploy with no observable regression in initiative or memory-discipline behavior. (This is a soak — not a code task, but the spec calls for it before Phase B starts.)

If any post-deploy regression is observed, the rollback is `git revert` of the Task 6 commit — the migrated content in CLAUDE.md remains in place but the engine prompt is restored, so the AI receives the behavior content from both layers (idempotent overlap, no regression).
