# PAI Agnostic Infrastructure Foundation

**Date:** 2026-04-25
**Branch:** `feat/agnostic-infra-foundation`
**Status:** Design draft, awaiting user review
**Extends:** [2026-04-22-v5-memory-redesign-design.md](./2026-04-22-v5-memory-redesign-design.md)

---

## 1. Motivation

PAI's current architecture mixes two kinds of concern in the same surface:

- **Engine invariants** — protocol-level contracts that never change (how messages arrive, how replies leave, how a wake-up turn is structured).
- **Domain behavior** — opinions about *how the assistant should behave* (be a proactive manager, curate five named memory stores, write skills with a specific frontmatter).

Both currently live in `CORE_SYSTEM_PROMPT` (`src/core/system-prompt.ts`). The result is coupling: changing memory layout requires editing the engine prompt; adjusting the assistant's persona requires a redeploy; per-user tone customization is impossible without code change.

The vision is **agnostic infrastructure + runtime behavior**. The engine should be a thin protocol layer; what the assistant is *for* should be configurable per-user at runtime, expressible without touching engine code.

This spec defines the foundation that makes that vision real, and adds two infra capabilities (event-task triggers, generic ledger) that have already proven necessary from the brainstorm.

## 2. Design Principles

1. **Engine prompt holds invariants only.** Protocol, not personality. Target: ~30 lines, no domain vocabulary.
2. **State lives in infra surfaces; decisions live in user-controlled layers.** Wake-up briefing exposes state (active tasks, recent messages, hints); CLAUDE.md and skills decide what to do with it.
3. **Four lifetimes, four layers.** Engine (compile-time) → CLAUDE.md (user-edit-time) → skills (AI-extend-time) → briefing (per-query).
4. **Storage primitives are minimal but composable.** A new domain (expense, learning log, mood log) should NOT require a new table.
5. **External capabilities go through MCP.** Internal data extensibility goes through skills + ledger.
6. **Existing infra that solves a real problem stays.** Custom cron is *not* replaced by Claude SDK schedule (different category — see §6.3).

