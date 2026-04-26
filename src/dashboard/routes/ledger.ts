// src/dashboard/routes/ledger.ts

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { DashboardUserDbPool } from '../userdb-pool.js';

const aggSchema = z.object({
  range: z.string().regex(/^\d+d$/).default('30d'),
});

export function mountLedgerRoutes(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get(
    '/api/users/:uid/ledger/aggregate',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.params['uid'] as string;
        const q = aggSchema.parse(req.query);
        const days = parseInt(q.range.replace('d', ''), 10);
        const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
        const db = deps.pool.acquire(uid);
        const series = await deps.pool.runWithRetry(
          () => db.ledger.aggregateByStream({ sinceMs }),
        );
        res.json({ groupBy: 'stream', range: q.range, series });
      } catch (err) { next(err); }
    },
  );
}
