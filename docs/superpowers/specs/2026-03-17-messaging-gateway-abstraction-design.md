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
  userId: string;              // phone number as identifier
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
- `processMessage()` in `handlers/message.ts` — same logic, different caller
- All core systems (session, memory, cronjob, stats, turns) — untouched

**MessageContext decoupling:**

```typescript
// Before (tightly coupled to WhatsApp)
type MessageContext = { client: Client; chatId: string };

// After (gateway-agnostic)
type MessageContext = {
  sendMessage: (content: string) => Promise<void>;
};
```

The `send_message` MCP tool only needs to know how to send a message. Each gateway provides its own implementation — WhatsApp wraps it with typing simulation, WebChat sends directly via WebSocket.

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
