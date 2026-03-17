# Messaging Gateway Abstraction & Web Chat Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple transport layer from core AI processing via a `MessageGateway` interface, adapt WhatsApp to it, and build a standalone web chat alternative.

**Architecture:** Thin `MessageGateway` interface (send/receive only). WhatsApp wraps existing code. WebChat uses WebSocket + React. One gateway active at a time via `GATEWAY` env var.

**Tech Stack:** TypeScript, Node.js (native http + ws), Vite, React, WebSocket (`ws` library)

**Spec:** `docs/superpowers/specs/2026-03-17-messaging-gateway-abstraction-design.md`

---

## Chunk 1: Gateway Interface & Decoupling Core Types

### Task 1: Create gateway types

**Files:**
- Create: `src/gateway/types.ts`

- [ ] **Step 1: Create the gateway interface file**

```typescript
// src/gateway/types.ts
import type { MediaContentBlock } from '../utils/media.js';

export interface IncomingMessage {
  userId: string;
  body: string;
  mediaBlocks?: MediaContentBlock[];
  quotedBody?: string;
}

export interface MessageGateway {
  sendMessage(userId: string, content: string): Promise<void>;
  start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/gateway/types.ts
git commit -m "feat: add MessageGateway interface and IncomingMessage type"
```

---

### Task 2: Move queue to shared location

**Files:**
- Move: `src/whatsapp/queue.ts` → `src/utils/queue.ts`
- Modify: `src/cron/scheduler.ts` (update import)
- Modify: `src/index.ts` (update import)

- [ ] **Step 1: Copy queue.ts to new location**

Create `src/utils/queue.ts` with identical content from `src/whatsapp/queue.ts`:

```typescript
const queues = new Map<string, Promise<void>>();

export function enqueue(phone: string, task: () => Promise<void>): void {
  const current = queues.get(phone) ?? Promise.resolve();
  const next = current.then(task).catch(console.error);
  queues.set(phone, next);
  next.finally(() => {
    if (queues.get(phone) === next) queues.delete(phone);
  });
}
```

- [ ] **Step 2: Update import in `src/cron/scheduler.ts`**

```typescript
// Before
import { enqueue } from '../whatsapp/queue.js';

// After
import { enqueue } from '../utils/queue.js';
```

- [ ] **Step 3: Update import in `src/index.ts`**

```typescript
// Before
import { enqueue } from './whatsapp/queue.js';

// After
import { enqueue } from './utils/queue.js';
```

- [ ] **Step 4: Delete old file `src/whatsapp/queue.ts`**

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Update test imports**

In `src/__tests__/whatsapp/queue.test.ts`, update the import:

```typescript
// Before
import { enqueue } from '../../whatsapp/queue.js';

// After
import { enqueue } from '../../utils/queue.js';
```

Move the test file to match new location: `src/__tests__/whatsapp/queue.test.ts` → `src/__tests__/utils/queue.test.ts`

In `src/__tests__/cron/scheduler.test.ts`, update the mock:

```typescript
// Before
vi.mock('../../whatsapp/queue.js', () => ({ enqueue: vi.fn() }));

// After
vi.mock('../../utils/queue.js', () => ({ enqueue: vi.fn() }));
```

- [ ] **Step 7: Run tests to verify**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/utils/queue.ts src/cron/scheduler.ts src/index.ts src/__tests__/utils/queue.test.ts src/__tests__/cron/scheduler.test.ts
git rm src/whatsapp/queue.ts src/__tests__/whatsapp/queue.test.ts
git commit -m "refactor: move queue to shared utils (not WhatsApp-specific)"
```

---

### Task 3: Decouple MessageContext from WhatsApp

**Files:**
- Modify: `src/tools/message.ts`

- [ ] **Step 1: Rewrite MessageContext and createMessageTools**

Replace the entire file content:

```typescript
// src/tools/message.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { log } from "../utils/logger.js";
import { MIN_PAUSE_BEFORE_TYPING_MS, MAX_PAUSE_BEFORE_TYPING_MS } from "../core/constants.js";

export type MessageContext = {
  sendMessage: (content: string) => Promise<void>;
};

