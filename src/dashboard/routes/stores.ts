// src/dashboard/routes/stores.ts

import type { Express, Request, Response, NextFunction } from 'express';
import type { DashboardUserDbPool } from '../userdb-pool.js';
import { STORE_NAMES, STORE_CATEGORY } from '../shared/store-types.js';
import type { StoreName } from '../shared/store-types.js';
import type { UserDb } from '../../db/user-db.js';

export function mountStoresRoute(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get('/api/users/:uid/stores', (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = deps.pool.acquire(req.params['uid'] as string);
      const stores = STORE_NAMES.map((name) => ({
        name,
        category: STORE_CATEGORY[name],
        count: countFor(name, db),
      }));
      res.json({ stores });
    } catch (err) { next(err); }
  });
}

function countFor(name: StoreName, db: UserDb): number {
  switch (name) {
    case 'profile':     return db.profile.getAllRows().length;
    case 'preferences': return db.preferences.count();
    case 'knowledge':   return db.knowledge.list().length;
    case 'journal':     return db.journal.count();
    case 'tasks':       return db.tasks.listPage({ limit: 1, offset: 0 }).total;
    case 'cronjobs':    return db.cronjobs.listPage({ limit: 1, offset: 0 }).total;
    case 'messages':    return db.messages.count();
    case 'reactions':   return db.reactions.count();
    case 'sessions':    return db.sessions.count();
    case 'ledger':      return db.ledger.listPage({ limit: 1, offset: 0 }).total;
    case 'query_costs': return db.queryCosts.listPage({ limit: 1, offset: 0 }).total;
  }
}