## 3. Target Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Engine prompt (~30 lines)                              │
│  Protocol invariants: send_message, XML input format,   │
│  on_wake_up decision loop. No domain vocabulary.        │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  CLAUDE.md per-user (data/users/<id>/CLAUDE.md)         │
│  Identity, persona, prime directives. User-editable.    │
│  Auto-loaded by Claude Agent SDK from cwd.              │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Skills per-user (data/users/<id>/skills/*.md)          │
│  Situational procedures. AI writes/reads on-demand.     │
│  Phase 2: may include code (see §7.2).                  │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Wake-up briefing (runtime, per fresh session)          │
│  Current state snapshot: profile, prefs, recent msgs,   │
│  active event-tasks, hints. State only — no behavior.   │
└─────────────────────────────────────────────────────────┘
```

### 3.1 Boundary table (canonical)

| Need | Solution |
|---|---|
| Identity & top-level direction | **CLAUDE.md** (per-user) |
| Situational procedure | **Skill** (per-user, `skills/*.md`) |
| Time-based reminder | **Cronjob** (existing `cronjobs` table) |
| Condition-based reminder | **Task with `triggered_by`** (briefing surface) |
| Inbound trigger from external system | **HTTP `/trigger`** (existing `src/trigger`) |
| Connect to external service | **MCP server** (per-user config) |
| User-defined structured data, stored locally | **Ledger** (new, generic stream) |
| Conversational raw history | **`messages`** (existing, keep) |
| Pinned facts about the user | **`profile`, `preferences`, `knowledge`** (existing) |

## 4. Phase A — Engine Prompt Refactor + CLAUDE.md per-user

### 4.1 Strip `CORE_SYSTEM_PROMPT` to invariants

Current sections and their disposition:

| Section | Current location | Move to |
|---|---|---|
| `<reply_rule>` | engine prompt | **stay** (invariant) |
| `<input_format>` | engine prompt | **stay** (invariant) |
| `<initiative>` | engine prompt | **CLAUDE.md** (default template) |
| `<memory_discipline>` | engine prompt | **CLAUDE.md** (default template) |
| `<skills>` (how to write skills) | engine prompt | **skill** `meta/writing-skills.md` (read on demand) |
| `<on_wake_up>` | engine prompt | **stay** (invariant — decision loop is protocol) |
| `{{WAKE_UP_BRIEFING}}` | engine prompt slot | **stay** (state surface) |

Target shape of the engine prompt (illustrative, ~30 lines):

```
You are the assistant for a single user, reached via a chat gateway.

<reply_rule>
ALWAYS reply via the `send_message` tool — never plain text.
Splitting into 2–3 short bursts is fine. Match the user's language and energy.
EXCEPTION: skip send_message when a <system_message> arrives but the user
has already moved past that topic.
</reply_rule>

<input_format>
- <user_message timestamp="..."><body>...</body></user_message>
- <system_message timestamp="..."><body>...</body></system_message>
  (Act on system_message as your own initiative; never mention machinery.)
</input_format>

<on_wake_up>
- Read CLAUDE.md (identity & prime directives) if not already in context.
- Read the wake-up briefing below for current state.
- Consult skills/ for procedures relevant to the situation.
- Decide: reply, act, or stay silent.
</on_wake_up>

{{WAKE_UP_BRIEFING}}
```

The exact wording will be finalized during implementation; the constraint is **no domain vocabulary** (no "manager", no "five stores", no "profile/preferences/knowledge/journal/tasks" enumeration).

### 4.2 Per-user CLAUDE.md

Auto-loaded by Claude Agent SDK from `cwd` — already per-user since `cwd = data/users/<id>/`.

**Default template** (created on first user provisioning, then user-editable):

```markdown
# Assistant Identity

You are Mirza's personal assistant — a warm, proactive manager.
Your job: remember what matters, show up at the right moment, act before being asked.

## Initiative

You are a manager who connects dots, not a reactive chatbot.
After every user message and tool result, ask:
- What changed — and what else should update because of it?
- Is there a thread (open task, running cron, recent journal) this touches?
- Is something the user mentioned earlier due for follow-up?

If yes, act — don't wait to be re-asked.

[... full text migrated from current <initiative> ...]

## Memory Discipline

You actively curate these stores: profile, preferences, knowledge, journal,
tasks. Plus messages (auto-logged passive history).

[... full text migrated from current <memory_discipline> ...]

## Active Event Tasks

When the briefing surfaces `<active_event_tasks>`, scan them against the
current user message. If the user signals a trigger condition has occurred
("aku mau ke indomaret", "ARC udah keluar"), act on the matching task(s).
```

**Why CLAUDE.md, not a skill?** It's *always* relevant (identity, top-level mindset). Skills are for *situational* knowledge.

**Why per-user, not global?** Different users may want different personas. For B (close circle) the default is fine; user can edit directly. For C (multi-tenant), provisioning fills in `{name}`, language defaults, etc.

### 4.3 Migrate `<skills>` block to `meta/writing-skills.md`

The current `<skills>` block teaches the AI *how to write skills*. It's bootstrap meta — only relevant when AI is creating a skill. Move to a skill file the AI reads on-demand.

### 4.4 Risk & validation

The risk is **regression**: stripping the system prompt could quietly degrade behavior (less initiative, fewer save_* calls, missed follow-ups). Mitigations:

- Keep snapshots of pre/post system prompt rendered output for a fixed test conversation.
- Behavior tests: replay a curated set of inputs (`src/core/system-prompt.test.ts` exists; extend) and assert the AI calls expected tools and produces the expected reply shape.
- One-week soak with the user before considering this phase done.

## 5. Phase B — Tasks `triggered_by` + Briefing Surface

### 5.1 Schema change

Add to `tasks` table:

```sql
ALTER TABLE tasks ADD COLUMN trigger_type TEXT;       -- 'time' | 'event' | 'always'
ALTER TABLE tasks ADD COLUMN trigger_pattern TEXT;    -- free-text description of trigger
```

- `trigger_type='time'` → also create a paired cronjob; `trigger_pattern` stores cron expression (or human-readable). Avoid double-execution: cronjob is the source of truth, the task row carries metadata.
- `trigger_type='event'` → `trigger_pattern` is free-text describing the trigger ("kalau ke indomaret", "kalau ARC keluar"). Surfaced in briefing.
- `trigger_type='always'` (default) → ordinary TODO, surfaced via existing `tasks_due_today` hint.

Create-task tool gains `trigger_type` and `trigger_pattern` parameters. Skill (or AI directly) decides which to set.

### 5.2 Briefing surface

Add to `renderWakeUpBriefing` after the `<context_hints>` block:

```xml
<active_event_tasks count="N">
  <task id="..." pattern="kalau ke indomaret">beli batere, sikat gigi, sabun</task>
  <task id="..." pattern="kalau ARC keluar">makan silverqueen</task>
</active_event_tasks>
```

Only surfaced when `count > 0`. AI sees the surface; matching against current user message is **behavior**, defined in CLAUDE.md (see §4.2 default template).

### 5.3 What we are NOT doing

- **No pre-query hook** that scans tasks and injects matches programmatically. That hardcodes behavior into infra and breaks the agnostic principle.
- **No regex/keyword matching engine.** The pattern is free-text, AI does the matching using its own judgment per CLAUDE.md guidance.

### 5.4 Validation

- Unit tests on briefing renderer with active event-tasks present and absent.
- Behavior test: insert event-task `trigger_pattern="kalau ke indomaret"`, deliver user message "aku mau ke indomaret", assert AI references the task.

## 6. Phase C1 — Generic Ledger

### 6.1 Motivation

Current memory has 5 fixed stores; none holds **structured time-series data the user accumulates**: expenses, mood logs, sleep logs, weight, habits, learning progress. Knowledges is text-keyed and not aggregable. Journal is freeform text.

Adding a bespoke table per domain (expenses, sleep, …) does not scale and breaks agnosticness. One generic ledger covers all.

### 6.2 Schema

```sql
CREATE TABLE ledger (
  id          TEXT PRIMARY KEY,            -- uuid
  ts          INTEGER NOT NULL,            -- ms epoch
  stream      TEXT NOT NULL,               -- 'expense', 'mood', 'learning', user-defined
  payload     TEXT NOT NULL,               -- JSON, schema per-stream defined by skill
  tags        TEXT,                        -- space-separated, searchable
  source_msg_id TEXT,                      -- optional, for provenance
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_ledger_stream_ts ON ledger(stream, ts DESC);
CREATE INDEX idx_ledger_tags ON ledger(tags) WHERE tags IS NOT NULL;
```

### 6.3 Tools

```
ledger_append(stream: string, payload: object, tags?: string[], ts?: number)
  → { id }

ledger_query(sql: string)
  → rows: object[]
```

`ledger_query` accepts a SQLite SELECT statement against the `ledger` table. **SELECT-only enforcement** via a parser whitelist — reject any statement not starting with `SELECT`, reject `;` followed by another statement, reject `ATTACH`/`PRAGMA`. SQLite's aggregate functions, window functions, and JSON1 extension cover the expected workload (totals, growth rates, top-N, monthly breakdowns).

`json_extract(payload, '$.amount')` etc. lets AI query inside structured payloads. Stream schema is **defined by the skill that uses the stream**, not by infra. Example skill `expense-tracker.md` would document: "stream `expense` payloads have shape `{amount: number, currency: string, category: string, note?: string}`".

### 6.4 Test case: expense tracking

End-to-end check that the abstraction holds:

1. User installs (writes) skill `expense-tracker.md` (or AI writes it on user's request).
2. User: "abis beli kopi 35rb di starbucks". AI calls `ledger_append(stream='expense', payload={amount: 35000, currency: 'IDR', category: 'food', note: 'kopi starbucks'}, tags=['food', 'beverage'])`.
3. End of month, user: "total pengeluaran makan bulan ini berapa?". AI calls `ledger_query("SELECT SUM(json_extract(payload,'$.amount')) FROM ledger WHERE stream='expense' AND json_extract(payload,'$.category')='food' AND ts >= <month_start>")`.
4. AI replies with the figure.

If this works without any infra change beyond §6.2/§6.3, the abstraction is right.

### 6.5 Validation

- Parser unit tests: SELECT-only, no multi-statement, no PRAGMA, no ATTACH.
- Integration test: write 100 sample rows across 3 streams, exercise typical aggregate queries.
- Soak: build expense-tracker skill, use for 1 week before declaring C1 done.

## 7. Out of Scope / Future Direction

These are noted to constrain scope and signal where things are headed.

### 7.1 Cronjob native vs custom

Custom cron stays. Claude SDK `/schedule` (CronCreate) spawns fresh remote agents; PAI needs cron firing inside its long-lived process to inject `<system_message>` into a user's existing session. Different category. No migration.

### 7.2 Phase C2 — Approved script-skills (future)

Skills gain optional code attachment (Python via Pyodide / WASM, or sandboxed subprocess). User reviews & approves before activation. Trust model = approval gate. Out of scope for this spec; will be its own design when the SQL-only ledger proves insufficient.

### 7.3 Phase C3 — External python-runner via MCP (future)

For freeform code execution beyond approved skills, expose via an external MCP server. Keeps PAI core clean. Out of scope.

### 7.4 Skill marketplace

Mechanism for skill import/export/discovery. Product layer, not infra. Note for later.

### 7.5 External integrations

Calendar, email, drive, browser — all via MCP. Per-user MCP config. Not in this spec; will be a separate roll-out per integration.

### 7.6 Multi-channel surfaces

Web chat, voice, email gateway. Out of scope here — gateway abstraction already exists (`src/gateway/types.ts`), adding new gateways is incremental work.

### 7.7 Quotas / billing per-user

Required for C, not for B. Existing `query_costs` table provides the data; hard caps and usage-based billing are a future addition.

## 8. Migration & Backward Compatibility

- **Phase A**: behavior-preserving refactor. CLAUDE.md default template is the verbatim migrated content of current `<initiative>` and `<memory_discipline>`. No data migration needed.
- **Phase B**: schema change is additive (new nullable columns). Existing tasks default to `trigger_type='always'`, behavior unchanged.
- **Phase C1**: pure addition (new table). Zero risk to existing data.
- **No flag day.** Each phase ships independently and is observed in production for one week before the next phase starts.

## 9. Open Questions

1. **CLAUDE.md size budget.** Claude Agent SDK loads it as additional context — what is the practical size limit before it crowds out conversation history? Spec assumes <500 lines is safe.
2. **Engine-prompt ↔ CLAUDE.md ordering.** Does the SDK insert CLAUDE.md before or after the explicit `systemPrompt`? If after, the engine prompt's `<on_wake_up>` directive "consult CLAUDE.md" might be redundant; if before, the wake-up briefing comes after CLAUDE.md and the layering works as intended. Verify during implementation.
3. **`tasks.trigger_type='time'` paired cronjob lifecycle.** When the task is deleted, does the paired cronjob auto-delete? Recommendation: yes, store `cronjob_id` foreign key on task and cascade on delete.
4. **Ledger retention.** Does ledger have any retention policy, or grow unbounded? For B/C, unbounded with manual prune via skill is fine for now.
5. **Skill discovery.** When AI consults skills, does it list all skills each turn (token cost) or use a search? Current `skill` MCP server design needs to be reviewed for this — out of strict scope but noted.
