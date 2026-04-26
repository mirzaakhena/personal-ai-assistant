// src/dashboard/routes/users.ts

import type { Express } from 'express';
import type { DashboardUserDbPool } from '../userdb-pool.js';

export function mountUsersRoute(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get('/api/users', (_req, res) => {
    const users = deps.pool.listUserIds().map((userId) => ({ userId }));
    res.json({ users });
  });
}
