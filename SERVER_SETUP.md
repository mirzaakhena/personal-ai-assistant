# Server Setup Guide — From Zero

Panduan lengkap untuk setup ulang server dari nol dengan konfigurasi yang sama seperti server saat ini.

---

## Spesifikasi Server Saat Ini

- **OS**: Ubuntu 24.04 LTS
- **Public IP**: `149.28.11.128`
- **User**: `botuser` (non-root, tidak punya sudo)
- **Node.js**: v24.13.1 (via nvm)
- **Package manager**: pnpm v10.30.1
- **Process manager**: PM2 v6

---

## Tahap 1 — Persiapan Sistem (butuh root/sudo)

> ⚠️ Tahap ini harus dilakukan oleh root atau user dengan sudo.

### 1.1 Buat user `botuser`
```bash
adduser botuser
# Isi password dan info lainnya
```

### 1.2 Install dependensi sistem
```bash
sudo apt-get update && sudo apt-get install -y \
  git \
  curl \
  build-essential \
  python3 \
  ca-certificates \
  libglib2.0-0 \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2
```
> Paket-paket libX tersebut dibutuhkan oleh Puppeteer/Chrome yang digunakan oleh `whatsapp-web.js`.

### 1.3 Buka port firewall
```bash
sudo ufw allow 8080/tcp
# (Opsional, untuk masa depan)
# sudo ufw allow 80/tcp
# sudo ufw allow 443/tcp
```

---

## Tahap 2 — Setup Node.js & Tools (sebagai `botuser`)

### 2.1 Install nvm
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
```

### 2.2 Install Node.js
```bash
nvm install 24
nvm use 24
nvm alias default 24
```
Verifikasi:
```bash
node --version   # v24.x.x
npm --version
```

### 2.3 Install pnpm (via corepack)
```bash
corepack enable pnpm
pnpm --version   # 10.x.x
```

### 2.4 Install PM2
```bash
npm install -g pm2
pm2 --version    # 6.x.x
```

---

## Tahap 3 — Clone & Setup `personal-ai-assistant`

### 3.1 Clone repository
```bash
git clone git@github.com:mirzaakhena/personal-ai-assistant.git ~/personal-ai-assistant
cd ~/personal-ai-assistant
```

> Pastikan SSH key sudah terdaftar di GitHub, atau gunakan HTTPS clone.

### 3.2 Install dependencies
```bash
pnpm install
```

### 3.3 Buat file `.env`
```bash
cp .env.example .env
nano .env
```
Isi:
```env
WHITELIST_NUMBERS=628XXXXXXXXXX,628YYYYYYYYYY
```
> Ganti dengan nomor WhatsApp yang diizinkan (format internasional tanpa +).

### 3.4 Build project
```bash
pnpm build
```

---

## Tahap 4 — Setup Workspace

### 4.1 Buat struktur direktori
```bash
mkdir -p ~/workspace/proxy
mkdir -p ~/workspace/expense-tracker
```

### 4.2 Setup Proxy

Buat file `~/workspace/proxy/package.json`:
```json
{
  "name": "workspace-proxy",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "scripts": { "start": "node index.js" },
  "pnpm": { "onlyBuiltDependencies": [] },
  "dependencies": { "http-proxy": "^1.18.1" }
}
```

Buat file `~/workspace/proxy/apps.config.js`:
```js
export const apps = [
  {
    path: '/expense-tracker',
    target: 'http://localhost:3001',
  },
  // Tambahkan app baru di bawah ini:
  // { path: '/todolist', target: 'http://localhost:3002' },
]
```

Buat file `~/workspace/proxy/index.js`:
```js
import http from 'http'
import httpProxy from 'http-proxy'
import { apps } from './apps.config.js'

const PORT = 8080
const proxy = httpProxy.createProxyServer({ ws: true })