export function createMessageTools(ctx: MessageContext) {
  const sendMessageTool = tool(
    "send_message",
    `Send one or multiple messages to user.

EXAMPLES:
Single message:
  {"messages": [{"content": "Halo!"}]}

Multiple messages:
  {"messages": [
    {"content": "Hmm..."},
    {"content": "Sebenernya nih..."},
    {"content": "aku bingung deh."}
  ]}`,
    {
      messages: z.array(z.object({
        content: z.string().min(1).describe("Message content to send to user"),
      })).min(1).describe("Array of messages to send sequentially"),
    },
    async (args) => {
      for (const msg of args.messages) {
        await ctx.sendMessage(msg.content);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message_count: args.messages.length }) }]
      };
    }
  );

  return [sendMessageTool];
}
```

Note: `pauseBeforeTyping` is removed from the tool schema. The AI model may still try to pass it on resumed sessions, but since Zod strips unknown fields by default this won't cause errors. Typing simulation is now the gateway's concern — WhatsApp gateway adds delays inside its `sendMessage` implementation.

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/message.ts
git commit -m "refactor: decouple MessageContext from WhatsApp Client"
```

---

### Task 4: Decouple CronContext from WhatsApp

**Files:**
- Modify: `src/tools/cronjob.ts`
- Modify: `src/cron/scheduler.ts`
- Modify: `src/cron/executor.ts`

- [ ] **Step 1: Update CronContext type in `src/tools/cronjob.ts`**

Remove `client: Client` from `CronContext` and update the import + usage:

```typescript
// Remove this import:
import type { Client } from "whatsapp-web.js";

// Change CronContext from:
export type CronContext = {
  registry: CronRegistry;
  client: Client;
  phoneNumber: string;
};

// To:
export type CronContext = {
  registry: CronRegistry;
  phoneNumber: string;
  gateway: MessageGateway;
};
```

Add import at top:
```typescript
import type { MessageGateway } from '../gateway/types.js';
```

Update `createCronjobTool` handler — change `cronCtx.client` references to `cronCtx.gateway`:

```typescript
// Line ~100, change:
scheduleOnceJob(cronCtx.registry, cronCtx.client, job);
// To:
scheduleOnceJob(cronCtx.registry, cronCtx.gateway, job);

// Line ~102, change:
scheduleRecurringJob(cronCtx.registry, cronCtx.client, job);
// To:
scheduleRecurringJob(cronCtx.registry, cronCtx.gateway, job);
```

- [ ] **Step 2: Update scheduler.ts signatures**

In `src/cron/scheduler.ts`, replace `client: Client` with `gateway: MessageGateway` in all three functions:

```typescript
// Remove:
import type { Client } from 'whatsapp-web.js';

// Add:
import type { MessageGateway } from '../gateway/types.js';

// Change all three function signatures:
export function scheduleOnceJob(registry: CronRegistry, gateway: MessageGateway, job: Cronjob): void {
  // ... inside the callback, change:
  // enqueue(job.phone_number, () => processCronjob(client, registry, job.id, executionId));
  // To:
  enqueue(job.phone_number, () => processCronjob(gateway, registry, job.id, executionId));
}

export function scheduleRecurringJob(registry: CronRegistry, gateway: MessageGateway, job: Cronjob): void {
  // Same change inside callback
  enqueue(job.phone_number, () => processCronjob(gateway, registry, job.id, executionId));
}

export function reconcileOnStartup(registry: CronRegistry, gateway: MessageGateway): void {
  // Change all calls to scheduleOnceJob/scheduleRecurringJob:
  // scheduleOnceJob(registry, client, job) → scheduleOnceJob(registry, gateway, job)
  // scheduleRecurringJob(registry, client, job) → scheduleRecurringJob(registry, gateway, job)
}
```

- [ ] **Step 3: Update executor.ts**

In `src/cron/executor.ts`:

```typescript
// Remove:
import type { Client } from 'whatsapp-web.js';

// Add:
import type { MessageGateway } from '../gateway/types.js';

// Change signature:
export async function processCronjob(
  gateway: MessageGateway,
  registry: CronRegistry,
  jobId: string,
  executionId: string
): Promise<void> {

  // Remove JID construction (line ~28):
  // const chatId = `${job.phone_number}${WA_JID_PERSONAL}`;
  // Remove WA_JID_PERSONAL from imports

  // Change MessageContext construction (line ~39):
  // const ctx: MessageContext = { client, chatId };
  // To:
  const ctx: MessageContext = {
    sendMessage: (content: string) => gateway.sendMessage(job.phone_number, content),
  };

  // Change CronContext construction (line ~40):
  // const cronCtx: CronContext = { registry, client, phoneNumber };
  // To:
  const cronCtx: CronContext = { registry, phoneNumber, gateway };
}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/tools/cronjob.ts src/cron/scheduler.ts src/cron/executor.ts
git commit -m "refactor: decouple CronContext and cron system from WhatsApp Client"
```

