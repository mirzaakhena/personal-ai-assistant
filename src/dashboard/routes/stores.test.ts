// src/dashboard/routes/stores.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountStoresRoute } from './stores.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'stores-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const pool = createUserDbPool({ baseDir });
  const app = express();
  mountStoresRoute(app, { pool });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users/:uid/stores', () => {
  it('404 for unknown user', async () => {
    const r = await request(makeApp()).get('/api/users/ghost/stores');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns summary with counts after seeding data', async () => {
    const db = createUserDb('alice', baseDir);
    db.knowledge.saveMany([{ category: 'person', key: 'k', value: 'v' }]);
    db.profile.setMany([{ key: 'name', value: 'A' }]);
    db.close();

    const r = await request(makeApp()).get('/api/users/alice/stores');
    expect(r.status).toBe(200);
    const k = r.body.stores.find((s: { name: string }) => s.name === 'knowledge');
    const p = r.body.stores.find((s: { name: string }) => s.name === 'profile');
    expect(k.count).toBe(1);
    expect(p.count).toBe(1);
    expect(k.category).toBe('memory');
  });
});
