---
name: daily-scheduler
description: Daily proactive check-in scheduler for Mirza. Use this skill when triggered by the 4am daily cronjob to generate randomized one-time check-in schedules for the day. Creates unpredictable, varied check-in messages throughout the day.
---

# Daily Scheduler — Mirza's Proactive Check-ins

This skill is triggered every day at 4:00 AM by a recurring cronjob. Its job is to generate a fresh set of **randomized, one-time (once)** check-in schedules for that day — so the contact times feel genuinely unpredictable.

---

## When to Run

This skill runs when you receive a [CRONJOB MESSAGE] that says something like:
> "Run the daily-scheduler skill to create today's check-in schedule for Mirza."

Do NOT send any message to Mirza when this skill runs. Work silently — just create the schedules.

---

## Step-by-Step Instructions

### Step 1 — Determine today's date and active window

- Get the current date (today in WIB / Asia/Jakarta, UTC+7)
- Active window: **04:30 – 22:00 WIB**
- Do NOT schedule anything before 04:30 or after 22:00

### Step 2 — Pick a random number of check-ins

Randomly decide how many check-ins to create today:
- Minimum: **3**
- Maximum: **7**
- Vary day to day — don't always pick the same number

### Step 3 — Schedule sholat reminders FIRST (strict time windows)

Sholat reminders are **NOT random**. They must be sent within strict time windows so Mirza has time to prepare and get to the masjid. Schedule these **before** picking random check-in slots.

| Prayer | Send reminder at | Notes |
|--------|-----------------|-------|
| Subuh  | **04:30–04:45 WIB** | HARD LIMIT — never after 04:45. Mirza prays at ~04:30. |
| Dzuhur | **11:45–11:55 WIB** | Must be BEFORE 12:00. Mirza leaves for masjid around/before 12:00. |
| Ashar  | **14:50–15:05 WIB** | Ashar ~15:00. Send a few minutes before. |
| Maghrib | **17:53–18:00 WIB** | Maghrib ~18:00. Send just before. |
| Isya   | **19:10–19:18 WIB** | Isya ~19:15. Send a few minutes before. |

Rules for sholat reminders:
- Pick a **non-round minute** within the window (e.g., 04:33, 11:47, 14:53)
- Only include a sholat reminder if the time is **still in the future** when the scheduler runs (04:00 WIB) — all of the above should qualify
- You do **NOT** have to include all 5 sholat reminders every day — pick 2–4 of them randomly to vary the pattern, but **Subuh must always be included**

### Step 4 — Pick random times for general check-ins

After scheduling sholat reminders, fill the remaining slots with general check-ins (type: `kabar`, `aktivitas`, `ai_news`, `say_hi`).

Total check-ins per day (sholat + general combined):
- Minimum: **4**
- Maximum: **8**

Rules for general check-in timing:
- Pick random times within the active window (04:30–22:00)
- At least **90 minutes gap** between ALL check-ins (sholat + general)
- Times must be **after the current time**
- Use **non-round minutes** — pick irregular minutes like :07, :23, :41, :53
- Distribute across the day — don't cluster all in morning or evening
- Do NOT reveal the times to Mirza

### Step 4b — Pick a message type for each general check-in

| Type | Description |
|------|-------------|
| `kabar` | Ask how Mirza is doing, what he's up to, how his day is going |
| `aktivitas` | Ask about what he's working on, coding projects, or current activities |
| `ai_news` | Share something interesting/viral about AI — search the web to find a recent trending AI topic and share it naturally |
| `say_hi` | Just a casual, friendly hello — short and warm |

Don't repeat the same type back-to-back. Mix it up.

### Step 5 — Create the once-type cronjobs

For each check-in slot, call `create_cronjob` with:
- `type`: `"once"`
- `scheduled_at`: ISO 8601 datetime with `+07:00` offset for today's date and the chosen time
  - Format: `"YYYY-MM-DDTHH:mm:00+07:00"`
- `schedule_human`: Human-readable description like `"Today at HH:mm WIB"`
- `message`: Instructions to your future self (written in third person), describing what type of check-in to do and including Mirza's name. Be specific about the tone and content type.

  **Always include this instruction in every message:**
  > "Before sending, recall relevant memories about Mirza using `recall_memory` — check for recent habits, ongoing projects, routines, or anything contextually relevant to this time of day or message type. Personalize the message based on what you find. For example, if you know he drinks coffee at 7am, mention it. If he's been working on a project, ask about it. Make it feel like you genuinely remember, not like a generic check-in."

  Examples:
  > "Check in on Mirza. It's around [time], time for Ashar prayer. Recall his habits/routines first, then remind him warmly and casually, like a friend who cares."
  > "Check in on Mirza. Ask what he's been coding or working on today. Recall any ongoing projects from memory first — if something comes up, ask specifically about that."
  > "Check in on Mirza. Share a recent viral or interesting AI news item — search the web for something trending today. Keep it conversational, not like a newsletter."

### Step 6 — Confirm silently

After creating all cronjobs, do NOT message Mirza. The job is done. The check-ins will fire automatically throughout the day.

---

## Example Output (for a 7-check-in day)

| Time | Type | Notes |
|------|------|-------|
| 04:33 | sholat (Subuh) | Within 04:30–04:45 window ✅ |
| 08:17 | ai_news | General check-in, 90+ min after Subuh |
| 11:47 | sholat (Dzuhur) | Within 11:45–11:55 window ✅ |
| 14:53 | sholat (Ashar) | Within 14:50–15:05 window ✅ |
| 16:29 | kabar | General check-in, 90+ min after Ashar |
| 17:56 | sholat (Maghrib) | Within 17:53–18:00 window ✅ |
| 20:41 | say_hi | General check-in evening |

---

## Tone Reminders (for the messages you create)

When writing the `message` field for each cronjob, instruct your future self to:
- Be warm, casual, and friendly — like a friend texting, not a bot notifying
- Use Bahasa Indonesia (can mix in English naturally)
- Keep messages short and natural
- Never feel forced or corporate

---

## Notes

- This skill runs **every day at 04:00 WIB**
- Each day's schedule is fresh — times change daily
- The goal is for Mirza to feel genuinely surprised by when he hears from you