proxy.on('error', (err, req, res) => {
  console.error(`[Proxy Error] ${req.url}:`, err.message)
  if (res && res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end(`502 Bad Gateway: ${err.message}`)
  }
})

const server = http.createServer((req, res) => {
  const url = req.url || '/'

  const exactMatch = apps.find(a => url === a.path)
  if (exactMatch) {
    res.writeHead(301, { Location: exactMatch.path + '/' })
    res.end()
    return
  }

  const app = apps.find(a => url.startsWith(a.path + '/') || url.startsWith(a.path + '?'))
  if (app) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${url} -> ${app.target}`)
    proxy.web(req, res, { target: app.target })
    return
  }

  if (url === '/' || url === '') {
    const appList = apps.map(a => `<li><a href="${a.path}/">${a.path}</a> → ${a.target}</li>`).join('\n')
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<!DOCTYPE html><html><body><h1>🚀 Workspace Apps</h1><ul>${appList}</ul></body></html>`)
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('404 Not Found')
})

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '/'
  const app = apps.find(a => url === a.path || url.startsWith(a.path + '/') || url.startsWith(a.path + '?'))
  if (app) {
    proxy.ws(req, socket, head, { target: app.target })
  } else {
    socket.destroy()
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Workspace Proxy running on http://0.0.0.0:${PORT}`)
  apps.forEach(a => console.log(`  ${a.path} -> ${a.target}`))
})
```

Install dependencies proxy:
```bash
cd ~/workspace/proxy && pnpm install
```

### 4.3 Setup expense-tracker

Clone atau buat ulang project (ikuti `new-workspace-app` skill):
```bash
cd ~/workspace/expense-tracker
npm create vite@latest . -- --template react
pnpm install
```

Pastikan `vite.config.js` mengandung:
```js
base: '/expense-tracker/',
server: {
  port: 3001,
  host: true,
}
```

Install semua dependencies yang diperlukan (lihat package.json expense-tracker yang ada).

---

## Tahap 5 — Setup PM2 Ecosystem

Buat file `~/workspace/ecosystem.config.cjs`:
```js
module.exports = {
  apps: [
    {
      name: 'wa-bot',
      cwd: '/home/botuser/personal-ai-assistant',
      script: 'pnpm',
      args: 'start',
      interpreter: 'none',
      watch: false,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'proxy',
      cwd: '/home/botuser/workspace/proxy',
      script: 'index.js',
      interpreter: 'node',
      watch: false,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'expense-tracker',
      cwd: '/home/botuser/workspace/expense-tracker',
      script: 'pnpm',
      args: 'run dev',
      interpreter: 'none',
      watch: false,
      env: { NODE_ENV: 'development' },
    },
  ],
}
```

Jalankan semua:
```bash
pm2 start ~/workspace/ecosystem.config.cjs
pm2 save
```

### Setup PM2 auto-start saat reboot (butuh root)
```bash
# Jalankan sebagai botuser, salin output-nya
pm2 startup
# Output akan memberikan perintah yang harus dijalankan sebagai root, contoh:
# sudo env PATH=$PATH:/home/botuser/.nvm/versions/node/v24.13.1/bin \
#   /home/botuser/.nvm/versions/node/v24.13.1/lib/node_modules/pm2/bin/pm2 \
#   startup systemd -u botuser --hp /home/botuser
```

---

## Tahap 6 — Setup Claude Code Skills

Skills ini mengajarkan Claude cara kerja workspace secara otomatis.

```bash
mkdir -p ~/.claude/skills/workspace-info
mkdir -p ~/.claude/skills/new-workspace-app
```

### `~/.claude/skills/workspace-info/SKILL.md`

> ⚠️ **Ganti IP** `149.28.11.128` dengan IP server baru!

```markdown
---
name: workspace-info
description: Reference information about the workspace server, running apps, port assignments, and infrastructure setup. Use when asked about server info, IP, ports, running apps, or workspace structure.
user-invocable: false
---

# Workspace Info

