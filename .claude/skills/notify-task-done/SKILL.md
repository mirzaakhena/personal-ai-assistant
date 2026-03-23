---
name: notify-task-done
description: Arm the stop-hook notification so Mirza gets a WhatsApp message when Claude Code finishes a long-running task. Use this skill before delegating work to Claude Code that involves code changes, building apps, or fixing bugs. The notification is one-shot — it fires once then disables itself.
---

# Notify Task Done — Stop Hook Flag

This skill arms a one-shot flag so that when Claude Code finishes a task, the Stop hook sends Mirza a WhatsApp notification summarizing what was done.

---

## When to Use

Arm the flag **before** you delegate a long-running task to Claude Code, such as:
- Building or scaffolding a new app
- Fixing bugs or refactoring code
- Any task that involves code changes and will take more than a few seconds

Do **NOT** arm the flag for:
- Simple questions or conversations
- Memory operations
- Quick lookups or reads
- Cronjob scheduling (daily-scheduler, etc.)

---

## How It Works

1. **You arm the flag** by creating the file `/tmp/claude-notify-on-done`
2. Claude Code runs the task
3. When Claude Code stops, the Stop hook (`~/.claude/hooks/notify-done.sh`) checks for the flag file
4. If the flag exists → sends a WhatsApp notification to Mirza → **deletes the flag** (one-shot)
5. If the flag doesn't exist → hook does nothing (no loop)

---

## Step-by-Step

### Step 1 — Arm the flag

Run this command using Bash:

```bash
touch /tmp/claude-notify-on-done
```

That's it. The flag is now armed.

### Step 2 — Proceed with the task

Continue with whatever long-running task you were about to do. When Claude Code finishes, the notification will fire automatically.

### Step 3 — No cleanup needed

The Stop hook script automatically removes the flag file after firing. You don't need to do anything else.

---

## Notes

- The flag file is `/tmp/claude-notify-on-done` — a simple empty file
- The Stop hook script is at `~/.claude/hooks/notify-done.sh`
- The notification goes through the trigger server at `127.0.0.1:3100/trigger`
- One-shot design prevents infinite loops: arm → fire → disarm → done
