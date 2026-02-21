---
name: workspace-info
description: Reference information about the workspace server, running apps, port assignments, and infrastructure setup. Use when asked about server info, IP, ports, running apps, or workspace structure.
user-invocable: false
---

# Workspace Info

## Server
- **Public IP**: `149.28.11.128`
- **OS**: Ubuntu 24.04 LTS
- **User**: `botuser` (no sudo access)
- **Node.js**: v24.13.1
- **Package manager**: pnpm (required for all projects)
- **Process manager**: PM2

## Directory Structure
```
/home/botuser/
├── personal-ai-assistant/   # WhatsApp AI bot (wa-bot via PM2)
└── workspace/
    ├── proxy/               # Node.js reverse proxy (port 8080, public)
    ├── ecosystem.config.cjs # PM2 config for all workspace apps
    └── expense-tracker/     # Expense tracker app (internal port 3001)
```

## Public Access
All apps are accessible via the reverse proxy at port 8080:
- **Proxy**: `http://149.28.11.128:8080` (Node.js, `/home/botuser/workspace/proxy/`)
- **expense-tracker**: `http://149.28.11.128:8080/expense-tracker` → internal `localhost:3001`

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
