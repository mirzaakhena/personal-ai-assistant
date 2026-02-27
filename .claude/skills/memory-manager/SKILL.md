---
name: memory-manager
description: Use this skill for memory management tasks — reviewing, auditing, re-classifying, or cleaning up stored memories. Trigger when the user asks to review their memories, when suggesting importance level changes (promote/demote), or when performing periodic memory maintenance.
---

# Memory Manager

This skill handles advanced memory management tasks beyond basic save/recall — including importance re-classification, memory audits, and cleanup.

---

## When to Use

- User asks: "review my memories", "what do you know about me?", "can you clean up my memories?"
- You notice a memory should be promoted or demoted in importance
- Periodic maintenance is needed (e.g. outdated facts, stale preferences)
- User asks to reorganize or consolidate memories

---

## Importance Re-Classification

Memories have two importance levels:
- **`fundamental`** — auto-loaded every conversation (name, persona, key prefs, active routines, critical facts)
- **`extended`** — recalled on-demand only

### When to Promote (extended → fundamental)
Suggest promoting when:
- An `extended` memory has been accessed or referenced frequently (5+ times across sessions)
- The info is now essential context for every conversation (e.g. user changed jobs, moved cities)
- User explicitly says "always remember this"

### When to Demote (fundamental → extended)
Suggest demoting when:
- A `fundamental` memory hasn't been relevant in 30+ days
- Info is now outdated or superseded (e.g. old address, past job)
- The auto-loaded context is getting too large and cluttered

### How to Re-classify
1. Use `list_memories` to get all memories with their record IDs
2. Identify candidates for promotion or demotion
3. Explain to the user why you're suggesting the change
4. Use `update_memory` with the new `importance` value after user confirms
5. Confirm: "Done! I've updated [memory] to [importance level]."

**Always get user confirmation before changing importance levels.**

Example message to user:
> "Aku notice aku sering lookup preferensi bahasa kamu — mau aku jadiin fundamental biar auto-load tiap sesi? Bisa hemat waktu soalnya."

---

## Memory Audit

When asked to audit or review memories:
1. Call `list_memories` to get all stored memories
2. Group by type: facts, preferences, routines, contacts, persona
3. Present a clean summary to the user
4. Flag any that look outdated, duplicated, or potentially wrong
5. Ask user to confirm what to keep, update, or delete

---

## Memory Cleanup

When cleaning up:
1. Identify duplicates (same info stored multiple times)
2. Identify stale/outdated entries (old addresses, past jobs, etc.)
3. Propose specific deletions or consolidations with `forget_memory`
4. Only delete after explicit user confirmation

---

## Tone

- Be transparent — explain your reasoning
- Don't make unilateral changes — always confirm first
- Keep it conversational, not clinical
