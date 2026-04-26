// src/dashboard/routes/knowledge.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountKnowledgeRoutes } from './knowledge.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'know-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const app = express();
  mountKnowledgeRoutes(app, { pool: createUserDbPool({ baseDir }) });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users/:uid/knowledge/search', () => {
  it('returns hits with snippets', async () => {
    const db = createUserDb('alice', baseDir);
    db.knowledge.saveMany([
      { category: 'person', key: 'mirza', value: 'mirza loves coffee' },
      { category: 'context', key: 'stack', value: 'typescript backend' },
    ]);
    db.close();

    const r = await request(makeApp())
      .get('/api/users/alice/knowledge/search?q=coffee&limit=10');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.hits[0].snippet).toContain('coffee');
  });

  it('400 when q is missing', async () => {
    const db = createUserDb('alice', baseDir);
    db.close();
    const r = await request(makeApp()).get('/api/users/alice/knowledge/search');
    expect(r.status).toBe(400);
  });

  it('filters by category', async () => {
    const db = createUserDb('alice', baseDir);
    db.knowledge.saveMany([
      { category: 'person',  key: 'a', value: 'coffee' },
      { category: 'context', key: 'b', value: 'coffee' },
    ]);
    db.close();
    const r = await request(makeApp())
      .get('/api/users/alice/knowledge/search?q=coffee&category=person');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.hits[0].category).toBe('person');
  });
});
