<p align="center">
  <h1 align="center">🤖 Personal AI Assistant</h1>
  <p align="center">
    <strong>Your own intelligent, persistent, multi-gateway AI companion — powered by Claude</strong>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript" />
    <img src="https://img.shields.io/badge/Claude-Sonnet-blueviolet?logo=anthropic" />
    <img src="https://img.shields.io/badge/Node.js-v24-green?logo=node.js" />
    <img src="https://img.shields.io/badge/Gateway-WhatsApp%20%7C%20WebChat-25D366?logo=whatsapp" />
    <img src="https://img.shields.io/badge/Database-SurrealDB%20%2B%20SQLite-orange" />
    <img src="https://img.shields.io/badge/License-MIT-lightgrey" />
  </p>
</p>

---

> **Personal AI Assistant** is a self-hosted, production-grade AI companion that you can chat with via **WhatsApp** or a **Web UI** — with persistent memory, proactive reminders, custom skills, and deep personalization. It's not just a chatbot. It *remembers you*, *checks in on you*, and *grows with you* over time.

---

## ✨ Why This Project?

Most AI assistants forget you the moment the conversation ends. This one doesn't.

- 🧠 **Remembers everything** — facts, preferences, routines, contacts, conversation history
- ⏰ **Proactively reaches out** — scheduled check-ins, prayer reminders, daily summaries
- 💬 **Meets you where you are** — chat via WhatsApp, or a web interface
- 🔌 **Extensible via Skills** — custom behaviors that Claude can call on demand
- 🛠️ **Self-hosted** — you own your data, your context, your assistant

---

## 🚀 Features

### 🧠 Persistent Memory System
- **Graph-based memory** stored in SurrealDB — facts, preferences, routines, personas, contacts
- **Fundamental vs Extended** memory tiers: critical context auto-loads every conversation; extended info recalled on-demand
- **Auto-promotion & demotion**: Frequently accessed memories promote to fundamental; stale ones demote automatically
- **Hybrid search**: Keyword matching + optional vector embeddings + recency decay scoring
- **Conversation summaries**: Every session is summarized and stored for future recall
- **Relationship tracking**: Knows who you know, birthdays, connections, and more

### ⏰ Smart Scheduling & Reminders
- **One-time & recurring cronjobs** with full timezone awareness (WIB / UTC+7 by default)
- **Missed execution detection**: If the server was down, it detects and logs missed fires
- **Proactive daily check-ins**: Randomized throughout the day — mood check, AI news, activity prompts
- **Prayer time reminders** with strict delivery windows (for Muslim users)
- Tell the assistant to remind you of anything: *"Remind me to drink water every 2 hours"*

### 💬 Multi-Gateway Support
| Gateway | Description |
|---------|-------------|
| **WhatsApp** | Full WhatsApp integration via `whatsapp-web.js` with typing simulation |
| **Web Chat** | HTTP + WebSocket real-time web interface |
| *More gateways coming* | Architecture is pluggable — Telegram, Signal, etc. are easily added |

### 🎛️ Built-in Skills
Skills are specialized behaviors that the AI can invoke to handle complex tasks:

| Skill | Description |
|-------|-------------|
| 🗓️ `daily-scheduler` | Auto-generates a randomized daily check-in schedule every morning |
| 🧩 `memory-manager` | Audits, promotes, demotes, and cleans up stored memories |
| 👋 `onboarding-new-friend` | Warm conversational onboarding for new users |
| 📸 `conversation-capture` | Captures important insights mid-conversation and saves them |
| 🏗️ `new-workspace-app` | Scaffolds and deploys a new web app to the server |
| 🖥️ `workspace-info` | Live server status via real-time PM2 commands |
| 🔔 `notify-task-done` | Sends a WhatsApp notification when a Claude Code task finishes |
| ✅ `task-checklist` | Manages a persistent markdown task list |

### 📎 Media Support
- Accepts **images** (JPEG, PNG, GIF, WebP) and **PDFs** in chat
- Claude analyzes media content inline — ask questions about photos, documents, screenshots

### 📊 Token & Cost Tracking
- Per-query token count (input/output)
- USD cost calculation per message
- Accumulated session cost
- View anytime with `/status`

### 🔒 Whitelist-based Access
- WhatsApp messages filtered by phone number whitelist
- Only approved users can interact — your assistant stays private

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Messaging Gateways                  │
│         WhatsApp Gateway  │  Web Chat Gateway        │
└────────────────┬────────────────────────────────────┘
                 │ Message received
                 ▼
┌─────────────────────────────────────────────────────┐
│              Message Handler + Queue                 │
│   Per-user FIFO queue — no race conditions          │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│          Claude Agent (Anthropic SDK)               │
│   Model: Claude Sonnet  │  Max turns: 10            │
│                                                      │
│   Available Tools:                                   │
│   • send_message        • save/recall memory        │
│   • create_cronjob      • list/delete cronjobs      │
│   • Skill (invoke any skill)                        │
└────────────────┬────────────────────────────────────┘
                 │
        ┌────────┼────────┐
        ▼        ▼        ▼
