// src/dashboard/routes/messages.ts

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { DashboardUserDbPool } from '../userdb-pool.js';

const searchSchema = z.object({
  q: z.string().min(1),
  sender: z.enum(['user', 'assistant', 'system']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const threadSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function mountMessagesRoutes(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get(
    '/api/users/:uid/messages/search',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.params['uid'] as string;
        const q = searchSchema.parse(req.query);
        const db = deps.pool.acquire(uid);
        const r = await deps.pool.runWithRetry(() => db.messages.searchPage(q.q, {
          sender: q.sender, limit: q.limit, offset: (q.page - 1) * q.limit,
        }));
        res.json({ hits: r.hits, total: r.total, page: q.page, limit: q.limit });
      } catch (err) { next(err); }
    },
  );

  app.get(
    '/api/users/:uid/messages/thread/:sessionId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.params['uid'] as string;
        const sessionId = req.params['sessionId'] as string;
        const q = threadSchema.parse(req.query);
        const db = deps.pool.acquire(uid);
        const r = await deps.pool.runWithRetry(() => db.messages.getThread(
          sessionId, { limit: q.limit, offset: (q.page - 1) * q.limit },
        ));
        res.json({ rows: r.rows, total: r.total, page: q.page, limit: q.limit });
      } catch (err) { next(err); }
    },
  );
}
