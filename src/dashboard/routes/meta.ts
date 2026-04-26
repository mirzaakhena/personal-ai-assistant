// src/dashboard/routes/meta.ts

import type { Express } from 'express';
import { STORE_CONFIG } from '../store-config.js';

export function mountMetaRoute(app: Express): void {
  app.get('/api/meta', (_req, res) => {
    res.json({ stores: STORE_CONFIG });
  });
}