---

### Task 5: Decouple processMessage from WhatsApp

**Files:**
- Modify: `src/handlers/message.ts`
- Modify: `src/core/options.ts`

- [ ] **Step 1: Update processMessage signature and body**

In `src/handlers/message.ts`:

```typescript
// Remove:
import type { Client, Message } from "whatsapp-web.js";

// Add:
import type { MessageGateway, IncomingMessage } from "../gateway/types.js";

// Change signature:
export async function processMessage(
  gateway: MessageGateway,
  msg: IncomingMessage,
  registry: CronRegistry
): Promise<void> {
  const { userId, body, quotedBody, mediaBlocks } = msg;

  log.chat(`${userId} → ${body}`);

  if (body === CMD_NEW) {
    try { await summarizeAndSave(userId); } catch (err) {
      log.error(`${userId} | /new — summary generation failed`, err);
    }
    clearTrackedMessages(userId);
    deleteSessionId(userId);
    clearStats(userId);
    clearTurnCount(userId);
    log.debug(`${userId} | /new — session cleared`);
    await gateway.sendMessage(userId, '✅ New conversation session started. Previous context has been cleared.');
    return;
  }

  if (body === CMD_STATUS) {
    const sessionId = getSessionId(userId);
    const stats = getStats(userId);
    log.debug(`${userId} | /status`);

    let statusText: string;
    if (!sessionId) {
      statusText = '📊 *Session Status*\n\nNo active session.';
    } else {
      const model = stats?.model ?? FALLBACK_MODEL;
      const accCost = stats ? `$${stats.accumulated.costUsd.toFixed(COST_USD_PRECISION)}` : '-';
      const accIn   = stats ? stats.accumulated.inputTokens.toLocaleString() : '-';
      const accOut  = stats ? stats.accumulated.outputTokens.toLocaleString() : '-';
      const lastCost = stats ? `$${stats.lastQuery.costUsd.toFixed(COST_USD_PRECISION)}` : '-';
      const lastIn   = stats ? stats.lastQuery.inputTokens.toLocaleString() : '-';
      const lastOut  = stats ? stats.lastQuery.outputTokens.toLocaleString() : '-';

      statusText = [
        '📊 *Session Status*', '',
        `*Model:* ${model}`, `*Session ID:* ${sessionId}`, '',
        '*This session (accumulated):*',
        `Cost: ${accCost}`, `Tokens: ${accIn} in / ${accOut} out`, '',
        '*Last message:*',
        `Cost: ${lastCost}`, `Tokens: ${lastIn} in / ${lastOut} out`,
      ].join('\n');
    }

    await gateway.sendMessage(userId, statusText);
    return;
  }

  if (body === CMD_RESTART) {
    await gateway.sendMessage(userId, '⚠️ /restart is only available via WhatsApp gateway.');
    return;
  }

  trackMessage(userId, 'user', body);

  const sessionId = getSessionId(userId);
  const ctx: MessageContext = {
    sendMessage: (content: string) => gateway.sendMessage(userId, content),
  };
  const cronCtx: CronContext = { registry, phoneNumber: userId, gateway };
  const memCtx: MemoryContext = { phoneNumber: userId };
  const contentBlocks = buildUserPrompt(body, quotedBody, mediaBlocks);

  incrementTurnCount(userId);
  const flushReminder = shouldInjectFlushReminder(userId);
  const options = await createQueryOptions(sessionId, ctx, cronCtx, memCtx, flushReminder);

  async function* buildPrompt(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: 'user' as const,
      message: { role: 'user' as const, content: contentBlocks },
      parent_tool_use_id: null,
      session_id: sessionId ?? '',
    };
  }

  const responses = query({ prompt: buildPrompt(), options });

  let finalSessionId: string | undefined;
  let finalModel = FALLBACK_MODEL;
  for await (const msg of responses) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      finalModel = msg.model;
    }
    if (msg.type === 'result') {
      finalSessionId = msg.session_id;
      log.debug(`${userId} | $${msg.total_cost_usd.toFixed(COST_USD_PRECISION)} | session: ${msg.session_id}`);
      updateStats(userId, msg.session_id, finalModel, msg.total_cost_usd, msg.usage.input_tokens, msg.usage.output_tokens);
    }
  }

  if (finalSessionId) {
    saveSessionId(userId, finalSessionId);
  }
}
```

