# v4 Boot Smoke Test — 2026-04-21

Quick boot-level verification that `src/index.ts` starts and exits cleanly before cutover.

## Command

```bash
printf '/exit\n' \
  | CLAUDE_MODEL=claude-sonnet-4-6 GATEWAY=console CONSOLE_USER_ID=v4-boot-smoke \
    timeout 10 pnpm tsx src/index.ts
```

## Observed (pass)

- ✅ `v3→v4 cleanup: cleared 1 stale sessionId(s)` — cleanup path executed on a real existing user.
- ✅ Cron scheduler reconciled existing user's jobs (1 one-shot registered, 4 missed once detected, 2 recurring registered).
- ✅ Trigger server listening on 127.0.0.1:3100.
- ✅ Console banner printed (`Personal AI Assistant v4 — Console Gateway`).
- ✅ `/exit` causes graceful shutdown ("Goodbye!").
- ✅ No TypeScript errors, no unhandled promise rejections, process exits 0.

## What this does NOT cover

The full golden path scenarios from `docs/superpowers/specs/2026-04-21-src-v4-design.md §11` require a live API key and manual chat interaction:

1. Fresh user greeting + profile save
2. Skill write via conversation
3. Turn threshold → summarize cycle
4. SIGINT mid-conversation → summarize
5. Resume briefing after restart
6. `<msg_ref/>` round-trip
7. Cold-start continuity with synthetic summary

Run these manually after cutover (Task 22) before relying on v4 for production traffic.
