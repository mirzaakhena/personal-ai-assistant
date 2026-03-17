# Messaging Gateway Abstraction & Web Chat Application

**Date:** 2026-03-17
**Status:** Approved

## Problem

The personal-ai-assistant is tightly coupled to WhatsApp as its only communication channel. During development, this creates a dependency on WhatsApp (whatsapp-web.js, Puppeteer, Chrome) which slows down iteration. A lightweight alternative is needed for dev workflows.

## Goals

1. Abstract the transport layer (receive & send messages) behind a minimal interface
2. Adapt existing WhatsApp code to implement this interface (no breaking changes)
3. Build a standalone web chat application as an alternative gateway for development
4. Only one gateway active at a time, selected at startup via env var

## Non-Goals

- Running multiple gateways simultaneously
- Authentication/multi-user support for web chat
- Full feature parity with WhatsApp in MVP (media, reply context, typing simulation)
- Replacing WhatsApp — it remains the primary gateway

## Design

### Gateway Interface

The interface is intentionally minimal — only transport concerns:

```typescript
// src/gateway/types.ts

interface IncomingMessage {
  userId: string;              // unique user identifier (phone number used as ID)
  body: string;                // text content
  mediaBlocks?: MediaContentBlock[];  // optional media
  quotedBody?: string;         // optional reply context
}

interface MessageGateway {
  // Send a text message to user
  sendMessage(userId: string, content: string): Promise<void>;

  // Start listening — calls onMessage when a message arrives
  start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void>;

  // Graceful shutdown
  stop(): Promise<void>;
}
```

Queue, whitelist filtering, typing simulation, group chat filtering — these are all implementation details within specific gateways, not part of the interface.

### WhatsApp Gateway Adaptation

File: `src/gateway/whatsapp.ts` — implements `MessageGateway`

**What moves into WhatsAppGateway:**
- `createWhatsAppClient()` + event listeners (QR, auth, ready, disconnected)
- Whitelist filtering and group chat filtering
- Per-phone queue (`enqueue`)
- Chrome cleanup and lock file removal
- Restart flag handling on ready
- Typing simulation stays inside WhatsApp's `sendMessage` implementation

**What does NOT change:**
- All core systems (session, memory, cronjob DB, stats, turns) — untouched

**Decoupling WhatsApp types from shared code:**

Several modules currently import `Client` from `whatsapp-web.js`. All of these must be decoupled:

1. **`MessageContext`** (`src/tools/message.ts`) — used by `send_message` MCP tool:

```typescript
// Before (tightly coupled)
type MessageContext = { client: Client; chatId: string };

// After (gateway-agnostic)
type MessageContext = {
  sendMessage: (content: string) => Promise<void>;
};
```

Each gateway provides its own `sendMessage` implementation — WhatsApp wraps it with typing simulation, WebChat sends directly via WebSocket. The `send_message` tool's `pauseBeforeTyping` parameter becomes a no-op for webchat (sleep is skipped, message sent immediately).

2. **`CronContext`** (`src/tools/cronjob.ts`) — used for creating cronjobs:

```typescript
// Before
type CronContext = { registry: CronRegistry; client: Client; phoneNumber: string };

// After — client removed, not needed for creating cronjobs
type CronContext = { registry: CronRegistry; phoneNumber: string; };
```

3. **`processCronjob()`** (`src/cron/executor.ts`) — fires scheduled messages:

```typescript
// Before
processCronjob(client: Client, registry: CronRegistry, jobId, executionId)

// After — takes gateway.sendMessage instead of Client
processCronjob(gateway: MessageGateway, registry: CronRegistry, jobId, executionId)
```

The executor builds a `MessageContext` from `gateway.sendMessage()` bound to the user's chatId, then passes it to `createQueryOptions` as before.

4. **`processMessage()` signature** (`src/handlers/message.ts`):

```typescript
// Before
processMessage(client: Client, message: Message, registry: CronRegistry)

// After — takes gateway + normalized message
processMessage(gateway: MessageGateway, msg: IncomingMessage, registry: CronRegistry)
```

The function currently extracts `chatId`, `phoneNumber`, `body`, `quotedBody`, and `mediaBlocks` from the WhatsApp `Message` object. With the new signature, these are already normalized in `IncomingMessage`. Direct `client.sendMessage()` calls inside command handlers (`/new`, `/status`, `/restart`) are replaced with `gateway.sendMessage(msg.userId, text)`.

5. **`/restart` command handling**: The `/restart` command is WhatsApp-specific (PM2 restart + restart flag). Under webchat, this command is ignored with a "not supported" response. The command handler checks a gateway type or capability flag.

6. **System prompt** (`src/core/options.ts`): The phrase "via WhatsApp" is made generic (e.g., "from user") so Claude's behavior is channel-agnostic.

