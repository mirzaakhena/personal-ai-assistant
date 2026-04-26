// src/dashboard/boot.ts

import http from 'node:http';
import https from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createAuthMiddleware, mountAuthRoutes } from './auth.js';
import { createUserDbPool, type ActiveUser } from './userdb-pool.js';
import { errorMiddleware } from './error-middleware.js';
import { mountMetaRoute } from './routes/meta.js';
import { mountUsersRoute } from './routes/users.js';
import { mountStoresRoute } from './routes/stores.js';
import { mountStoreListRoute } from './routes/store-list.js';
import { mountStoreStatsRoute } from './routes/store-stats.js';
import { mountKnowledgeRoutes } from './routes/knowledge.js';
import { mountMessagesRoutes } from './routes/messages.js';
import { mountLedgerRoutes } from './routes/ledger.js';
import { log } from '../utils/logger.js';

export type DashboardConfig = {
  port: number;
  token: string;
  baseDir: string;
  activeUser?: ActiveUser;
  tlsCert?: string;
  tlsKey?: string;
};

export type DashboardServer = {
  start(): Promise<string>;     // returns base URL
  stop(): Promise<void>;
};

export function createDashboardServer(cfg: DashboardConfig): DashboardServer | null {
  if (!cfg.token) {
    log.debug('[dashboard] DASHBOARD_TOKEN empty — dashboard server skipped');
    return null;
  }

  const pool = createUserDbPool({ baseDir: cfg.baseDir, activeUser: cfg.activeUser });

  const app = express();
  app.set('query parser', 'extended');  // for filter[key]=val nested parsing
  app.use(express.json());
  app.use(cookieParser());

  // Public routes (no auth)
  mountAuthRoutes(app, {
    token: cfg.token,
    secureCookie: Boolean(cfg.tlsCert && cfg.tlsKey),
  });
  app.get('/api/healthz', (_req, res) => res.json({ ok: true }));

  // Auth gate for everything else under /api/
  const auth = createAuthMiddleware({ token: cfg.token });
  app.use('/api/meta', auth);
  app.use('/api/users', auth);

  mountMetaRoute(app);
  mountUsersRoute(app, { pool });
  mountStoresRoute(app, { pool });
  mountStoreListRoute(app, { pool });
  mountStoreStatsRoute(app, { pool });
  mountKnowledgeRoutes(app, { pool });
  mountMessagesRoutes(app, { pool });
  mountLedgerRoutes(app, { pool });

  // Serve built SPA assets if dist/dashboard exists.
  // In dev mode (without `pnpm build`), this block is skipped — Vite dev server
  // at :5173 handles the SPA and proxies /api → :3200.
  const spaDir = resolve(process.cwd(), 'dist/dashboard');
  if (existsSync(spaDir)) {
    app.use(express.static(spaDir));
    // SPA fallback: any non-/api path that isn't a static file → index.html.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(resolve(spaDir, 'index.html'));
    });
  }

  app.use(errorMiddleware);

  let server: http.Server | https.Server | null = null;

  return {
    async start() {
      if (cfg.tlsCert && cfg.tlsKey) {
        server = https.createServer(
          { cert: readFileSync(cfg.tlsCert), key: readFileSync(cfg.tlsKey) },
          app,
        );
      } else {
        server = http.createServer(app);
      }
      await new Promise<void>((resolve) => server!.listen(cfg.port, () => resolve()));
      const addr = server!.address() as AddressInfo;
      const proto = cfg.tlsCert ? 'https' : 'http';
      const url = `${proto}://127.0.0.1:${addr.port}`;
      log.debug(`[dashboard] listening on ${url}`);
      return url;
    },
    async stop() {
      if (!server) return;
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
      pool.dispose();
    },
  };
}
