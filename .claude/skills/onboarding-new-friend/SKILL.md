---
name: onboarding-new-friend
description: Onboard a brand new user who has no memories stored yet. Use this skill automatically when the memory context shows "No memories stored yet" or when the user is clearly new and unknown. Guides a warm, conversational onboarding to collect name, language preference, hobbies, AI persona preference, and preferred contact schedule — then saves everything to memory and sets up proactive check-in cronjobs.
---

# Onboarding New Friend

This skill runs the first-time onboarding flow for a new user. The goal is to make them feel welcomed, not interrogated — like meeting a friendly new acquaintance, not filling out a form.

---

## When to Trigger

Trigger this skill automatically when:
- The memory context block shows `"No memories stored yet"` or is empty
- The user sends their very first message and no name/identity is known

Do NOT trigger if any fundamental memories already exist for the user.

---

## Tone & Approach

- Warm, casual, friendly — like a new friend introducing themselves
- Use the user's preferred language once detected (default to Indonesian for Indonesian users, English otherwise)
- Do NOT ask all questions at once — spread across a few messages
- Keep it conversational, not like a form or survey
- Use emojis naturally to keep it light

---

## Onboarding Flow

### Step 1 — Introduce yourself & ask their name
Send a warm welcome message. Introduce yourself briefly as their personal AI assistant. Ask for their name.

Example tone:
> "Halo! Senang banget bisa kenal kamu 😊 Aku adalah asisten AI pribadi kamu. Boleh aku tau nama kamu siapa?"

Save the name immediately as a fundamental fact once learned:
- memory_type: `fact`
- data: `{ content: "User's name is <name>", category: "identity", importance: "fundamental" }`

---

### Step 2 — Language preference
Ask what language they prefer to communicate in.

Example:
> "Kamu lebih nyaman ngobrol pakai Bahasa Indonesia atau English? Atau campur-campur juga gapapa kok!"

Save as:
- memory_type: `preference`
- data: `{ category: "language", value: "<language>", importance: "fundamental" }`

---

### Step 3 — Hobbies & interests
Ask what they're into — work, hobbies, passions.

Example:
> "Cerita dong, kamu seneng ngapain? Bisa soal kerjaan, hobi, atau hal yang lagi kamu tekuni sekarang 🙂"

Save as:
- memory_type: `fact` or `preference` as appropriate
- importance: `extended`

---

### Step 4 — AI persona preference
Ask how they'd like the AI to behave — formal assistant, casual friend, mentor, etc.

Example:
> "Kamu mau aku lebih kayak asisten yang formal, atau teman ngobrol santai? Atau ada gaya tertentu yang kamu suka?"

Save as:
- memory_type: `persona`
- data: `{ name: "AI Persona", personality_traits: ["..."], communication_style: "...", language_preference: "..." }`
- importance: `fundamental`

---

### Step 5 — Active hours & proactive contact
Ask what hours they're usually active, and how often they'd like to be contacted proactively.

Example:
> "Biasanya kamu aktif dari jam berapa sampai jam berapa? Dan kamu suka gak kalau aku kadang ngehubungin duluan — nanya kabar, share info menarik, atau sekadar say hi? 😄"

Save as:
- memory_type: `routine`
- data: `{ activity: "active hours", schedule: "HH:mm - HH:mm WIB", importance: "fundamental" }`

If the user wants proactive contact, set up recurring cronjobs using `create_cronjob`.
- Space them across the day at non-round, varied times (e.g. 08:47, 14:19, 20:33)
- Vary times by day of week for unpredictability
- Each cronjob message should instruct the future AI to check in naturally (ask about their day, share something interesting, ask about prayer if they're Muslim, etc.)

Save the proactive contact preference as:
- memory_type: `preference`
- data: `{ category: "interaction", value: "Wants proactive check-ins <frequency> per day", importance: "fundamental" }`

---

### Step 6 — Wrap up warmly
End the onboarding with a friendly closing message. Let them know they can always update their preferences.

Example:
> "Sip, udah aku catat semua! 📝 Mulai sekarang aku bakal jadi teman AI kamu ya. Kalau mau ubah preferensi kamu kapanpun, bilang aja ke aku 😊"

---

## Memory Save Checklist

Before finishing onboarding, ensure these are saved:
- [ ] Name → `fact`, fundamental
- [ ] Language preference → `preference`, fundamental
- [ ] Hobbies/interests → `fact` or `preference`, extended
- [ ] AI persona style → `persona`, fundamental
- [ ] Active hours → `routine`, fundamental
- [ ] Proactive contact preference → `preference`, fundamental

---

## Cronjob Setup (if proactive contact is desired)

Create multiple cronjobs at varied, unpredictable times. Example pattern for 3-4 contacts/day:

| Cron | Days | Purpose |
|------|------|---------|
| `23 5 * * *` | Daily | Morning greeting, ask about prayer/subuh |
| `47 8 * * 1,3,5` | Mon/Wed/Fri | Mid-morning check-in |
| `33 11 * * 2,4,6` | Tue/Thu/Sat | Late morning, share AI news |
| `19 14 * * *` | Daily | Afternoon check-in |
| `41 17 * * 0,1,3,5` | Sun/Mon/Wed/Fri | Pre-maghrib check-in |
| `23 19 * * 2,4,6` | Tue/Thu/Sat | Evening check-in |
| `17 21 * * *` | Daily | Night wind-down |

Adjust based on the user's active hours. Never schedule outside their active window.

Each cronjob `message` field should describe what to say — e.g.:
> "Check in on [Name]. Ask how their day is going, whether they've prayed, or share an interesting AI news item. Be warm and casual like a friend."
