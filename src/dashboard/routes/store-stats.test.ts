// src/dashboard/routes/store-stats.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountStoreStatsRoute } from './store-stats.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'stats-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const app = express();
  mountStoreStatsRoute(app, { pool: createUserDbPool({ baseDir }) });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users/:uid/stores/:store/stats', () => {
  it('returns count_by_category donut for knowledge', async () => {
    const db = createUserDb('alice', baseDir);
    db.knowledge.saveMany([
      { category: 'person', key: 'a', value: '1' },
      { category: 'person', key: 'b', value: '2' },
      { category: 'context', key: 'c', value: '3' },
    ]);
    db.close();

    const r = await request(makeApp()).get('/api/users/alice/stores/knowledge/stats?range=30d');
    expect(r.status).toBe(200);
    const chart = r.body.charts.count_by_category;
    expect(chart.type).toBe('donut');
    const map = Object.fromEntries(chart.series.map((s: { name: string; value: number }) => [s.name, s.value]));
    expect(map.person).toBe(2);
    expect(map.context).toBe(1);
  });

  it('returns empty charts object for stores with no chart defs', async () => {
    const db = createUserDb('alice', baseDir);
    db.profile.setMany([{ key: 'name', value: 'X' }]);
    db.close();
    const r = await request(makeApp()).get('/api/users/alice/stores/profile/stats');
    expect(r.status).toBe(200);
    expect(r.body.charts).toEqual({});
  });

  it('returns line chart for query_costs cost_by_day', async () => {
    const db = createUserDb('alice', baseDir);
    db.queryCosts.insert({
      session_id: 'S', timestamp: Date.now(), model: 'haiku',
      input_tokens: 10, cache_creation_tokens: 0, cache_read_tokens: 0,
      output_tokens: 5, actual_cost_usd: 0.01, simulated_api_cost_usd: 0.01,
      duration_ms: 100, num_turns: 1,
    });
    db.close();
    const r = await request(makeApp()).get('/api/users/alice/stores/query_costs/stats?range=30d');
    expect(r.status).toBe(200);
    expect(r.body.charts.cost_by_day.type).toBe('line');
    expect(r.body.charts.cost_by_day.series.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects bad range with 400', async () => {
    const db = createUserDb('alice', baseDir);
    db.close();
    const r = await request(makeApp()).get('/api/users/alice/stores/knowledge/stats?range=foo');
    expect(r.status).toBe(400);
  });
});
