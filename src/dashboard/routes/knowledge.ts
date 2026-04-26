// src/dashboard/routes/knowledge.ts

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { DashboardUserDbPool } from '../userdb-pool.js';
import type { KnowledgeCategory } from '../../db/knowledge.js';

const querySchema = z.object({
  q: z.string().min(1),
  category: z.enum(['identity', 'person', 'routine', 'context', 'insight']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function mountKnowledgeRoutes(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get(
    '/api/users/:uid/knowledge/search',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.params['uid'] as string;
        const q = querySchema.parse(req.query);
        const db = deps.pool.acquire(uid);
        const result = await deps.pool.runWithRetry(() =>
          db.knowledge.searchPage(q.q, {
            category: q.category as KnowledgeCategory | undefined,
            limit: q.limit,
            offset: (q.page - 1) * q.limit,
          }),
        );
        res.json({
          hits: result.hits,
          total: result.total,
          page: q.page,
          limit: q.limit,
        });
      } catch (err) { next(err); }
    },
  );
}
