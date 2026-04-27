// src/dashboard/routes/skills.ts

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { DashboardUserDbPool } from '../userdb-pool.js';
import { UserNotFoundError } from '../userdb-pool.js';
import type { SkillsReader } from '../skills-reader.js';

const listQuery = z.object({
  scope: z.enum(['active', 'archived']).default('active'),
  q: z.string().max(200).optional(),
});

function assertUserExists(pool: DashboardUserDbPool, uid: string): void {
  if (!pool.listUserIds().includes(uid)) throw new UserNotFoundError(uid);
}

export function mountSkillsRoutes(
  app: Express,
  deps: { pool: DashboardUserDbPool; reader: SkillsReader },
): void {
  app.get('/api/users/:uid/skills',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.params['uid'] as string;
        assertUserExists(deps.pool, uid);
        const { scope, q } = listQuery.parse(req.query);
        const rows = q && q.length > 0
          ? await deps.reader.search(uid, scope, q)
          : await deps.reader.list(uid, scope);
        res.json({ rows, total: rows.length, scope });
      } catch (err) { next(err); }
    },
  );

  const scopeSchema = z.enum(['active', 'archived']);

  app.get('/api/users/:uid/skills/:scope/:name',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.params['uid'] as string;
        assertUserExists(deps.pool, uid);
        const scope = scopeSchema.parse(req.params['scope']);
        const name = req.params['name'] as string;
        const detail = await deps.reader.detail(uid, scope, name);
        res.json(detail);
      } catch (err) { next(err); }
    },
  );
}