## Server
- **Public IP**: `149.28.11.128`   ← GANTI DENGAN IP BARU
- **OS**: Ubuntu 24.04 LTS
- **User**: `botuser` (no sudo access)
- **Node.js**: v24.13.1
- **Package manager**: pnpm (required for all projects)
- **Process manager**: PM2

## Directory Structure
\```
/home/botuser/
├── personal-ai-assistant/   # WhatsApp AI bot (wa-bot via PM2)
└── workspace/
    ├── proxy/               # Node.js reverse proxy (port 8080, public)
    ├── ecosystem.config.cjs # PM2 config for all workspace apps
    └── expense-tracker/     # Expense tracker app (internal port 3001)
\```

## Public Access
All apps are accessible via the reverse proxy at port 8080:
- **Proxy**: `http://<IP>:8080` (Node.js, `/home/botuser/workspace/proxy/`)
- **expense-tracker**: `http://<IP>:8080/expense-tracker` → internal `localhost:3001`

## Port Registry
| Port | App              | Status  |
|------|------------------|---------|
| 8080 | proxy (public)   | In use  |
| 3001 | expense-tracker  | In use  |
| 3002 | (next app)       | Free    |
| 3003 | (next app)       | Free    |

## PM2 Processes
| ID | Name             | Description                    |
|----|------------------|--------------------------------|
| 0  | wa-bot           | WhatsApp AI assistant bot      |
| 1  | proxy            | Reverse proxy (port 8080)      |
| 2  | expense-tracker  | Expense tracker (port 3001)    |

## Infrastructure Notes
- **No sudo access** → cannot install system packages (nginx, etc.)
- **No HTTPS yet** → backlog item for future phases
- **Port 80/443** → not yet used, planned for future phases
- **Proxy config**: `/home/botuser/workspace/proxy/apps.config.js`
- **PM2 ecosystem**: `/home/botuser/workspace/ecosystem.config.cjs`
```

---

### `~/.claude/skills/new-workspace-app/SKILL.md`

> ⚠️ **Ganti IP** `149.28.11.128` dengan IP server baru!

```markdown
---
name: new-workspace-app
description: Standard procedure for creating a new web application in the workspace. Use whenever the user asks to create, build, or develop a new app or project.
---

# New Workspace App — Standard Procedure

Every new app MUST follow these conventions without needing to be reminded.

## Conventions (Non-Negotiable)

1. **Location**: `/home/botuser/workspace/<app-name>/`
2. **Package manager**: `pnpm` always (never npm or yarn)
3. **Public URL**: `http://149.28.11.128:8080/<app-name>` via the reverse proxy   ← GANTI IP
4. **Process manager**: PM2 (register in ecosystem.config.cjs)
5. **Keep user informed**: Send a WhatsApp message at every major step completed

## Step-by-Step Procedure

### Step 1 — Pick internal port
Check `/home/botuser/workspace/proxy/apps.config.js` and `workspace-info` skill for used ports.
Next available ports: 3002, 3003, 3004, ...

