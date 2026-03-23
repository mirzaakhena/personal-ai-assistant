---
name: workspace-info
description: Reference information about the workspace server, running apps, port assignments, and infrastructure setup. Use when asked about server info, IP, ports, running apps, or workspace structure.
user-invocable: false
---

# Workspace Info

When this skill is triggered, you MUST run live commands via Bash to get real-time info.

## Live Commands to Run (ALWAYS)

Run ALL of these commands to gather up-to-date information:

1. **PM2 process list** (human-readable overview):
   ```bash
   pm2 list
   ```

2. **PM2 detailed JSON** (comprehensive info: name, status, pid, cpu, memory, uptime, restarts, port):
   ```bash
   pm2 jlist
   ```

3. **Active listening ports** (what's actually bound to which port):
   ```bash
   ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null
   ```

After running the commands, compile and present the results in a clear, human-readable format.

---

## Static Reference (Server Identity Only)

Only the following info is truly static — everything else (apps, ports, processes) must come from live commands above.

- **Public IP**: `149.28.11.128`
- **OS**: Ubuntu 24.04 LTS
- **User**: `botuser` (no sudo access)
- **Node.js**: v24.13.1
- **Package manager**: pnpm (required for all projects)
- **Process manager**: PM2
- **No sudo access** → cannot install system packages (nginx, etc.)
- **No HTTPS yet** → backlog item for future phases
- **Proxy config**: `/home/botuser/workspace/proxy/apps.config.js`
- **PM2 ecosystem**: `/home/botuser/workspace/ecosystem.config.cjs`
- **Base directory**: `/home/botuser/`