┌──────────┐ ┌──────┐ ┌─────────────────┐
│SurrealDB │ │SQLite│ │  node-cron       │
│ Memories │ │Crons │ │  Scheduler       │
│ Contacts │ │Sess. │ │  (WIB timezone)  │
└──────────┘ └──────┘ └─────────────────┘
```

### Message Flow
1. **User sends message** → Gateway receives it
2. **Queue** → Per-user sequential processing (FIFO)
3. **Fundamental memories** auto-loaded from SurrealDB
4. **System prompt** assembled with memories + context
5. **Claude Agent** processes with access to all tools
6. **Response** sent back via `send_message` tool → Gateway → User
7. **Session saved** + token stats updated

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.9 (ESM) |
| AI | Anthropic Claude Agent SDK (Sonnet / Haiku) |
| WhatsApp | whatsapp-web.js + Puppeteer |
| Memory DB | SurrealDB (graph database) |
| Scheduling DB | SQLite (better-sqlite3) |
| Scheduling | node-cron + cron-parser |
| Validation | Zod |
| Runtime | Node.js v24 |
| Package Manager | pnpm |
| Process Manager | PM2 |
| Testing | Vitest |

---

## ⚡ Getting Started

### Prerequisites
- Node.js v20+ (v24 recommended)
- pnpm (`npm install -g pnpm`)
- An [Anthropic API key](https://console.anthropic.com/)
- PM2 (`npm install -g pm2`) — for production
- A server or VPS (for WhatsApp to run headlessly)

### 1. Clone & Install

```bash
git clone https://github.com/mirzaakhena/personal-ai-assistant.git
cd personal-ai-assistant
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Gateway: 'whatsapp' or 'webchat'
GATEWAY=whatsapp

# WhatsApp: comma-separated phone numbers allowed to chat
WHITELIST_NUMBERS=628123456789

# Web Chat (only if GATEWAY=webchat)
WEBCHAT_USER_ID=your_user_id
WEBCHAT_PORT=3000

# Anthropic API
ANTHROPIC_API_KEY=sk-ant-...

# Optional: set working directory for Claude agent
CLAUDE_CWD=/home/youruser

# Optional: enable vector embeddings for memory search
MEMORY_EMBEDDING_ENABLED=false
```

### 3. Build & Run

**Development:**
```bash
pnpm dev
```

**Production:**
```bash
pnpm build
pnpm start
```

**With PM2:**
```bash
pm2 start dist/index.js --name wa-bot
pm2 save
```

### 4. First-Time WhatsApp Setup
On first run with `GATEWAY=whatsapp`, a QR code will be printed in the terminal. Scan it with WhatsApp on your phone. The session is saved locally in `.wwebjs_auth/` for future runs.

---

## 💡 Usage

Once running, just chat naturally with your assistant. Some examples:

| You say | What happens |
|---------|-------------|
| `"Remember that I prefer dark mode"` | Saved to memory as a preference |
| `"Remind me to call mom every Sunday at 9am"` | Creates a recurring cronjob |
| `"What do you know about me?"` | Lists all stored memories |
| `"Forget my old job info"` | Removes that memory after confirmation |
| `"What's running on the server?"` | Invokes workspace-info skill (live PM2 data) |
| `"Build me a todo app"` | Invokes new-workspace-app skill |
| *Sends a photo* | Claude analyzes the image and responds |
| `/status` | Shows session ID, token usage, and cost |
| `/new` | Starts a fresh session (summarizes current one) |

---

## 🧩 Extending with Skills

Skills live in `.claude/skills/<skill-name>/SKILL.md`. Each skill is a markdown file with a YAML frontmatter and natural language instructions for Claude.

**Creating a new skill:**

```bash
mkdir .claude/skills/my-skill
```

```markdown
---
name: my-skill
description: What this skill does. Claude will use this to decide when to invoke it.
user-invocable: true
---

# My Skill

Instructions for Claude when this skill is invoked...
```

Skills can use Bash commands, read/write files, call APIs, and more — they run inside the Claude Agent SDK execution environment.

---

## 🗂️ Project Structure

```
personal-ai-assistant/
├── src/
│   ├── index.ts              # App entry point
│   ├── core/                 # Constants, options, stats, session turns
│   ├── handlers/             # Message processing & routing
│   ├── gateway/              # WhatsApp & WebChat gateways
│   ├── trigger/              # Internal HTTP trigger server (port 3100)
│   ├── cron/                 # Cronjob registry, scheduler, executor
│   ├── memory/               # SurrealDB memory CRUD, search, summaries
│   ├── db/                   # Database init & queries
│   ├── tools/                # MCP tool definitions (memory, cron, message)
│   └── utils/                # Logger, queue, media, prompt builder
├── .claude/
│   └── skills/               # Pluggable skill modules
├── data/                     # Runtime databases (gitignored)
├── web/                      # Web chat frontend
├── .env                      # Your configuration
└── package.json
```

---

## 🔧 CLI Commands

Send these in chat:

| Command | Description |
|---------|-------------|
| `/new` | End current session, save summary, start fresh |
| `/status` | Show token usage, cost, and session info |
| `/restart` | Restart the bot process (WhatsApp only) |

---

## 🗺️ Roadmap

- [ ] HTTPS support for web interface
- [ ] Telegram gateway
- [ ] Vector embeddings for smarter memory search
- [ ] Multi-user support (currently single-user optimized)
- [ ] Plugin marketplace for community skills
- [ ] Mobile-friendly web chat UI
- [ ] Voice message transcription

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the repo
2. Create your feature branch: `git checkout -b feat/amazing-feature`
3. Commit your changes: `git commit -m 'feat: add amazing feature'`
4. Push to the branch: `git push origin feat/amazing-feature`
5. Open a Pull Request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with ❤️ using <a href="https://www.anthropic.com/">Anthropic Claude</a>
</p>