Note: `phoneNumber` is renamed to `userId` throughout for consistency. The `chatId` concept is gone — the gateway handles addressing.

- [ ] **Step 2: Update system prompt in `src/core/options.ts`**

Change line in `BASE_SYSTEM_PROMPT`:
```typescript
// Before:
'1. [USER MESSAGE] — Real-time message from user via WhatsApp.'

// After:
'1. [USER MESSAGE] — Real-time message from user.'
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/handlers/message.ts src/core/options.ts
git commit -m "refactor: decouple processMessage from WhatsApp types"
```

---

## Chunk 2: WhatsApp Gateway Implementation

### Task 6: Create WhatsApp gateway

**Files:**
- Create: `src/gateway/whatsapp.ts`
- Modify: `src/index.ts`
- Delete: `src/whatsapp/client.ts` (logic moves into gateway)

- [ ] **Step 1: Create WhatsApp gateway implementation**

```typescript
// src/gateway/whatsapp.ts
import wwebjs from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { execSync } from 'child_process';
import { rmSync, existsSync } from 'fs';
import type { MessageGateway, IncomingMessage } from './types.js';
import { enqueue } from '../utils/queue.js';
import { downloadAndValidateMedia, buildMediaContentBlock } from '../utils/media.js';
import { log } from '../utils/logger.js';
import {
  WA_AUTH_PATH, WA_JID_GROUP, WA_STATUS_BROADCAST,
  JID_SUFFIX_REGEX, WA_CHROME_KILL_PATTERN, WA_LOCK_FILES,
  RESTART_FLAG_FILE, TYPING_MS_PER_CHAR,
  MIN_TYPING_DURATION_MS, MAX_TYPING_DURATION_MS,
  MIN_PAUSE_BEFORE_TYPING_MS,
} from '../core/constants.js';

const { Client, LocalAuth } = wwebjs;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calcTypingDuration(content: string): number {
  return Math.min(Math.max(content.length * TYPING_MS_PER_CHAR, MIN_TYPING_DURATION_MS), MAX_TYPING_DURATION_MS);
}

export interface WhatsAppGatewayOptions {
  whitelistNumbers: Set<string>;
}

export function createWhatsAppGateway(opts: WhatsAppGatewayOptions): MessageGateway {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: WA_AUTH_PATH }),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });

  return {
    async sendMessage(userId: string, content: string) {
      const chatId = `${userId}@c.us`;
      const chat = await client.getChatById(chatId);

      // Typing simulation
      const pause = MIN_PAUSE_BEFORE_TYPING_MS;
      await sleep(pause);
      await chat.sendStateTyping();
      await sleep(calcTypingDuration(content));
      await chat.clearState();

      await client.sendMessage(chatId, content);
      log.chat(`${userId} ← ${content}`);
    },

    async start(onMessage) {
      // Clean up orphaned Chrome processes and stale lock files
      try {
        execSync(`pkill -f "${WA_CHROME_KILL_PATTERN}" 2>/dev/null || true`, { stdio: 'ignore' });
      } catch {}
      for (const lockFile of WA_LOCK_FILES) {
        if (existsSync(lockFile)) {
          log.debug(`[STARTUP] removing stale lock file: ${lockFile}`);
          rmSync(lockFile);
        }
      }

      client.on('qr', (qr) => {
        log.debug('[WA] scan QR code:');
        qrcode.generate(qr, { small: true });
      });
      client.on('authenticated', () => log.debug('[WA] authenticated'));
      client.on('auth_failure', (msg) => log.error('[WA] auth failed', msg));
      client.on('disconnected', (reason) => log.error('[WA] disconnected', reason));

      client.on('message', (message) => {
        if (message.from.endsWith(WA_JID_GROUP) || message.from === WA_STATUS_BROADCAST) return;
        if (!message.body && !message.hasMedia) return;

        const phoneNumber = message.from.replace(JID_SUFFIX_REGEX, '');
        if (!opts.whitelistNumbers.has(phoneNumber)) {
          log.debug(`[SKIP] ${phoneNumber}`);
          return;
        }

        enqueue(phoneNumber, async () => {
          let quotedBody: string | undefined;
          if (message.hasQuotedMsg) {
            const quoted = await message.getQuotedMessage();
            quotedBody = quoted.body;
          }

          let mediaBlocks: IncomingMessage['mediaBlocks'];
          if (message.hasMedia) {
            const result = await downloadAndValidateMedia(message);
            if ('error' in result) {
              await client.sendMessage(message.from, `⚠️ ${result.error}`);
              return;
            }
            mediaBlocks = [buildMediaContentBlock(result)];
            log.debug(`${phoneNumber} | media: ${result.mimetype}${result.filename ? ` (${result.filename})` : ''}`);
          }

          const incoming: IncomingMessage = {
            userId: phoneNumber,
            body: message.body.trim(),
            mediaBlocks,
            quotedBody,
          };

          await onMessage(incoming);
        });
      });

      // Initialize and wait for ready before resolving start()
      // This ensures reconcileOnStartup and restart flag (called after start) can send messages
      const readyPromise = new Promise<void>((resolve) => {
        client.on('ready', () => {
          log.debug('[WA] ready');
          resolve();
        });
      });
      await client.initialize();
      await readyPromise;
    },

    async stop() {
      await client.destroy();
    },
  };
}
```

