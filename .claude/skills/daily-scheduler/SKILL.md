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

### Step 3 — Pick random times

For each check-in, pick a random time within the active window (04:30–22:00).

Rules:
- At least **90 minutes gap** between each check-in
- Times must be **after the current time** (it's already ~04:00 when this runs, so start from 04:30 at earliest)
- Use **non-round minutes** (avoid :00, :15, :30, :45) — pick irregular minutes like :07, :23, :41, :53, etc.
- Distribute across the day — don't cluster all in the morning or evening
- Do NOT reveal the times to Mirza

### Step 4 — Pick a message type for each check-in

Vary the type of message for each slot. Choose from:

| Type | Description |
|------|-------------|
| `sholat` | Remind Mirza to pray. Match the time to the relevant prayer: Subuh (~05:00), Dhuha (~07:00-11:00), Dzuhur (~12:00), Ashar (~15:00-17:00), Maghrib (~18:00), Isya (~19:30) |
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
- `message`: Instructions to your future self (written in third person), describing what type of check-in to do and including Mirza's name. Be specific about the tone and content type. Example:
  > "Check in on Mirza. It's around [time], time for Ashar prayer. Remind him warmly and casually, like a friend who cares."
  > "Check in on Mirza. Ask what he's been coding or working on today. Be curious and casual."
  > "Check in on Mirza. Share a recent viral or interesting AI news item — search the web for something trending today. Keep it conversational, not like a newsletter."

### Step 6 — Confirm silently

After creating all cronjobs, do NOT message Mirza. The job is done. The check-ins will fire automatically throughout the day.

---

## Example Output (for a 5-check-in day)

| Time | Type | Message |
|------|------|---------|
| 06:23 | sholat | Remind Mirza about Subuh/morning prayer, warm and casual |
| 09:47 | ai_news | Share something interesting about AI that's trending today |
| 13:11 | kabar | Ask how Mirza's day is going, what he's up to |
| 17:38 | sholat | Remind Mirza about Ashar prayer |
| 20:52 | say_hi | Just a casual good evening message |

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
