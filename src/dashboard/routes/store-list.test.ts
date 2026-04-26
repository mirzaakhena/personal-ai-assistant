// src/dashboard/routes/store-list.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountStoreListRoute } from './store-list.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'store-list-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const pool = createUserDbPool({ baseDir });
  const app = express();
  mountStoreListRoute(app, { pool });
  app.use(errorMiddleware);
  return app;
}

function seedKnowledge(uid: string, n: number) {
  const db = createUserDb(uid, baseDir);
  for (let i = 0; i < n; i++) {
    db.knowledge.saveMany([{ category: 'context', key: `k${i}`, value: `v${i}` }]);
  }
  db.close();
}

describe('GET /api/users/:uid/stores/:store/list', () => {
  it('paginates knowledge', async () => {
    seedKnowledge('alice', 12);
    const r = await request(makeApp())
      .get('/api/users/alice/stores/knowledge/list?limit=5&page=1');
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBe(5);
    expect(r.body.total).toBe(12);
    expect(r.body.page).toBe(1);
    expect(r.body.limit).toBe(5);
  });

  it('rejects unknown store with 404', async () => {
    seedKnowledge('alice', 1);
    const r = await request(makeApp())
      .get('/api/users/alice/stores/nosuch/list');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('STORE_NOT_FOUND');
  });

  it('rejects unknown filter key with 400', async () => {
    seedKnowledge('alice', 1);
    const r = await request(makeApp())
      .get('/api/users/alice/stores/knowledge/list?filter[bogus]=x');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_QUERY');
  });

  it('applies category filter for knowledge', async () => {
    const db = createUserDb('alice', baseDir);
    db.knowledge.saveMany([
      { category: 'person',  key: 'a', value: '1' },
      { category: 'context', key: 'b', value: '2' },
    ]);
    db.close();
    const r = await request(makeApp())
      .get('/api/users/alice/stores/knowledge/list?filter[category]=person');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect((r.body.rows[0] as { key: string }).key).toBe('a');
  });
});