- [ ] **Step 2: Rewrite `src/index.ts` to use gateway**

```typescript
// src/index.ts
import dotenv from 'dotenv';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { createWhatsAppGateway } from './gateway/whatsapp.js';
import { processMessage } from './handlers/message.js';
import { createCronRegistry } from './cron/registry.js';
import { reconcileOnStartup } from './cron/scheduler.js';
import { initMemoryDb, closeMemoryDb } from './db/memory.js';
import { log } from './utils/logger.js';
import { PROJECT_DIR, RESTART_FLAG_FILE } from './core/constants.js';
import type { MessageGateway } from './gateway/types.js';

dotenv.config({ path: join(PROJECT_DIR, '.env') });

const WHITELIST_NUMBERS = new Set(
  (process.env.WHITELIST_NUMBERS ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
);

if (WHITELIST_NUMBERS.size === 0) {
  log.error('[WARN] WHITELIST_NUMBERS is empty — no messages will be processed');
}

const registry = createCronRegistry();

// Gateway selection
const gatewayType = process.env.GATEWAY ?? 'whatsapp';
let gateway: MessageGateway;

if (gatewayType === 'whatsapp') {
  gateway = createWhatsAppGateway({ whitelistNumbers: WHITELIST_NUMBERS });
} else {
  throw new Error(`Unknown gateway: ${gatewayType} (webchat coming soon)`);
}

const shutdown = async (signal: string) => {
  log.debug(`[SHUTDOWN] received ${signal}, shutting down...`);
  await closeMemoryDb();
  await gateway.stop();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await initMemoryDb();

// Start gateway first — must be ready before sending any messages
await gateway.start((msg) => processMessage(gateway, msg, registry));

// Reconcile cronjobs (schedules cron timers that fire later via gateway.sendMessage)
reconcileOnStartup(registry, gateway);

// Handle restart flag (WhatsApp-specific but harmless for other gateways)
if (existsSync(RESTART_FLAG_FILE)) {
  try {
    const { chatId } = JSON.parse(readFileSync(RESTART_FLAG_FILE, 'utf-8'));
    rmSync(RESTART_FLAG_FILE);
    if (chatId) {
      const userId = chatId.replace(/@.*$/, '');
      await gateway.sendMessage(userId, '✅ Bot sudah aktif kembali.');
    }
  } catch (err) {
    log.error(`[RESTART] failed to process restart flag: ${err}`);
    rmSync(RESTART_FLAG_FILE, { force: true });
  }
}
```

- [ ] **Step 3: Delete `src/whatsapp/client.ts`**

The logic has moved into `src/gateway/whatsapp.ts`.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Manual smoke test with WhatsApp**

Run: `GATEWAY=whatsapp npm run dev`
Expected: QR code appears (or auto-auth), bot responds to messages as before.

