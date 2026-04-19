/**
 * One-shot WhatsApp chat extractor — READ-ONLY.
 *
 * Fetches the entire message history for a single phone number via whatsapp-web.js,
 * persists messages to a standalone SQLite database, and (phase 2) downloads media
 * for messages flagged as having attachments.
 *
 * SAFETY INVARIANTS (do not violate):
 *   1. Only READ-ONLY wwebjs methods are used:
 *        Client.initialize, getChatById, getMessageById, destroy
 *        Chat.fetchMessages
 *        Message.downloadMedia
 *      NEVER call: sendMessage, sendSeen, markAsRead, markChatUnread,
 *                  sendStateTyping, clearState, archive, pin, delete,
 *                  or any other mutating method.
 *   2. Pre-flight aborts if the main bot (pm2 `wa-bot`) is still running,
 *      or if any Chrome process is holding the auth folder. We refuse to
 *      share the LocalAuth dir with a live process.
 *   3. The script mutates ONLY:
 *        - data/whatsapp_extract.db
 *        - data/whatsapp_media/
 *      It never touches .wwebjs_auth/ beyond what LocalAuth itself writes
 *      during normal session resume.
 *
 * USAGE:
 *   pnpm exec tsx scripts/extract-whatsapp-chat.ts [--phone 6281321127717]
 *                                                  [--no-media]
 *                                                  [--phase2-only]
 *                                                  [--batch-step 1000]
 *                                                  [--max-messages 50000]
 *
 * RECOMMENDED RUNBOOK:
 *   1. pm2 stop wa-bot
 *   2. cp -a .wwebjs_auth .wwebjs_auth.backup-$(date +%Y%m%d-%H%M%S)
 *   3. pnpm exec tsx scripts/extract-whatsapp-chat.ts
 *   4. pm2 start wa-bot
 *   5. (if all good) rm -rf .wwebjs_auth.backup-*
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import wwebjs from 'whatsapp-web.js';

const { Client, LocalAuth } = wwebjs;

// ─── Paths ────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = join(__dirname, '..');
const WA_AUTH_PATH = join(PROJECT_DIR, '.wwebjs_auth');
const DATA_DIR = join(PROJECT_DIR, 'data');
const DB_PATH = join(DATA_DIR, 'whatsapp_extract.db');
const MEDIA_DIR = join(DATA_DIR, 'whatsapp_media');

// ─── CLI args ─────────────────────────────────────────────────────────────
interface Args {
  phone: string;
  downloadMedia: boolean;
  phase2Only: boolean;
  diagnose: boolean;
  batchStep: number;
  maxMessages: number; // hard cap to avoid runaway; set to 0 for unlimited
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    phone: '6281321127717',
    downloadMedia: true,
    phase2Only: false,
    diagnose: false,
    batchStep: 1000,
    maxMessages: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--phone') args.phone = argv[++i];
    else if (a === '--no-media') args.downloadMedia = false;
    else if (a === '--phase2-only') args.phase2Only = true;
    else if (a === '--diagnose') args.diagnose = true;
    else if (a === '--batch-step') args.batchStep = parseInt(argv[++i], 10);
    else if (a === '--max-messages') args.maxMessages = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: tsx scripts/extract-whatsapp-chat.ts [--phone N] [--no-media]\n' +
          '                                            [--phase2-only] [--diagnose]\n' +
          '                                            [--batch-step N] [--max-messages N]'
      );
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(1);
    }
  }
  if (args.phase2Only && !args.downloadMedia) {
    console.error('--phase2-only and --no-media are mutually exclusive (nothing to do)');
    process.exit(1);
  }
  if (!/^\d+$/.test(args.phone)) {
    console.error(`Invalid phone: "${args.phone}" (digits only, e.g. 6281321127717)`);
    process.exit(1);
  }
  return args;
}

// ─── Logger ───────────────────────────────────────────────────────────────
function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}
function warn(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.warn(`[${ts}] WARN ${msg}`);
}
function die(msg: string): never {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] FATAL ${msg}`);
  process.exit(1);
}

// ─── Pre-flight checks ────────────────────────────────────────────────────
function preflight(): void {
  log('pre-flight: checking pm2 wa-bot status');
  try {
    const raw = execSync('pm2 jlist', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const list = JSON.parse(raw) as Array<{ name: string; pm2_env?: { status?: string } }>;
    const bot = list.find((p) => p.name === 'wa-bot');
    if (bot && bot.pm2_env?.status === 'online') {
      die(
        'pm2 process "wa-bot" is currently ONLINE.\n' +
          '        Stop it first:  pm2 stop wa-bot\n' +
          '        Then rerun this script.'
      );
    }
    log(`pre-flight: pm2 wa-bot status = ${bot?.pm2_env?.status ?? 'not-found'} (ok)`);
  } catch (err) {
    warn(`could not query pm2 (${(err as Error).message}) — continuing with chrome-process check`);
  }

  log('pre-flight: scanning for Chrome processes on auth dir');
  try {
    const out = execSync(
      `pgrep -af "chrome.*${WA_AUTH_PATH.replace(/[.[\]/$^*+?()|{}\\]/g, '\\$&')}" || true`,
      { encoding: 'utf-8' }
    ).trim();
    if (out) {
      die(
        `detected live Chrome process(es) using ${WA_AUTH_PATH}:\n${out}\n` +
          '        Kill them manually before rerunning:\n' +
          `        pkill -f "chrome.*${WA_AUTH_PATH}"`
      );
    }
    log('pre-flight: no Chrome processes on auth dir (ok)');
  } catch (err) {
    warn(`chrome process check failed: ${(err as Error).message}`);
  }

  // Stale lock files left behind after pm2 stop — safe to remove since we just
  // verified no process is using the dir. This matches what src-v2/gateway/whatsapp.ts
  // does on bot startup (constants.ts:17-20 WA_LOCK_FILES).
  const lockFiles = [
    join(WA_AUTH_PATH, 'session', 'SingletonLock'),
    join(WA_AUTH_PATH, 'session', 'SingletonSocket'),
    join(WA_AUTH_PATH, 'session', 'SingletonCookie'),
  ];
  for (const lf of lockFiles) {
    if (existsSync(lf)) {
      log(`pre-flight: removing stale lock file ${lf}`);
      try {
        rmSync(lf);
      } catch (err) {
        warn(`could not remove ${lf}: ${(err as Error).message}`);
      }
    }
  }

  if (!existsSync(WA_AUTH_PATH)) {
    die(`auth path does not exist: ${WA_AUTH_PATH}`);
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });
}

// ─── Database ─────────────────────────────────────────────────────────────
interface MessageRow {
  id: string;
  chat_id: string;
  phone_number: string;
  from_me: number;
  timestamp: number;
  type: string;
  body: string | null;
  has_media: number;
  media_mimetype: string | null;
  media_filename: string | null;
  media_size: number | null;
  media_downloaded: number;
  media_path: string | null;
  media_error: string | null;
  quoted_msg_id: string | null;
  is_forwarded: number;
  raw_json: string;
}

function openDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      from_me INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      body TEXT,
      has_media INTEGER NOT NULL DEFAULT 0,
      media_mimetype TEXT,
      media_filename TEXT,
      media_size INTEGER,
      media_downloaded INTEGER NOT NULL DEFAULT 0,
      media_path TEXT,
      media_error TEXT,
      quoted_msg_id TEXT,
      is_forwarded INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone_number);
    CREATE INDEX IF NOT EXISTS idx_pending_media
      ON messages(has_media, media_downloaded) WHERE has_media = 1;

    CREATE TABLE IF NOT EXISTS extraction_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_number TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      phase TEXT NOT NULL,
      total_messages INTEGER DEFAULT 0,
      new_messages INTEGER DEFAULT 0,
      total_media_downloaded INTEGER DEFAULT 0,
      error TEXT
    );
  `);
  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * baseMs * 0.5);
}

function extFromMime(mime: string | null | undefined): string {
  if (!mime) return 'bin';
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/ogg; codecs=opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  if (map[mime]) return map[mime];
  const base = mime.split(';')[0].trim();
  if (map[base]) return map[base];
  const tail = base.split('/').pop() ?? 'bin';
  return tail.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
}

function safeFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// tsx/esbuild injects __name(fn, "...") helper calls into compiled output for
// function naming. Puppeteer serializes our evaluate callback and runs it in the
// page context, where __name doesn't exist → ReferenceError. Fix: define a no-op
// __name on the page's globalThis before running the real evaluate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function injectEsbuildShims(client: any): Promise<void> {
  await client.pupPage.evaluate(`
    if (typeof globalThis.__name === 'undefined') {
      globalThis.__name = function(fn, name) { return fn; };
    }
  `);
}

// List of strategy identifiers. The page-side resolver translates each index
// into the actual call. Keeping this in Node makes it easy to iterate and log.
const DIAGNOSE_STRATEGIES = [
  'ConversationMsgs.loadEarlierMsgs(chat, chat.msgs)',
  'ConversationMsgs.loadEarlierMsgs(chat)',
  'chat.loadEarlierMsgs()',
  'chat.msgs.loadEarlierMsgs()',
  'chat.msgs.loadMore()',
  "Msg.search('', 1, 50, chatId)",
  'ConversationMsgs.loadRecentMsgs(chat)',
  'ConversationMsgs.loadRecentMsgs(chat, chat.msgs)',
  'ConversationMsgs.loadMsgsPromiseLoop(chat)',
  'ConversationMsgs.loadMsgsPromiseLoop(chat, chat.msgs)',
  'chat.waitForChatLoading() then loadEarlierMsgs',
  'chat.waitForChatLoading() then loadRecentMsgs',
  'chat.waitForChatLoading() then loadMsgsPromiseLoop',
  'loadMsgsPromiseLoop(chat, null, chat.msgs, null, "before", {}, true, null)',
  'loadMsgsPromiseLoop(chat, {}, chat.msgs, {}, "before", {}, true, {})',
  'loadMsgsPromiseLoop(chat, undefined, chat.msgs, undefined, "before", {}, true, undefined)',
  // Cmd.* strategies — potentially destructive to eval context (UI navigation).
  // Included here because (a) per-strategy isolation protects us, and
  // (b) user confirmed read-receipt side effects are acceptable for this target.
  'Cmd.openChatAt(chat, lastReceivedKey)',
  'Cmd.openChatBottom(chat)',
  'Cmd.openChatFromUnread(chat)',
  // New: pass earliest-loaded msg as anchor (l). This is the most-likely-correct
  // signature based on partial source ("before" direction needs a boundary).
  'loadMsgsPromiseLoop(chat, null, chat.msgs, earliestMsg, "before", wamStub, true, null)',
  'loadMsgsPromiseLoop(chat, null, chat.msgs, earliestMsg.id, "before", wamStub, true, null)',
  'loadMsgsPromiseLoop(chat, null, chat.msgs, 50, "before", wamStub, true, null)',
  // AbortSignal as `a` (2nd arg needs addEventListener when truthy)
  'loadMsgsPromiseLoop(chat, abortSignal, chat.msgs, earliestMsg, "before", wamStub, true, null)',
  // Round 3: based on insight that msgLoadState.parent/collection are undefined
  // (the chat.msgs collection is not properly wired up in this session).
  'chat.msgs.initializeFromCache()',
  'patch msgLoadState.parent+collection, then loadEarlierMsgs',
  'Cmd.openChatBottom(chat, chat.lastReceivedKey)',
  'Cmd.openChatBottom(chat, null)',
  'Cmd.openChatAt(chat, chat)',
  'Cmd.scrollChatToBottom(chat)',
  'Cmd.scrollChatHeight(chat, -5000)',
  // Round 4: JACKPOT — Cmd.openChatBottom takes an OBJECT arg { chat, chatEntryPoint, threadId },
  // not positional. Library calls it wrong. This is the real signature.
  'Cmd.openChatBottom({ chat })',
  'Cmd.openChatBottom({ chat, chatEntryPoint: "CHAT_LIST" })',
  'await openChatBottom({chat}) then loadEarlierMsgs(chat, chat.msgs)',
  'await openChatBottom({chat}) then loadMsgsPromiseLoop with null dummies',
  // Round 5: bypass the scrollChatToBottom hang by calling the private
  // $CmdImpl$p_1 method directly — that is where the actual chat-open
  // logic lives. openChatBottom is just $CmdImpl$p_1(...).then(scrollChatToBottom).
  'Cmd.$CmdImpl$p_1({ chat, msgContext: null, chatEntryPoint: "CHAT_LIST" })',
  'Cmd.$CmdImpl$p_1 then wait 3s then getAllMsgs',
  'Cmd.$CmdImpl$p_1 then wait 5s then loadEarlierMsgs',
];

// ─── Diagnose: probe internal WA Web API surface ──────────────────────────
// Runs in pupPage context. Enumerates candidates and attempts each load strategy
// with PER-STRATEGY ISOLATION — each strategy runs in its own pupPage.evaluate
// call so that a strategy which crashes the execution context (e.g. via UI
// navigation) does not hide results for the other strategies.
//
// SAFETY: we explicitly avoid Store.Cmd.* calls (openChatAt, openChatBottom,
// focusChat). Those are UI-level commands that navigate the WA Web viewport
// to the chat — they can trigger React re-render (destroying the eval context)
// AND may fire read receipts on messages the user hasn't read yet. All probes
// here stay below the UI layer, only touching data loaders.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function diagnose(client: any, phone: string): Promise<void> {
  const chatId = `${phone}@c.us`;
  log(`diagnose: probing chat ${chatId}`);

  // ─── Phase A: enumeration (one evaluate call) ───────────────────────────
  log('diagnose: phase A — enumerating store/chat keys and signatures');
  await injectEsbuildShims(client);
  const enumeration = await client.pupPage.evaluate(async (chatId: string) => {
    // Helper: enumerate keys including prototype chain
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enumKeys = (obj: any): string[] => {
      if (!obj) return [];
      const keys = new Set<string>();
      let cur = obj;
      let depth = 0;
      while (cur && cur !== Object.prototype && depth < 5) {
        for (const k of Object.getOwnPropertyNames(cur)) keys.add(k);
        cur = Object.getPrototypeOf(cur);
        depth++;
      }
      return [...keys].filter((k) => !k.startsWith('_') && k !== 'constructor').sort();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, any> = {
      storeChatOk: false,
      storeConversationMsgsKeys: [],
      chatMethodKeys: [],
      chatMsgsMethodKeys: [],
      chatMsgsInitialCount: -1,
      chatFirstTimestamp: null,
      chatLastTimestamp: null,
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const S = (window as any).Store;
      const chatWid = S.WidFactory.createWid(chatId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let chat: any = S.Chat.get(chatWid);
      if (!chat) {
        const created = await S.FindOrCreateChat.findOrCreateLatestChat(chatWid);
        chat = created?.chat;
      }
      if (!chat) {
        out.error = 'chat not found';
        return out;
      }
      out.storeChatOk = true;
      out.storeConversationMsgsKeys = enumKeys(S.ConversationMsgs);
      out.chatMethodKeys = enumKeys(chat).filter(
        (k) =>
          k.toLowerCase().includes('msg') ||
          k.toLowerCase().includes('load') ||
          k.toLowerCase().includes('fetch') ||
          k.toLowerCase().includes('earlier')
      );
      out.chatMsgsMethodKeys = enumKeys(chat.msgs).filter(
        (k) =>
          k.toLowerCase().includes('load') ||
          k.toLowerCase().includes('fetch') ||
          k.toLowerCase().includes('earlier') ||
          k.toLowerCase().includes('more')
      );

      const currentMsgs = chat.msgs.getModelsArray();
      out.chatMsgsInitialCount = currentMsgs.length;
      if (currentMsgs.length > 0) {
        out.chatFirstTimestamp = currentMsgs[0]?.t ?? null;
        out.chatLastTimestamp = currentMsgs[currentMsgs.length - 1]?.t ?? null;
      }

      // Dump function signatures for inspection (first 1200 chars of source).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fnSig = (f: any): string => {
        if (typeof f !== 'function') return `<${typeof f}>`;
        const s = String(f);
        return `arity=${f.length} src=${s.slice(0, 1200).replace(/\s+/g, ' ')}`;
      };
      out.signatures = {
        loadEarlierMsgs: fnSig(S.ConversationMsgs.loadEarlierMsgs),
        loadRecentMsgs: fnSig(S.ConversationMsgs.loadRecentMsgs),
        loadMsgsPromiseLoop: fnSig(S.ConversationMsgs.loadMsgsPromiseLoop),
        chat_waitForChatLoading: fnSig(chat.waitForChatLoading),
        chat_getAllMsgs: fnSig(chat.getAllMsgs),
        chat_sortMsgs: fnSig(chat.sortMsgs),
        chat_hasPreloaded_val: String(chat.hasPreloaded),
        chat_msgChunks_val: String(chat.msgChunks),
        chat_lastReceivedKey_val: chat.lastReceivedKey
          ? JSON.stringify({
              _serialized: chat.lastReceivedKey._serialized,
              id: chat.lastReceivedKey.id,
              fromMe: chat.lastReceivedKey.fromMe,
            })
          : 'null',
        chatMsgs_initializeFromCache: fnSig(chat.msgs?.initializeFromCache),
        chatMsgs_replaceMsgsCollection: fnSig(chat.msgs?.replaceMsgsCollection),
        chat_notifyMsgCollectionMerge: fnSig(chat.notifyMsgCollectionMerge),
        Cmd_openChatBottom: S.Cmd ? fnSig(S.Cmd.openChatBottom) : '<no Cmd>',
        Cmd_openChatAt: S.Cmd ? fnSig(S.Cmd.openChatAt) : '<no Cmd>',
        Cmd_scrollChatToBottom: S.Cmd ? fnSig(S.Cmd.scrollChatToBottom) : '<no Cmd>',
        Cmd_scrollChatHeight: S.Cmd ? fnSig(S.Cmd.scrollChatHeight) : '<no Cmd>',
      };

      // Dump chat.msgs full key list (not filtered), msgLoadState contents,
      // and msgChunks info. Also probe Store.Cmd for open-chat commands.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enumAll = (obj: any): string[] => {
        if (!obj) return [];
        const keys = new Set<string>();
        let cur = obj;
        let depth = 0;
        while (cur && cur !== Object.prototype && depth < 5) {
          for (const k of Object.getOwnPropertyNames(cur)) keys.add(k);
          cur = Object.getPrototypeOf(cur);
          depth++;
        }
        return [...keys].filter((k) => !k.startsWith('_') && k !== 'constructor').sort();
      };
      // Lists of strings (JSON-safe).
      out.chatMsgsAllKeys = enumAll(chat.msgs);
      out.msgLoadStateKeys = chat.msgs.msgLoadState
        ? Object.keys(chat.msgs.msgLoadState)
        : null;
      out.msgLoadStateSample = (() => {
        if (!chat.msgs.msgLoadState) return null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s: Record<string, any> = {};
        for (const k of Object.keys(chat.msgs.msgLoadState)) {
          const v = chat.msgs.msgLoadState[k];
          const t = typeof v;
          // Only copy primitive values — skip functions, objects, proxies
          // (which may not be JSON-serializable and can crash puppeteer evaluate).
          if (t === 'string' || t === 'number' || t === 'boolean' || v === null) s[k] = v;
          else s[k] = `<${t}>`;
        }
        return s;
      })();
      out.msgChunksCount = chat.msgChunks
        ? typeof chat.msgChunks.length === 'number'
          ? chat.msgChunks.length
          : chat.msgChunks.size ?? null
        : null;
      out.storeCmdKeys = S.Cmd
        ? enumAll(S.Cmd).filter(
            (k) =>
              k.toLowerCase().includes('open') ||
              k.toLowerCase().includes('chat') ||
              k.toLowerCase().includes('focus') ||
              k.toLowerCase().includes('msg')
          )
        : null;
      out.getAllMsgsInitialCount =
        typeof chat.getAllMsgs === 'function' ? chat.getAllMsgs().length : null;

      // Probe window.Store.Msg — the global message collection. Count total
      // messages matching our chatId, to see if more exist in memory than just
      // the chat.msgs view.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allMsgs: any[] = S.Msg.getModelsArray();
        out.storeMsgTotal = allMsgs.length;
        out.storeMsgForChat = allMsgs.filter((m) => {
          const remote = m.id?.remote?._serialized ?? m.id?.remote?.toString?.();
          return remote === chatId;
        }).length;
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        out.storeMsgError = String((err as any)?.message ?? err);
      }

      // Scan module registry for any message-loading related modules we may
      // have missed. The library uses `window.mR.findModule(name)` but there
      // might be multiple hits.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mR = (window as any).mR;
        if (mR?.modules) {
          const modNames = Object.keys(mR.modules).filter((n) => {
            const lower = n.toLowerCase();
            return (
              lower.includes('loadmessage') ||
              lower.includes('loadmsg') ||
              lower.includes('chatload') ||
              lower.includes('msghistor') ||
              lower.includes('msgfetch')
            );
          });
          out.mRMatchingModules = modNames;
        } else {
          out.mRMatchingModules = 'window.mR.modules not available';
        }
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        out.mRError = String((err as any)?.message ?? err);
      }
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out.error = String((e as any)?.message ?? e);
    }

    // Ensure the return value is JSON-serializable — if anything in `out` is
    // a proxy or has circular refs, JSON.stringify/parse roundtrip will catch
    // it here rather than making pupPage.evaluate silently return undefined.
    try {
      return JSON.parse(JSON.stringify(out));
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {
        _serializeError: String((err as any)?.message ?? err),
        _keys: Object.keys(out),
      };
    }
  }, chatId);

  // ─── Phase B: per-strategy isolation ────────────────────────────────────
  // Each strategy runs in its own evaluate call. If one crashes the context
  // (e.g. via UI navigation), only that single strategy's result is lost —
  // subsequent strategies re-resolve the chat and continue in a fresh context.
  log(`diagnose: phase B — running ${DIAGNOSE_STRATEGIES.length} strategies in isolation`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategyResults: any[] = [];

  for (let i = 0; i < DIAGNOSE_STRATEGIES.length; i++) {
    const name = DIAGNOSE_STRATEGIES[i];
    log(`diagnose:   [${i + 1}/${DIAGNOSE_STRATEGIES.length}] ${name}`);
    try {
      await injectEsbuildShims(client);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await client.pupPage.evaluate(
        async (chatId: string, strategyIdx: number) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const S = (window as any).Store;
          const chatWid = S.WidFactory.createWid(chatId);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let chat: any = S.Chat.get(chatWid);
          if (!chat) {
            const created = await S.FindOrCreateChat.findOrCreateLatestChat(chatWid);
            chat = created?.chat;
          }
          if (!chat) return { ok: false, error: 'chat not found' };

          const msgCount = () => ({
            view: chat.msgs.getModelsArray().length,
            all: typeof chat.getAllMsgs === 'function' ? chat.getAllMsgs().length : -1,
          });

          // Build the strategy function based on index — keeps this self-contained
          // so the evaluate callback has no closure dependencies from Node.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let fn: () => Promise<any>;
          switch (strategyIdx) {
            case 0:
              fn = async () => S.ConversationMsgs.loadEarlierMsgs(chat, chat.msgs);
              break;
            case 1:
              fn = async () => S.ConversationMsgs.loadEarlierMsgs(chat);
              break;
            case 2:
              fn = async () => {
                if (typeof chat.loadEarlierMsgs !== 'function')
                  throw new Error('not a function');
                return chat.loadEarlierMsgs();
              };
              break;
            case 3:
              fn = async () => {
                if (typeof chat.msgs.loadEarlierMsgs !== 'function')
                  throw new Error('not a function');
                return chat.msgs.loadEarlierMsgs();
              };
              break;
            case 4:
              fn = async () => {
                if (typeof chat.msgs.loadMore !== 'function')
                  throw new Error('not a function');
                return chat.msgs.loadMore();
              };
              break;
            case 5:
              fn = async () => {
                const r = await S.Msg.search('', 1, 50, chatId);
                return r?.messages?.length ?? 0;
              };
              break;
            case 6:
              fn = async () => S.ConversationMsgs.loadRecentMsgs(chat);
              break;
            case 7:
              fn = async () => S.ConversationMsgs.loadRecentMsgs(chat, chat.msgs);
              break;
            case 8:
              fn = async () => S.ConversationMsgs.loadMsgsPromiseLoop(chat);
              break;
            case 9:
              fn = async () => S.ConversationMsgs.loadMsgsPromiseLoop(chat, chat.msgs);
              break;
            case 10:
              fn = async () => {
                await chat.waitForChatLoading();
                return S.ConversationMsgs.loadEarlierMsgs(chat, chat.msgs);
              };
              break;
            case 11:
              fn = async () => {
                await chat.waitForChatLoading();
                return S.ConversationMsgs.loadRecentMsgs(chat);
              };
              break;
            case 12:
              fn = async () => {
                await chat.waitForChatLoading();
                return S.ConversationMsgs.loadMsgsPromiseLoop(chat);
              };
              break;
            case 13:
              fn = async () =>
                S.ConversationMsgs.loadMsgsPromiseLoop(
                  chat, null, chat.msgs, null, 'before', {}, true, null
                );
              break;
            case 14:
              fn = async () =>
                S.ConversationMsgs.loadMsgsPromiseLoop(
                  chat, {}, chat.msgs, {}, 'before', {}, true, {}
                );
              break;
            case 15:
              fn = async () =>
                S.ConversationMsgs.loadMsgsPromiseLoop(
                  chat, undefined, chat.msgs, undefined, 'before', {}, true, undefined
                );
              break;
            case 16:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.openChatAt !== 'function')
                  throw new Error('Cmd.openChatAt not a function');
                return await S.Cmd.openChatAt(chat, chat.lastReceivedKey);
              };
              break;
            case 17:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.openChatBottom !== 'function')
                  throw new Error('Cmd.openChatBottom not a function');
                return await S.Cmd.openChatBottom(chat);
              };
              break;
            case 18:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.openChatFromUnread !== 'function')
                  throw new Error('Cmd.openChatFromUnread not a function');
                return await S.Cmd.openChatFromUnread(chat);
              };
              break;
            case 19:
              fn = async () => {
                const msgs = chat.msgs.getModelsArray();
                if (msgs.length === 0) throw new Error('no messages to use as anchor');
                const earliest = msgs[0];
                return S.ConversationMsgs.loadMsgsPromiseLoop(
                  chat, null, chat.msgs, earliest, 'before', {}, true, null
                );
              };
              break;
            case 20:
              fn = async () => {
                const msgs = chat.msgs.getModelsArray();
                if (msgs.length === 0) throw new Error('no messages to use as anchor');
                const earliest = msgs[0];
                return S.ConversationMsgs.loadMsgsPromiseLoop(
                  chat, null, chat.msgs, earliest.id, 'before', {}, true, null
                );
              };
              break;
            case 21:
              fn = async () =>
                S.ConversationMsgs.loadMsgsPromiseLoop(
                  chat, null, chat.msgs, 50, 'before', {}, true, null
                );
              break;
            case 22:
              fn = async () => {
                const msgs = chat.msgs.getModelsArray();
                if (msgs.length === 0) throw new Error('no messages to use as anchor');
                const earliest = msgs[0];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const ac: any = new (window as any).AbortController();
                return S.ConversationMsgs.loadMsgsPromiseLoop(
                  chat, ac.signal, chat.msgs, earliest, 'before', {}, true, null
                );
              };
              break;
            case 23:
              fn = async () => {
                if (typeof chat.msgs.initializeFromCache !== 'function')
                  throw new Error('initializeFromCache not a function');
                return await chat.msgs.initializeFromCache();
              };
              break;
            case 24:
              fn = async () => {
                // Patch the Backbone wiring: msgLoadState.parent and .collection
                // are undefined in a cold chat. Set them to chat.msgs and try load.
                chat.msgs.msgLoadState.parent = chat.msgs;
                chat.msgs.msgLoadState.collection = chat.msgs;
                return S.ConversationMsgs.loadEarlierMsgs(chat, chat.msgs);
              };
              break;
            case 25:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.openChatBottom !== 'function')
                  throw new Error('Cmd.openChatBottom not a function');
                return await S.Cmd.openChatBottom(chat, chat.lastReceivedKey);
              };
              break;
            case 26:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.openChatBottom !== 'function')
                  throw new Error('Cmd.openChatBottom not a function');
                return await S.Cmd.openChatBottom(chat, null);
              };
              break;
            case 27:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.openChatAt !== 'function')
                  throw new Error('Cmd.openChatAt not a function');
                return await S.Cmd.openChatAt(chat, chat);
              };
              break;
            case 28:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.scrollChatToBottom !== 'function')
                  throw new Error('Cmd.scrollChatToBottom not a function');
                return await S.Cmd.scrollChatToBottom(chat);
              };
              break;
            case 29:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.scrollChatHeight !== 'function')
                  throw new Error('Cmd.scrollChatHeight not a function');
                return await S.Cmd.scrollChatHeight(chat, -5000);
              };
              break;
            case 30:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.openChatBottom !== 'function')
                  throw new Error('Cmd.openChatBottom not a function');
                return await S.Cmd.openChatBottom({ chat });
              };
              break;
            case 31:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.openChatBottom !== 'function')
                  throw new Error('Cmd.openChatBottom not a function');
                return await S.Cmd.openChatBottom({ chat, chatEntryPoint: 'CHAT_LIST' });
              };
              break;
            case 32:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.openChatBottom !== 'function')
                  throw new Error('Cmd.openChatBottom not a function');
                await S.Cmd.openChatBottom({ chat });
                // Wait a beat for the open to settle, then try load
                await new Promise((r) => setTimeout(r, 2000));
                return S.ConversationMsgs.loadEarlierMsgs(chat, chat.msgs);
              };
              break;
            case 33:
              fn = async () => {
                if (!S.Cmd || typeof S.Cmd.openChatBottom !== 'function')
                  throw new Error('Cmd.openChatBottom not a function');
                await S.Cmd.openChatBottom({ chat });
                await new Promise((r) => setTimeout(r, 2000));
                return S.ConversationMsgs.loadMsgsPromiseLoop(
                  chat, null, chat.msgs, null, 'before', {}, true, null
                );
              };
              break;
            case 34:
              fn = async () => {
                // Call the private $CmdImpl$p_1 method directly, bypassing
                // the scrollChatToBottom step that hangs in headless.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const impl = (S.Cmd as any).$CmdImpl$p_1;
                if (typeof impl !== 'function')
                  throw new Error('$CmdImpl$p_1 not a function');
                // Need to bind `this` to S.Cmd since it's a method.
                return await impl.call(S.Cmd, {
                  chat,
                  msgContext: null,
                  chatEntryPoint: 'CHAT_LIST',
                });
              };
              break;
            case 35:
              // Read-only state probe — runs AFTER strategy 34's $CmdImpl$p_1 call.
              // If strategy 34 triggered background loading, this should see the
              // state change (msgChunks populated, msgLoadState rewired, etc).
              fn = async () => {
                return {
                  viewCount: chat.msgs.getModelsArray().length,
                  allCount: chat.getAllMsgs().length,
                  chunksCount: chat.msgChunks?.length ?? 0,
                  hasPreloaded: chat.hasPreloaded,
                  loadingEarlier: chat.msgs.msgLoadState.__x_isLoadingEarlierMsgs,
                  loadingRecent: chat.msgs.msgLoadState.__x_isLoadingRecentMsgs,
                  noEarlier: chat.msgs.msgLoadState.__x_noEarlierMsgs,
                  parentWired: chat.msgs.msgLoadState.parent !== undefined,
                  collectionWired: chat.msgs.msgLoadState.collection !== undefined,
                  msgLoadStateRevision: chat.msgs.msgLoadState.revisionNumber,
                };
              };
              break;
            case 36:
              // Wait 5s then probe state again — in case loading is still in flight.
              fn = async () => {
                const t0 = Date.now();
                const timeline: Array<{
                  t: number;
                  all: number;
                  chunks: number;
                  loading: boolean;
                }> = [];
                let last = -1;
                while (Date.now() - t0 < 8000) {
                  const all = chat.getAllMsgs().length;
                  const chunks = chat.msgChunks?.length ?? 0;
                  const loading =
                    chat.msgs.msgLoadState.__x_isLoadingEarlierMsgs ||
                    chat.msgs.msgLoadState.__x_isLoadingRecentMsgs;
                  if (all !== last) {
                    timeline.push({ t: Date.now() - t0, all, chunks, loading });
                    last = all;
                  }
                  await new Promise((r) => setTimeout(r, 500));
                }
                return { timeline, finalAllCount: chat.getAllMsgs().length };
              };
              break;
            default:
              return { ok: false, error: `unknown strategy index: ${strategyIdx}` };
          }

          const before = msgCount();
          try {
            // Race fn() against a 15-second timeout to prevent hangs.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ret = await Promise.race([
              fn(),
              new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('timeout 15s')), 15000)
              ),
            ]);
            const after = msgCount();
            return {
              ok: true,
              before,
              after,
              delta: { view: after.view - before.view, all: after.all - before.all },
              returnType:
                ret === undefined
                  ? 'undefined'
                  : Array.isArray(ret)
                    ? `array(${ret.length})`
                    : typeof ret,
            };
          } catch (e) {
            return {
              ok: false,
              before,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              error: String((e as any)?.message ?? e).slice(0, 300),
            };
          }
        },
        chatId,
        i
      );
      strategyResults.push({ name, ...(res ?? { ok: false, error: 'evaluate returned undefined (context destroyed)' }) });
      if (res === undefined) {
        log(`diagnose:     ↳ context destroyed — continuing`);
      } else if (res.ok) {
        log(`diagnose:     ↳ ok delta=${JSON.stringify(res.delta)}`);
      } else {
        log(`diagnose:     ↳ error: ${String(res.error).slice(0, 100)}`);
      }
    } catch (err) {
      const em = (err as Error).message ?? String(err);
      strategyResults.push({ name, ok: false, error: `host-side: ${em}` });
      log(`diagnose:     ↳ host error: ${em.slice(0, 100)}`);
    }
  }

  const result = { ...enumeration, strategies: strategyResults };
  log('diagnose: results ↓');
  console.log(JSON.stringify(result, null, 2));
}

// ─── fetchMessagesCompat ──────────────────────────────────────────────────
// Custom message paginator that bypasses the broken chat.fetchMessages() in
// whatsapp-web.js v1.34.6.
//
// Why: WhatsApp Web's internal `WAWebChatLoadMessages.loadEarlierMsgs` no
// longer works (throws "Cannot read properties of undefined (reading
// 'waitForChatLoading')"). Tracked at github.com/pedroslopez/whatsapp-web.js
// issue #201706, fix in PR #201705. Library hasn't released the fix yet.
//
// Approach (mirrors PR #201705):
//   1. Use `WAWebDBMessageFindLocal` module instead of WAWebChatLoadMessages.
//   2. Call `msgFindByDirection({anchor, count, direction:'before'})` (or
//      `msgFindBefore` as fallback).
//   3. Anchor is `chat.lastReceivedKey` (most recent msg) on first call,
//      then the oldest loaded msg's id for subsequent paginating calls.
//   4. Convert serialized ids to MsgKey via `WAWebMsgKey.fromString`.
//   5. Resolve raw msg objects to model instances via `WAWebCollections.Msg`.
//
// Returns: array of message-model-shaped objects, sorted earliest → latest.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchMessagesCompat(client: any, chatId: string, limit: number): Promise<any[]> {
  await injectEsbuildShims(client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgs: any[] = await client.pupPage.evaluate(
    async (chatId: string, limit: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const W = window as any;
      const S = W.Store;
      const msgFindLocal = W.require('WAWebDBMessageFindLocal');
      const WAWebMsgKey = W.require('WAWebMsgKey');
      const MsgStore = W.require('WAWebCollections').Msg;

      const chatWid = S.WidFactory.createWid(chatId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let chat: any = S.Chat.get(chatWid);
      if (!chat) {
        const created = await S.FindOrCreateChat.findOrCreateLatestChat(chatWid);
        chat = created?.chat;
      }
      if (!chat) throw new Error('chat not found: ' + chatId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const findBefore = async (anchorKey: any, count: number) => {
        if (typeof msgFindLocal.msgFindByDirection === 'function') {
          return await msgFindLocal.msgFindByDirection({
            anchor: anchorKey,
            count,
            direction: 'before',
          });
        }
        return await msgFindLocal.msgFindBefore({ anchor: anchorKey, count });
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toMsgKey = (id: any) => {
        if (!id) return null;
        if (id instanceof WAWebMsgKey) return id;
        const s = typeof id === 'string' ? id : id._serialized || id?.toString?.();
        return s ? WAWebMsgKey.fromString(s) : null;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toMsgModels = (rawMessages: any[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out: any[] = [];
        for (const m of rawMessages) {
          if (m && typeof m.serialize === 'function') {
            // Already a model. Ensure it's in the collection so future
            // Store.Msg.get(id) lookups (e.g. from getMessageById) hit cache.
            try {
              MsgStore.add(m, { merge: true });
            } catch {
              /* ignore — not always addable */
            }
            out.push(m);
            continue;
          }
          const serialized =
            m?.id?._serialized || (typeof m === 'string' ? m : null);
          let model =
            (serialized && MsgStore.get(serialized)) ||
            (m?.id && MsgStore.get(m.id._serialized || m.id)) ||
            null;
          if (!model && m && MsgStore.modelClass) {
            // Use MsgStore.add() — this both creates the model and registers
            // it in the collection. Backbone's add() returns the model when
            // adding a single item.
            try {
              const added = MsgStore.add(m, { merge: true });
              model = Array.isArray(added) ? added[0] : added;
            } catch (e) {
              try {
                model = new MsgStore.modelClass(m);
              } catch {
                model = null;
              }
            }
          }
          if (model) out.push(model);
        }
        return out;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dedupeByMsgId = (arr: any[]) => {
        const seen = new Set();
        return arr.filter((m) => {
          const key = m.id?._serialized;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msgFilter = (m: any) => !m.isNotification;

      // Manual serialization: WA Web model.serialize() output drops some fields
      // we need (notably top-level `t`, `fromMe`, hasMedia, etc), so we extract
      // them directly from the model + its `_data` (the underlying msg model).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const extractFields = (m: any) => {
        // The "model" can be the message instance itself or a data object;
        // be defensive about both forms.
        const id = m.id || m._data?.id;
        const idSerialized =
          id?._serialized || id?.toString?.() || String(id ?? '');
        // Timestamp lives in `t` on WA Web's internal Msg model
        const t = typeof m.t === 'number' ? m.t : typeof m._data?.t === 'number' ? m._data.t : 0;
        const body =
          m.body ?? m._data?.body ?? m.caption ?? m._data?.caption ?? null;
        const type = m.type ?? m._data?.type ?? 'unknown';
        const fromObj = m.from ?? m._data?.from;
        const toObj = m.to ?? m._data?.to;
        const fromSer =
          typeof fromObj === 'string' ? fromObj : fromObj?._serialized ?? null;
        const toSer = typeof toObj === 'string' ? toObj : toObj?._serialized ?? null;
        const fromMe = !!(id?.fromMe ?? m._data?.id?.fromMe ?? m.fromMe);
        // Media-related — WA Web stores them on the model directly when present
        const mimetype = m.mimetype ?? m._data?.mimetype ?? null;
        const filename = m.filename ?? m._data?.filename ?? null;
        const size = m.size ?? m._data?.size ?? null;
        const mediaKey = m.mediaKey ?? m._data?.mediaKey ?? null;
        const hasMedia = !!(mimetype || mediaKey || m.isMedia);
        const isForwarded = !!(m.isForwarded ?? m._data?.isForwarded);
        const quotedStanzaID =
          m.quotedStanzaID ?? m._data?.quotedStanzaID ?? null;
        return {
          id: idSerialized,
          t,
          fromMe,
          type,
          body,
          from: fromSer,
          to: toSer,
          hasMedia,
          mimetype,
          filename,
          size: typeof size === 'number' ? size : null,
          isForwarded,
          quotedStanzaID,
        };
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let msgs: any[] = chat.msgs.getModelsArray().filter(msgFilter);
      const finite = Number.isFinite(limit);

      if (finite) {
        // Bounded fetch: fetch (limit-1) before the lastReceivedKey, then add
        // the anchor message itself, dedupe, sort, slice to limit.
        const anchorSerialized = chat.lastReceivedKey?.toString?.();
        if (!anchorSerialized) {
          msgs.sort((a, b) => (a.t > b.t ? 1 : -1));
          return msgs.slice(-Math.min(limit, msgs.length)).map(extractFields);
        }
        const fetchCount = Math.max(0, limit - 1);
        const anchorKey = toMsgKey(anchorSerialized);
        const result = await findBefore(anchorKey, fetchCount);
        const rawMessages = Array.isArray(result) ? result : result?.messages || [];
        if (result?.status === 404 && (!rawMessages || !rawMessages.length)) {
          return [];
        }
        let loaded = toMsgModels(rawMessages);
        const anchorMsg = MsgStore.get(anchorSerialized);
        let merged = [...loaded, ...(anchorMsg ? [anchorMsg] : [])];
        merged = merged.filter((m) => !m.isNotification);
        merged.sort((a, b) => (a.t > b.t ? 1 : -1));
        merged = dedupeByMsgId(merged);
        if (merged.length > limit) merged = merged.slice(-limit);
        return merged.map(extractFields);
      }

      // Infinite fetch: paginate batch-by-batch backwards using the oldest
      // loaded msg as anchor, until findBefore returns empty.
      msgs.sort((a, b) => (a.t > b.t ? 1 : -1));
      const batchCap = 100;
      while (true) {
        const anchor =
          msgs[0]?.id ||
          chat.msgs.getModelsArray()[0]?.id ||
          chat.lastReceivedKey;
        if (!anchor) break;
        const anchorKey = toMsgKey(anchor);
        if (!anchorKey) break;
        const result = await findBefore(anchorKey, batchCap);
        const rawMessages = Array.isArray(result) ? result : result?.messages || [];
        if (result?.status === 404 || !rawMessages.length) break;
        const loadedMessages = toMsgModels(rawMessages);
        if (!loadedMessages.length) break;
        const prevLen = msgs.length;
        msgs = dedupeByMsgId([...loadedMessages.filter(msgFilter), ...msgs]);
        msgs.sort((a, b) => (a.t > b.t ? 1 : -1));
        if (msgs.length === prevLen) break;
        if (loadedMessages.length < batchCap) break;
      }
      return msgs.map(extractFields);
    },
    chatId,
    limit
  );
  return msgs;
}

