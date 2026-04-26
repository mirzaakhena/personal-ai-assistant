// src/dashboard/routes/store-stats.ts

import type { Express, Request, Response, NextFunction } from 'express';
import type { DashboardUserDbPool } from '../userdb-pool.js';
import { STORE_CONFIG } from '../store-config.js';
import { STORE_NAMES, type StoreName } from '../shared/store-types.js';
import { StoreNotFoundError } from '../error-middleware.js';
import { BadQueryError } from '../filter-builder.js';
import type { UserDb } from '../../db/user-db.js';
import type { ChartPayload } from '../shared/api-types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function mountStoreStatsRoute(app: Express, deps: { pool: DashboardUserDbPool }): void {
  app.get(
    '/api/users/:uid/stores/:store/stats',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uid = req.params['uid'] as string;
        const storeName = req.params['store'] as StoreName;
        if (!STORE_NAMES.includes(storeName)) throw new StoreNotFoundError(storeName);
        const cfg = STORE_CONFIG[storeName];
        const sinceMs = parseRange(req.query['range']);
        const db = deps.pool.acquire(uid);
        const charts: Record<string, ChartPayload> = {};
        for (const def of cfg.charts) {
          charts[def.id] = await deps.pool.runWithRetry(
            () => buildChart(storeName, def.id, db, sinceMs),
          );
        }
        res.json({ charts });
      } catch (err) { next(err); }
    },
  );
}

function parseRange(raw: unknown): number {
  const s = (typeof raw === 'string' ? raw : '30d').trim();
  const m = /^(\d+)d$/.exec(s);
  if (!m) throw new BadQueryError(`bad range: ${s}, expected NNNd`);
  return Date.now() - parseInt(m[1], 10) * DAY_MS;
}

function buildChart(name: StoreName, chartId: string, db: UserDb, sinceMs: number): ChartPayload {
  const key = `${name}.${chartId}`;
  switch (key) {
    case 'knowledge.count_by_category': {
      const map = db.knowledge.countByCategory();
      return {
        type: 'donut',
        series: Object.entries(map).map(([name, value]) => ({ name, value })),
      };
    }
    case 'tasks.count_by_status': {
      const map = db.tasks.countByStatus();
      return {
        type: 'donut',
        series: Object.entries(map).map(([name, value]) => ({ name, value })),
      };
    }
    case 'cronjobs.count_by_status': {
      const map = db.cronjobs.countByStatus();
      return {
        type: 'donut',
        series: Object.entries(map).map(([name, value]) => ({ name, value })),
      };
    }
    case 'journal.count_by_week': {
      const buckets = db.journal.countByWeek({ sinceMs });
      return { type: 'bar', xKey: 'week', yKey: 'n', series: buckets };
    }
    case 'messages.count_by_day': {
      const buckets = db.messages.countByDay({ sinceMs });
      return { type: 'bar', xKey: 'day', yKey: 'n', series: buckets };
    }
    case 'ledger.aggregate_by_stream': {
      const buckets = db.ledger.aggregateByStream({ sinceMs });
      return { type: 'bar', xKey: 'stream', yKey: 'n', series: buckets };
    }
    case 'query_costs.cost_by_day': {
      const buckets = db.queryCosts.aggregateByDay({ sinceMs });
      return { type: 'line', xKey: 'day', yKey: 'usd', series: buckets };
    }
    default:
      throw new BadQueryError(`unknown chart: ${key}`);
  }
}