- [ ] **Step 6: Commit**

```bash
git add src/gateway/whatsapp.ts src/index.ts
git rm src/whatsapp/client.ts
git commit -m "feat: implement WhatsAppGateway wrapping existing WhatsApp logic"
```

---

## Chunk 3: Web Chat Gateway (Backend)

### Task 7: Install ws dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install ws and its types**

Run: `pnpm add ws && pnpm add -D @types/ws`

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add ws dependency for WebChat gateway"
```

---

### Task 8: Create WebChat gateway

**Files:**
- Create: `src/gateway/webchat.ts`

- [ ] **Step 1: Create WebChat gateway implementation**

```typescript
// src/gateway/webchat.ts
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import type { MessageGateway, IncomingMessage } from './types.js';
import { log } from '../utils/logger.js';
import { PROJECT_DIR } from '../core/constants.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export interface WebChatGatewayOptions {
  userId: string;
  port: number;
}

export function createWebChatGateway(opts: WebChatGatewayOptions): MessageGateway {
  const staticDir = join(PROJECT_DIR, 'web', 'dist');
  let wss: WebSocketServer | null = null;
  let activeSocket: WebSocket | null = null;
  let httpServer: ReturnType<typeof createServer> | null = null;

  return {
    async sendMessage(_userId: string, content: string) {
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        activeSocket.send(JSON.stringify({ type: 'message', content }));
        log.chat(`${opts.userId} ← ${content}`);
      } else {
        log.error('[WEBCHAT] no active WebSocket connection');
      }
    },

    async start(onMessage) {
      httpServer = createServer((req, res) => {
        const url = req.url === '/' ? '/index.html' : req.url ?? '/index.html';
        const filePath = join(staticDir, url);

        if (!existsSync(filePath)) {
          // SPA fallback
          const indexPath = join(staticDir, 'index.html');
          if (existsSync(indexPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(readFileSync(indexPath));
          } else {
            res.writeHead(404);
            res.end('Not found. Run: cd web && pnpm build');
          }
          return;
        }

        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(readFileSync(filePath));
      });

      wss = new WebSocketServer({ server: httpServer });

      wss.on('connection', (ws) => {
        log.debug('[WEBCHAT] client connected');
        activeSocket = ws;

        ws.on('message', async (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === 'message' && typeof parsed.content === 'string') {
              const incoming: IncomingMessage = {
                userId: opts.userId,
                body: parsed.content.trim(),
              };
              await onMessage(incoming);
            }
          } catch (err) {
            log.error('[WEBCHAT] failed to process message', err);
          }
        });

        ws.on('close', () => {
          log.debug('[WEBCHAT] client disconnected');
          if (activeSocket === ws) activeSocket = null;
        });
      });

      await new Promise<void>((resolve) => {
        httpServer!.listen(opts.port, () => {
          log.debug(`[WEBCHAT] listening on http://localhost:${opts.port}`);
          resolve();
        });
      });
    },

    async stop() {
      if (wss) wss.close();
      if (httpServer) httpServer.close();
    },
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/gateway/webchat.ts
git commit -m "feat: implement WebChatGateway with WebSocket + static file serving"
```

---

### Task 9: Wire webchat gateway into entry point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add webchat gateway option to index.ts**

Replace the gateway selection block:

```typescript
// Before:
if (gatewayType === 'whatsapp') {
  gateway = createWhatsAppGateway({ whitelistNumbers: WHITELIST_NUMBERS });
} else {
  throw new Error(`Unknown gateway: ${gatewayType} (webchat coming soon)`);
}

// After:
import { createWebChatGateway } from './gateway/webchat.js';

if (gatewayType === 'webchat') {
  const userId = process.env.WEBCHAT_USER_ID;
  if (!userId) throw new Error('WEBCHAT_USER_ID env var is required for webchat gateway');
  const port = parseInt(process.env.WEBCHAT_PORT ?? '3000', 10);
  gateway = createWebChatGateway({ userId, port });
} else {
  gateway = createWhatsAppGateway({ whitelistNumbers: WHITELIST_NUMBERS });
}
```

Note: The import for `createWebChatGateway` should be at the top of the file with other imports.

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire webchat gateway into entry point with GATEWAY env var"
```

---

## Chunk 4: Web Chat Frontend (React)