// ─── downloadMediaCompat ──────────────────────────────────────────────────
// Custom media downloader that bypasses the broken `msg.downloadMedia({...})`
// internal resolve step in whatsapp-web.js.
//
// Why: wwebjs's `Message.downloadMedia()` first checks `msg.mediaData.mediaStage`
// and if it's not 'RESOLVED', calls `msg.downloadMedia({downloadEvenIfExpensive:true})`
// to resolve. That internal call hangs in headless mode (probably because the
// mediaStage observer never fires without React UI). For messages loaded via
// our `fetchMessagesCompat` (which uses local DB), the mediaStage is often not
// 'RESOLVED', so we always hit the broken path.
//
// This compat function:
//   1. Looks up the message in Store.Msg.get(id)
//   2. Skips the mediaStage check entirely
//   3. Calls Store.DownloadManager.downloadAndMaybeDecrypt directly with the
//      message's media metadata (directPath, encFilehash, mediaKey, etc.)
//   4. Returns base64 data + mimetype
//
// Returns null if the message is missing or has no media metadata.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function downloadMediaCompat(client: any, msgId: string): Promise<{
  data: string;
  mimetype: string | null;
  filename: string | null;
} | null> {
  await injectEsbuildShims(client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await client.pupPage.evaluate(async (msgId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const W = window as any;
    const S = W.Store;
    const msg = S.Msg.get(msgId);
    if (!msg) return null;

    // Pull media metadata from the model. The msg may store these directly or
    // under msg.mediaObject / msg.mediaData depending on internal version.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md: any = msg.mediaData || msg;
    const directPath = md.directPath ?? msg.directPath ?? null;
    const encFilehash = md.encFilehash ?? msg.encFilehash ?? null;
    const filehash = md.filehash ?? msg.filehash ?? null;
    const mediaKey = md.mediaKey ?? msg.mediaKey ?? null;
    const mediaKeyTimestamp = md.mediaKeyTimestamp ?? msg.mediaKeyTimestamp ?? null;
    const type = msg.type ?? md.type ?? null;
    const mimetype = md.mimetype ?? msg.mimetype ?? null;
    const filename = md.filename ?? msg.filename ?? null;

    if (!directPath || !mediaKey) {
      return null; // can't download without these
    }

    const mockQpl = {
      addAnnotations: function () {
        return this;
      },
      addPoint: function () {
        return this;
      },
    };

    try {
      const decryptedMedia = await S.DownloadManager.downloadAndMaybeDecrypt({
        directPath,
        encFilehash,
        filehash,
        mediaKey,
        mediaKeyTimestamp,
        type,
        signal: new AbortController().signal,
        downloadQpl: mockQpl,
      });
      const data = await W.WWebJS.arrayBufferToBase64Async(decryptedMedia);
      return { data, mimetype, filename };
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error('downloadAndMaybeDecrypt: ' + ((e as any)?.message ?? String(e)));
    }
  }, msgId);
}

// ─── Phase 1: fetch & persist messages ────────────────────────────────────
async function phase1(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  db: Database.Database,
  args: Args,
  runId: number
): Promise<{ total: number; newRows: number }> {
  const chatId = `${args.phone}@c.us`;
  log(`phase 1: target chat ${chatId}`);

  // READ-ONLY lookup — does not open the chat UI or fire read receipts.
  const chat = await client.getChatById(chatId);
  if (!chat) die(`chat not found: ${chatId}`);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO messages (
      id, chat_id, phone_number, from_me, timestamp, type, body,
      has_media, media_mimetype, media_filename, media_size,
      media_downloaded, media_path, media_error,
      quoted_msg_id, is_forwarded, raw_json
    ) VALUES (
      @id, @chat_id, @phone_number, @from_me, @timestamp, @type, @body,
      @has_media, @media_mimetype, @media_filename, @media_size,
      0, NULL, NULL,
      @quoted_msg_id, @is_forwarded, @raw_json
    )
  `);

  // Smart resume: if DB already has N messages for this phone, start the first
  // fetchMessages with limit = N + batchStep. This collapses what would otherwise
  // be ceil(N / batchStep) wasted iterations (each re-requesting already-known
  // messages) into a single round. INSERT OR IGNORE dedups server replay.
  const existing = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM messages WHERE phone_number = ?`)
      .get(args.phone) as { c: number }
  ).c;
  let limit = existing > 0 ? existing + args.batchStep : args.batchStep;
  if (existing > 0) {
    log(`phase 1: found ${existing} existing rows for ${args.phone} → smart-resume limit=${limit}`);
  }

  let prevFetched = 0;
  let totalNew = 0;
  let iteration = 0;

  while (true) {
    iteration++;
    if (args.maxMessages > 0 && limit > args.maxMessages) limit = args.maxMessages;

    log(`phase 1: batch #${iteration} — requesting limit=${limit}`);
    const t0 = Date.now();
    // READ-ONLY: uses our compat paginator (bypasses broken Chat.fetchMessages
    // in v1.34.6). Internally calls msgFindByDirection / msgFindBefore via
    // direct WAWebDBMessageFindLocal access. Does not open chat UI or mark
    // messages as read.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgs: any[] = await fetchMessagesCompat(client, chatId, limit);
    const fetchMs = Date.now() - t0;

    log(`phase 1: batch #${iteration} — fetched ${msgs.length} messages in ${fetchMs}ms`);

    // Persist in a single transaction for speed.
    let newRowsThisBatch = 0;
    const tx = db.transaction((rows: MessageRow[]) => {
      for (const r of rows) {
        const res = insert.run(r);
        if (res.changes > 0) newRowsThisBatch++;
      }
    });
    const rows: MessageRow[] = msgs.map((m) => toRow(m, args.phone, chatId));
    tx(rows);
    totalNew += newRowsThisBatch;
    log(`phase 1: batch #${iteration} — ${newRowsThisBatch} new rows (cumulative new: ${totalNew})`);

    // Update run progress checkpoint.
    db.prepare(
      `UPDATE extraction_runs SET total_messages = ?, new_messages = ? WHERE id = ?`
    ).run(msgs.length, totalNew, runId);

    // Stop conditions:
    //   a) fetch returned same count as previous → server has no more old messages
    //   b) we've hit user-supplied max
    if (msgs.length === prevFetched) {
      log('phase 1: no new messages loaded → reached beginning of history');
      break;
    }
    if (args.maxMessages > 0 && msgs.length >= args.maxMessages) {
      log(`phase 1: reached --max-messages=${args.maxMessages}`);
      break;
    }
    prevFetched = msgs.length;
    limit += args.batchStep;

    // Throttle protection.
    const pauseMs = jitter(2000);
    log(`phase 1: sleeping ${pauseMs}ms before next batch`);
    await sleep(pauseMs);
  }

  return { total: prevFetched, newRows: totalNew };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(m: any, phone: string, chatId: string): MessageRow {
  // m comes from fetchMessagesCompat.extractFields() — already flat shape:
  // { id, t, fromMe, type, body, from, to, hasMedia, mimetype, filename,
  //   size, isForwarded, quotedStanzaID }
  const hasMedia = !!m.hasMedia;
  const rawCopy: Record<string, unknown> = {
    id: m.id,
    t: m.t,
    fromMe: m.fromMe,
    type: m.type,
    body: m.body,
    from: m.from,
    to: m.to,
    hasMedia: m.hasMedia,
    mimetype: m.mimetype,
    filename: m.filename,
    size: m.size,
    isForwarded: m.isForwarded,
    quotedStanzaID: m.quotedStanzaID,
  };

  return {
    id: m.id,
    chat_id: chatId,
    phone_number: phone,
    from_me: m.fromMe ? 1 : 0,
    timestamp: typeof m.t === 'number' ? m.t : 0,
    type: m.type ?? 'unknown',
    body: m.body ?? null,
    has_media: hasMedia ? 1 : 0,
    media_mimetype: m.mimetype ?? null,
    media_filename: m.filename ?? null,
    media_size: typeof m.size === 'number' ? m.size : null,
    media_downloaded: 0,
    media_path: null,
    media_error: null,
    quoted_msg_id: m.quotedStanzaID ?? null,
    is_forwarded: m.isForwarded ? 1 : 0,
    raw_json: JSON.stringify(rawCopy),
  };
}