7. **`reconcileOnStartup()`** and `scheduleOnceJob()`/`scheduleRecurringJob()`: These currently pass `Client` to `processCronjob`. Updated to pass `gateway: MessageGateway` instead.

8. **`enqueue()` in scheduler**: The cron scheduler (`src/cron/scheduler.ts`) imports `enqueue` from `src/whatsapp/queue.ts`. This queue module is not WhatsApp-specific — it's a generic per-phone sequential processor. It should be moved to a shared location (e.g., `src/utils/queue.ts`) so both gateways and the scheduler can use it.

9. **JID construction in executor**: `processCronjob()` currently constructs `chatId` by appending `WA_JID_PERSONAL` suffix. With the new signature taking `gateway: MessageGateway`, it should use `gateway.sendMessage(job.phone_number, content)` directly — no JID construction needed.

10. **`send_message` tool rewrite**: The `createMessageTools` function currently uses WhatsApp-specific APIs (`getChatById`, `sendStateTyping`, `clearState`). With the new `MessageContext = { sendMessage }`, the tool simply calls `ctx.sendMessage(msg.content)` for each message. The `pauseBeforeTyping` schema field is kept for backward compatibility but the sleep behavior is the gateway's concern — WhatsApp gateway's `sendMessage` includes typing simulation, WebChat's does not.

### Web Chat Gateway

File: `src/gateway/webchat.ts` — implements `MessageGateway`

**Backend:**
- HTTP server (native Node.js) + WebSocket for real-time messaging
- Serves React app as static files
- `userId` hardcoded from env var (user's phone number)
- No whitelist, no queue (single user, sequential by nature)

**Frontend:** Vite + React + TypeScript in `web/` directory
- Simple chat UI: message list + text input
- WebSocket connection to backend
- Support for `/new` and `/status` commands
- No media upload, no reply context, no typing simulation in MVP

**Message flow:**
```
React App (browser)
    ↓ WebSocket
WebChatGateway.start()
    ↓ onMessage(IncomingMessage)
processMessage() → Claude → send_message tool
    ↓ gateway.sendMessage()
WebSocket → React App
```

### Entry Point & Switching

File: `src/index.ts` — modified to be gateway-agnostic

```typescript
const gateway = process.env.GATEWAY === 'webchat'
  ? createWebChatGateway({ userId, port })
  : createWhatsAppGateway({ whitelistNumbers });

await initMemoryDb();
await gateway.start(onMessage);
```

- Gateway selected via `GATEWAY` env var (`whatsapp` | `webchat`)
- Default: `whatsapp` — no breaking change
- WhatsApp-specific startup logic (chrome cleanup, lock files, restart flag) moves inside `WhatsAppGateway.start()`
- Shutdown handler calls `gateway.stop()`

### File Structure

```
src/
  gateway/
    types.ts              # MessageGateway interface, IncomingMessage type
    whatsapp.ts           # WhatsApp implementation (wrap existing code)
    webchat.ts            # WebSocket server + static file serving
  index.ts                # Modified — gateway-agnostic entry point
  handlers/message.ts     # Minimal changes — MessageContext decoupled
  tools/message.ts        # MessageContext simplified, no WA dependency

web/                      # React app (separate project with own tooling)
  src/
    App.tsx               # Chat UI
    main.tsx              # Entry point
  index.html
  package.json            # Vite + React + TypeScript dependencies
  vite.config.ts
  tsconfig.json
```

`web/` is at root level (not inside `src/`) because it's a separate project with its own build tooling (Vite, React). Backend build (`tsc`) and frontend build (`vite build`) are independent.

**Frontend build:** `webchat.ts` serves pre-built static files from `web/dist/`. During development, run `vite dev` separately with WebSocket proxy to the backend.

### Data Sharing

Since both gateways use the same `userId` (phone number), all core data is shared:
- **Session** (SQLite) — resume conversations across gateways
- **Memory** (SurrealDB) — same user profile, preferences, facts
- **Cronjobs** (SQLite) — same scheduled reminders
- **Conversation summaries** — searchable from either gateway

### MVP Scope

| Feature | MVP | Later |
|---------|-----|-------|
| Text send/receive | Yes | — |
| `/new` command | Yes | — |
| `/status` command | Yes | — |
| Media upload (image/PDF) | — | Yes |
| Reply/quoted context | — | Yes |
| Typing simulation | — | Yes (optional) |
| `/restart` command | — | Not needed for web chat |

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Thin interface (only send/receive) | YAGNI — gateway is just transport |
| One gateway at a time | Simplicity — no need for concurrent channels |
| Hardcoded single user | Personal assistant, only one user |
| Same phone number as ID | Enables data sharing across gateways |
| `web/` at project root | Separate tooling (Vite/React) from backend (tsc) |
| Default to WhatsApp | No breaking change for production |