### Task 10: Scaffold React app and build chat UI

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/App.css`

- [ ] **Step 1: Create web/package.json**

```json
{
  "name": "personal-ai-assistant-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd web && pnpm add react react-dom && pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom`

- [ ] **Step 3: Create web/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create web/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 5: Create web/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Assistant</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: Create web/src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 7: Create App.tsx**

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const connect = useCallback(() => {
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 2000);
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'message') {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: data.content,
          timestamp: Date.now(),
        }]);
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({ type: 'message', content: text }));
    setMessages((prev) => [...prev, {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }]);
    setInput('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>AI Assistant</h1>
        <span className={`status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Reconnecting...'}
        </span>
      </header>

      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          rows={1}
          disabled={!connected}
        />
        <button onClick={sendMessage} disabled={!connected || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Create App.css**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f0f0f0;
  height: 100vh;
}

#root {
  height: 100vh;
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 768px;
  margin: 0 auto;
  background: #fff;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
  background: #fff;
}

.chat-header h1 {
  font-size: 18px;
  font-weight: 600;
}

.status {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 12px;
}

.status.connected {
  background: #e8f5e9;
  color: #2e7d32;
}

.status.disconnected {
  background: #fce4ec;
  color: #c62828;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.message.user {
  align-self: flex-end;
  background: #0084ff;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.message.assistant {
  align-self: flex-start;
  background: #f0f0f0;
  color: #1a1a1a;
  border-bottom-left-radius: 4px;
}

.input-area {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #e0e0e0;
  background: #fff;
}

.input-area textarea {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 20px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  outline: none;
}

.input-area textarea:focus {
  border-color: #0084ff;
}

.input-area button {
  padding: 8px 16px;
  background: #0084ff;
  color: #fff;
  border: none;
  border-radius: 20px;
  font-size: 14px;
  cursor: pointer;
}

.input-area button:disabled {
  background: #ccc;
  cursor: not-allowed;
}
```

- [ ] **Step 9: Verify frontend builds**

Run: `cd web && pnpm build`
Expected: Build succeeds, output in `web/dist/`

- [ ] **Step 10: Commit**

```bash
git add -f web/
git commit -m "feat: scaffold React chat app with Vite + TypeScript"
```

---

## Chunk 5: End-to-End Testing & Cleanup

### Task 11: End-to-end smoke test

- [ ] **Step 1: Build frontend**

Run: `cd web && pnpm build`

- [ ] **Step 2: Add env vars for webchat**

Add to `.env`:
```
GATEWAY=webchat
WEBCHAT_USER_ID=<your-phone-number>
WEBCHAT_PORT=3000
```

- [ ] **Step 3: Start backend**

Run: `npm run dev`
Expected: `[WEBCHAT] listening on http://localhost:3000`

- [ ] **Step 4: Open browser**

Navigate to `http://localhost:3000`
Expected: Chat UI loads, status shows "Connected"

- [ ] **Step 5: Send a test message**

Type "hello" and press Enter.
Expected: AI responds via WebSocket, response appears in chat.

- [ ] **Step 6: Test /new command**

Type "/new" and press Enter.
Expected: Session cleared confirmation message appears.

- [ ] **Step 7: Test /status command**

Type "/status" and press Enter.
Expected: Session status message appears.

- [ ] **Step 8: Restore WhatsApp gateway**

Change `.env` back to `GATEWAY=whatsapp` (or remove the line).
Run: `npm run dev`
Expected: WhatsApp bot starts normally, QR code or auto-auth.

---

### Task 12: Clean up unused files

- [ ] **Step 1: Remove `src/whatsapp/client.ts` if not already deleted**

- [ ] **Step 2: Check if `src/whatsapp/` directory has any remaining files**

If only `queue.ts` was there (already moved), the directory can be deleted.

- [ ] **Step 3: Verify no remaining imports of `whatsapp-web.js` outside gateway**

Run: `grep -r "from 'whatsapp-web.js'" src/ --include='*.ts'`
Expected: Only `src/gateway/whatsapp.ts` and `src/utils/media.ts` (media still uses WA Message type — acceptable for now, media is not in MVP for webchat).

- [ ] **Step 4: Final type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit cleanup**

```bash
git add -A
git commit -m "chore: clean up unused WhatsApp files after gateway refactor"
```
