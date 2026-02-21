---
name: new-workspace-app
description: Standard procedure for creating a new web application in the workspace. Use whenever the user asks to create, build, or develop a new app or project.
---

# New Workspace App — Standard Procedure

Every new app MUST follow these conventions without needing to be reminded.

## Conventions (Non-Negotiable)

1. **Location**: `/home/botuser/workspace/<app-name>/`
2. **Package manager**: `pnpm` always (never npm or yarn)
3. **Public URL**: `http://149.28.11.128:8080/<app-name>` via the reverse proxy
4. **Process manager**: PM2 (register in ecosystem.config.cjs)
5. **Keep user informed**: Send a WhatsApp message at every major step completed

## Step-by-Step Procedure

### Step 1 — Pick internal port
Check `/home/botuser/workspace/proxy/apps.config.js` and `workspace-info` skill for used ports.
Next available ports: 3002, 3003, 3004, ...

### Step 2 — Create project directory
```bash
mkdir -p /home/botuser/workspace/<app-name>
cd /home/botuser/workspace/<app-name>
```

### Step 3 — Initialize project with pnpm
For Vite + React:
```bash
npm create vite@latest . -- --template react
pnpm install
```
Always use pnpm for all subsequent installs.

### Step 4 — Configure Vite (if Vite app)
In `vite.config.js`, always set:
```js
base: '/<app-name>/',
server: {
  port: <internal-port>,
  host: true,
}
```

### Step 5 — Add pnpm config to package.json
```json
"pnpm": {
  "onlyBuiltDependencies": ["esbuild"]
}
```

### Step 6 — Register in proxy
Edit `/home/botuser/workspace/proxy/apps.config.js`, add:
```js
{ path: '/<app-name>', target: 'http://localhost:<port>' }
```
Then restart proxy: `pm2 restart proxy`

### Step 7 — Register in PM2 ecosystem
Edit `/home/botuser/workspace/ecosystem.config.cjs`, add entry:
```js
{
  name: '<app-name>',
  cwd: '/home/botuser/workspace/<app-name>',
  script: 'pnpm',
  args: 'run dev',
  interpreter: 'none',
  watch: false,
}
```
Then: `pm2 start /home/botuser/workspace/ecosystem.config.cjs` (only for new entries)
Or: `pm2 reload /home/botuser/workspace/ecosystem.config.cjs --only <app-name>`

### Step 8 — Save PM2 state
```bash
pm2 save
```

### Step 9 — Test & report
```bash
# Test redirect (no trailing slash)
curl -o /dev/null -w "%{http_code}" http://localhost:8080/<app-name>
# Test actual app (with trailing slash)
curl -o /dev/null -w "%{http_code}" http://localhost:8080/<app-name>/
```
Report the public URL to the user via WhatsApp.

## Redirect Behavior
The proxy auto-redirects `/app-name` → `/app-name/` (301), so both URLs work for the user.

## Communication Rule
Always send a WhatsApp update message after each major step is done. Never go silent for more than a few steps.

## Avoid Interactive Prompts
- Never run `pnpm approve-builds` interactively — always use `onlyBuiltDependencies` in package.json instead
- Never use `-i` flags with git or other tools