// ─── Phase 2: download media ──────────────────────────────────────────────
async function phase2(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  db: Database.Database,
  args: Args,
  runId: number
): Promise<{ downloaded: number; failed: number }> {
  log('phase 2: querying pending media');
  // Only fetch downloadable media types — exclude 'chat' (false positive from
  // quoted-message metadata) and other non-media types.
  const pending = db
    .prepare(
      `SELECT id, media_mimetype, media_filename
         FROM messages
        WHERE phone_number = ?
          AND has_media = 1
          AND media_downloaded = 0
          AND type IN ('image', 'video', 'audio', 'ptt', 'document', 'sticker')
        ORDER BY timestamp ASC`
    )
    .all(args.phone) as Array<{
    id: string;
    media_mimetype: string | null;
    media_filename: string | null;
  }>;

  log(`phase 2: ${pending.length} pending media items`);
  if (pending.length === 0) return { downloaded: 0, failed: 0 };

  // Pre-warm Store: load messages into window.Store.Msg via our own paginator,
  // because client.getMessageById falls back to Store.Msg.getMessagesById which
  // hangs in headless when the chat is "cold" (same root cause as the broken
  // loadEarlierMsgs). With messages already in Store, getMessageById hits the
  // cache and never falls through to the broken path.
  //
  // We load the total row count for this phone to ensure all pending media
  // are warmed (in case some are old and outside a smaller fetch window).
  const totalForChat = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM messages WHERE phone_number = ?`)
      .get(args.phone) as { c: number }
  ).c;
  const warmCount = Math.max(totalForChat + 50, 1000);
  const chatId = `${args.phone}@c.us`;
  log(`phase 2: pre-warming Store with ${warmCount} messages from ${chatId}`);
  try {
    const warmed = await fetchMessagesCompat(client, chatId, warmCount);
    log(`phase 2: pre-warm loaded ${warmed.length} messages into Store`);

    // Verify a few pending media IDs are actually in Store.Msg now
    const sampleIds = pending.slice(0, 3).map((r) => r.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hits = await client.pupPage.evaluate((ids: string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const S = (window as any).Store;
      return ids.map((id) => {
        const m = S.Msg.get(id);
        return { id, found: !!m };
      });
    }, sampleIds);
    log(`phase 2: pre-warm verification: ${JSON.stringify(hits)}`);
  } catch (err) {
    warn(`phase 2: pre-warm failed: ${(err as Error).message}`);
  }

  const updateOk = db.prepare(
    `UPDATE messages SET media_downloaded = 1, media_path = ?, media_error = NULL WHERE id = ?`
  );
  const updateErr = db.prepare(
    `UPDATE messages SET media_downloaded = 0, media_error = ? WHERE id = ?`
  );

  let downloaded = 0;
  let failed = 0;

  // Per-item timeout: prevents one stuck download from blocking the rest.
  const PHASE2_ITEM_TIMEOUT_MS = 60_000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withTimeout = async (p: Promise<any>, ms: number, label: string): Promise<any> =>
    Promise.race([
      p,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms)
      ),
    ]);

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    const progress = `[${i + 1}/${pending.length}]`;
    try {
      // READ-ONLY: bypasses wwebjs's broken getMessageById + downloadMedia
      // path. Directly looks up message in Store.Msg (pre-warmed above) and
      // calls Store.DownloadManager.downloadAndMaybeDecrypt with extracted
      // media metadata.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const media: any = await withTimeout(
        downloadMediaCompat(client, row.id),
        PHASE2_ITEM_TIMEOUT_MS,
        'downloadMediaCompat'
      );
      if (!media || !media.data) {
        throw new Error('downloadMediaCompat returned empty');
      }
      const ext = extFromMime(media.mimetype ?? row.media_mimetype);
      const fname = `${safeFilename(row.id)}.${ext}`;
      const fpath = join(MEDIA_DIR, fname);
      writeFileSync(fpath, Buffer.from(media.data, 'base64'));
      updateOk.run(join('whatsapp_media', fname), row.id);
      downloaded++;
      log(`phase 2: ${progress} ok → ${fname} (${media.mimetype ?? 'unknown'})`);
    } catch (err) {
      failed++;
      const em = err instanceof Error ? err.message : String(err);
      updateErr.run(em, row.id);
      warn(`phase 2: ${progress} failed id=${row.id}: ${em}`);
    }

    // Checkpoint every 10 downloads.
    if ((i + 1) % 10 === 0) {
      db.prepare(
        `UPDATE extraction_runs SET total_media_downloaded = ? WHERE id = ?`
      ).run(downloaded, runId);
    }

    // Throttle: media downloads are heavier, give WA a breather.
    await sleep(jitter(800));
  }

  db.prepare(`UPDATE extraction_runs SET total_media_downloaded = ? WHERE id = ?`).run(
    downloaded,
    runId
  );
  return { downloaded, failed };
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs();
  log(`extract target: ${args.phone}`);
  log(`db: ${DB_PATH}`);
  log(`media dir: ${MEDIA_DIR}`);
  log(`download media: ${args.downloadMedia}`);
  log(`phase2-only: ${args.phase2Only}`);
  log(`diagnose: ${args.diagnose}`);

  preflight();

  const db = openDb();

  // In --phase2-only mode, bail out early if DB has no pending media — nothing to do.
  // (Skipped in --diagnose mode since diagnose is independent of the DB state.)
  if (args.phase2Only && !args.diagnose) {
    const pending = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM messages
            WHERE phone_number = ? AND has_media = 1 AND media_downloaded = 0`
        )
        .get(args.phone) as { c: number }
    ).c;
    log(`phase2-only: ${pending} pending media items in DB for ${args.phone}`);
    if (pending === 0) {
      log('nothing to do — exiting without launching Chromium');
      db.close();
      return;
    }
  }

  const initialPhase = args.diagnose ? 'diagnose' : args.phase2Only ? 'phase2' : 'phase1';
  const runId = (
    db
      .prepare(
        `INSERT INTO extraction_runs (phone_number, started_at, phase)
         VALUES (?, ?, ?)`
      )
      .run(args.phone, Date.now(), initialPhase) as { lastInsertRowid: number | bigint }
  ).lastInsertRowid as number;

  log('initializing whatsapp-web.js client (headless, reusing LocalAuth)');
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: WA_AUTH_PATH }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      // Default Puppeteer protocolTimeout is 180s. Media downloads stream the
      // full file as base64 over CDP — large videos / audio can exceed that.
      // 10 minutes is generous enough for everything realistic in WhatsApp.
      protocolTimeout: 600_000,
    },
  });

  // Attach observational listeners only. We do NOT register a 'message' handler
  // because we don't want to process any live incoming messages during extraction.
  client.on('qr', () => {
    die(
      'received QR code — session is NOT authenticated.\n' +
        '        This means the LocalAuth dir is missing or corrupt.\n' +
        '        STOP IMMEDIATELY and restore from backup:\n' +
        '          rm -rf .wwebjs_auth && mv .wwebjs_auth.backup-* .wwebjs_auth'
    );
  });
  client.on('auth_failure', (msg: string) => die(`auth_failure: ${msg}`));
  client.on('disconnected', (reason: string) => warn(`disconnected: ${reason}`));

  const ready = new Promise<void>((resolve) => client.on('ready', () => resolve()));

  try {
    await client.initialize();
    log('waiting for client ready...');
    await ready;
    log('client ready');

    // Diagnose mode: probe and exit before any real work
    if (args.diagnose) {
      await diagnose(client, args.phone);
      log('diagnose complete — no extraction performed');
      db.prepare(
        `UPDATE extraction_runs SET phase = 'diagnose', finished_at = ? WHERE id = ?`
      ).run(Date.now(), runId);
      return;
    }

    // Phase 1
    if (args.phase2Only) {
      log('phase 1 skipped (--phase2-only)');
    } else {
      const p1 = await phase1(client, db, args, runId);
      log(`phase 1 complete: total loaded=${p1.total}, new rows=${p1.newRows}`);
      db.prepare(`UPDATE extraction_runs SET phase = 'phase2' WHERE id = ?`).run(runId);
    }

    // Phase 2
    if (args.downloadMedia) {
      const p2 = await phase2(client, db, args, runId);
      log(`phase 2 complete: downloaded=${p2.downloaded}, failed=${p2.failed}`);
    } else {
      log('phase 2 skipped (--no-media)');
    }

    db.prepare(
      `UPDATE extraction_runs SET phase = 'complete', finished_at = ? WHERE id = ?`
    ).run(Date.now(), runId);
    log('extraction complete ✓');
  } catch (err) {
    const em = err instanceof Error ? err.stack || err.message : String(err);
    db.prepare(
      `UPDATE extraction_runs SET phase = 'failed', finished_at = ?, error = ? WHERE id = ?`
    ).run(Date.now(), em, runId);
    console.error(em);
    process.exitCode = 1;
  } finally {
    log('destroying client (clean shutdown)');
    try {
      await client.destroy();
    } catch (err) {
      warn(`client.destroy error: ${(err as Error).message}`);
    }
    db.close();
    log('done');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
