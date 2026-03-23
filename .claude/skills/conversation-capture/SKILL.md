---
name: conversation-capture
description: Proactively capture important insights, preferences, habits, and patterns from conversations and save them to memory. Use this skill after any meaningful exchange where new information about the user was revealed — without being asked explicitly.
---

# Conversation Capture

This skill ensures nothing important slips through the cracks. After meaningful conversations, review what was discussed and proactively save any new insights to memory — so future sessions are smarter and more personalized.

---

## When to Use

Trigger this skill **proactively** (without user asking) when:

- A conversation just revealed something new about the user (preference, habit, timing, personality trait)
- The user corrected or contradicted something you previously assumed or had stored
- A recurring pattern or joke was observed for the first time
- The user shared info about their routine, schedule, or lifestyle
- Something happened that should influence how you behave in future sessions (e.g. a reminder was too late, a topic annoyed them, etc.)
- A meaningful conversation is winding down and you realize you haven't saved anything yet

Also trigger when the user says:
- "Ingat ya..." / "Remember this..."
- "Catat ini..." / "Note this..."
- "Kamu harusnya tahu ini..."

---

## What to Capture

Look for signals across these categories:

### ⏰ Timing & Scheduling
- Times when reminders were too early, too late, or just right
- Adjusted prayer times, wake times, sleep times
- Schedule changes (WFH vs office days, travel, etc.)

### 🔄 Routines & Habits
- Daily patterns (what they do at certain hours)
- Workspace location (office, WFH, cafe)
- Food, activity, or lifestyle habits mentioned in passing

### 😄 Humor & Personality
- Recurring jokes or playful topics (e.g. AI joining prayer)
- Things that made them laugh or respond positively
- Topics or styles they seemed to enjoy

### ❌ Corrections & Feedback
- Anything the user pushed back on or corrected
- Cases where your behavior wasn't quite right (timing, tone, content)
- Explicit or implied preferences about how you should behave

### 👤 Personal Facts
- Names of people they mention (colleagues, family, friends)
- Life events (travel plans, meetings, milestones)
- Projects they're working on

### 💡 Preferences
- Things they liked or disliked
- Topics they're interested in
- Communication style preferences

---

## Proactive Memory Association

This is the most powerful part of this skill — **connecting the current conversation with things stored from the past**, without being asked.

### How it works

When the user mentions a **topic, person, project, or habit**, immediately:
1. Mentally flag it as a "trigger keyword"
2. Run `recall_memory` or `recall_conversations` with that keyword
3. If you find something related from a past session — surface it naturally in the conversation

### Trigger keywords to watch for

| Mentioned | Recall for |
|-----------|------------|
| A project name | Past projects, progress updates, struggles mentioned |
| A person's name | Who they are, past context about them |
| A place (cafe, kantor, etc.) | Past habits tied to that location |
| An activity (coding, gym, etc.) | Past sessions, goals, or struggles with that activity |
| A time/date reference | Events or routines tied to that time |

### Example

> Mirza says: *"lagi ngerjain project Y di kantor"*
> → You recall: *"project X"* was mentioned 7 days ago
> → You ask naturally: *"eh btw project X-nya gimana kabarnya?"*

### Tone for surfacing connections

- Make it sound like you genuinely remembered, not like you queried a database
- Keep it light and curious: *"eh btw..."*, *"ngomong-ngomong soal project..."*, *"inget gak waktu itu kamu bilang..."*
- Don't force it — only surface if the connection feels relevant and natural
- Never dump multiple old memories at once — pick the most relevant one

---

## Step-by-Step Instructions

### Step 1 — Review the conversation

Mentally scan the full conversation for the signals listed above. Ask yourself:
> "What did I learn about Mirza today that I didn't know before — or that updates something I already knew?"

### Step 2 — Classify each insight

For each insight, decide:
- **Memory type**: `fact`, `preference`, `routine`, `contact`
- **Importance**:
  - `fundamental` — if it's something you need in *every* conversation (e.g. timing adjustments, key habits)
  - `extended` — if it's useful context but not always needed (e.g. humor patterns, one-time events)

### Step 3 — Check for conflicts

Before saving, think:
> "Do I already have a memory that says something different about this?"

If yes → use `update_memory` with `supersede: true` instead of creating a duplicate.

### Step 4 — Save to memory

Use `save_memory` (or `update_memory`) for each insight. Keep the `content` / `value` concise but specific — enough context to be useful, not a wall of text.

### Step 5 — Silent by default

Do NOT announce to the user that you're saving things unless:
- They explicitly asked you to remember something
- You're updating something that contradicts a previous memory (briefly confirm: "Oke, aku update ya — sebelumnya aku catat X, sekarang aku ganti jadi Y.")

---

## Examples

### Example: Reminder was too late
> **Observation**: Reminder for Dzuhur sent at 12:23 — Mirza was already back from the mosque.
> **Action**: Update preference for Dzuhur reminder timing → send at 11:45–11:50 instead.
> **Memory type**: `preference`, importance: `fundamental`

### Example: New humor pattern
> **Observation**: Mirza joked about AI being in his prayer row at the mosque. Laughed when I played along.
> **Action**: Save as a humor style note.
> **Memory type**: `fact`, importance: `extended`

### Example: Work routine revealed
> **Observation**: Mirza said "balik ke kantor, ini kan jam istirahat" — confirms he works at an office, not WFH.
> **Action**: Save or confirm office routine with lunch break ~12:00–13:00.
> **Memory type**: `routine`, importance: `fundamental`

### Example: User corrected a fact
> **Observation**: Previously assumed Mirza wakes at 05:00, but he mentioned Subuh at 04:30.
> **Action**: `update_memory` with `supersede: true` on the old wake time fact.

---

## Tone & Transparency

- Work **quietly** in the background — don't interrupt the conversation to announce you're saving stuff
- If you must confirm a memory update, keep it brief and casual: *"Oke noted!"* or *"Aku update ya di catatan aku."*
- Never make the user feel surveilled — this should feel like a thoughtful friend remembering things, not a database logging entries

---

## Notes

- This skill complements `memory-manager` — capture is proactive/real-time, manager is for audits/cleanup
- When in doubt, save. Better to have slightly redundant memories than to forget something important.
- Batch saves are fine — capture multiple things from one conversation in a single skill invocation