### Step 2 — Create project directory
\```bash
mkdir -p /home/botuser/workspace/<app-name>
\```

### Step 3 — Initialize project with pnpm
For Vite + React:
\```bash
npm create vite@latest . -- --template react
pnpm install
\```
Always use pnpm for all subsequent installs.

### Step 4 — Configure Vite (if Vite app)
In `vite.config.js`, always set:
\```js
base: '/<app-name>/',
server: {
  port: <internal-port>,
  host: true,
}
\```

### Step 5 — Add pnpm config to package.json
\```json
"pnpm": {
  "onlyBuiltDependencies": ["esbuild"]
}
\```

### Step 6 — Register in proxy
Edit `/home/botuser/workspace/proxy/apps.config.js`, add:
\```js
{ path: '/<app-name>', target: 'http://localhost:<port>' }
\```
Then restart proxy: `pm2 restart proxy`

### Step 7 — Register in PM2 ecosystem
Edit `/home/botuser/workspace/ecosystem.config.cjs`, add entry:
\```js
{
  name: '<app-name>',
  cwd: '/home/botuser/workspace/<app-name>',
  script: 'pnpm',
  args: 'run dev',
  interpreter: 'none',
  watch: false,
}
\```
Then: `pm2 reload /home/botuser/workspace/ecosystem.config.cjs --only <app-name>`

### Step 8 — Save PM2 state
\```bash
pm2 save
\```

### Step 9 — Test & report
\```bash
curl -o /dev/null -w "%{http_code}" http://localhost:8080/<app-name>
curl -o /dev/null -w "%{http_code}" http://localhost:8080/<app-name>/
\```
Report the public URL to the user via WhatsApp.

## Redirect Behavior
The proxy auto-redirects `/app-name` → `/app-name/` (301), so both URLs work.

## Communication Rule
Always send a WhatsApp update message after each major step is done. Never go silent.

## Avoid Interactive Prompts
- Never run `pnpm approve-builds` interactively — use `onlyBuiltDependencies` in package.json
- Never use `-i` flags with git or other tools
```

---

## Tahap 7 — WhatsApp Re-Authentication

> ⚠️ Session WhatsApp **tidak bisa dipindahkan** ke server baru. Harus scan QR code ulang.

```bash
cd ~/personal-ai-assistant
pnpm dev
# Akan muncul QR code di terminal
# Scan dengan WhatsApp di HP
```

Setelah berhasil, folder `.wwebjs_auth/` akan terbuat otomatis. Bot siap dijalankan via PM2.

---

## Checklist Ringkas

| # | Item | Butuh Root? | Catatan |
|---|------|-------------|---------|
| 1 | Buat user `botuser` | ✅ | |
| 2 | Install sistem packages + Chrome deps | ✅ | Untuk Puppeteer |
| 3 | Buka port 8080 di firewall | ✅ | |
| 4 | PM2 auto-startup | ✅ | `sudo pm2 startup` |
| 5 | Install nvm | ❌ | Sebagai botuser |
| 6 | Install Node.js via nvm | ❌ | |
| 7 | Install pnpm via corepack | ❌ | |
| 8 | Install PM2 global | ❌ | |
| 9 | Clone personal-ai-assistant | ❌ | Dari GitHub |
| 10 | Setup .env | ❌ | Isi manual |
| 11 | Setup workspace/proxy | ❌ | Copy dari doc ini |
| 12 | Setup workspace/expense-tracker | ❌ | Re-create project |
| 13 | Setup ecosystem.config.cjs | ❌ | Copy dari doc ini |
| 14 | Setup Claude skills | ❌ | Copy dari server lama |
| 15 | Scan QR WhatsApp ulang | ❌ | Wajib di server baru |
| 16 | Update IP di workspace-info skill | ❌ | Sesuaikan IP baru |

---

## Yang Belum di GitHub (Backlog)

Saat ini beberapa komponen **tidak ada di version control**, sehingga harus dibuat ulang manual:

- [ ] `~/workspace/proxy/` → pertimbangkan buat repo sendiri atau gabung ke monorepo
- [ ] `~/workspace/expense-tracker/` → belum ada di GitHub
- [ ] `~/workspace/ecosystem.config.cjs` → bisa dicommit ke salah satu repo
- [ ] `~/.claude/skills/` → bisa disimpan di repo personal-ai-assistant

**Future improvements (backlog):**
- [ ] HTTPS (SSL certificate via Let's Encrypt)
- [ ] Port 80/443 sebagai ganti 8080
- [ ] Install nginx sebagai reverse proxy (lebih proper dari Node.js proxy)
- [ ] Setup script otomatis (bash/ansible) untuk zero-touch deployment
- [ ] GitHub Actions untuk CI/CD

---

*Last updated: 2026-02-22*
