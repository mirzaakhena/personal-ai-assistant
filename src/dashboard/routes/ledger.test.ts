// src/dashboard/routes/ledger.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountLedgerRoutes } from './ledger.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'ledger-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const app = express();
  mountLedgerRoutes(app, { pool: createUserDbPool({ baseDir }) });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users/:uid/ledger/aggregate', () => {
  it('groups by stream', async () => {
    const db = createUserDb('alice', baseDir);
    const now = Date.now();
    db.ledger.append({ stream: 'a', payload: {}, ts: now });
    db.ledger.append({ stream: 'b', payload: {}, ts: now });
    db.ledger.append({ stream: 'a', payload: {}, ts: now });
    db.close();

    const r = await request(makeApp())
      .get('/api/users/alice/ledger/aggregate?range=30d');
    expect(r.status).toBe(200);
    const map = Object.fromEntries(r.body.series.map((s: { stream: string; n: number }) => [s.stream, s.n]));
    expect(map.a).toBe(2);
    expect(map.b).toBe(1);
  });

  it('rejects bad range', async () => {
    const db = createUserDb('alice', baseDir);
    db.close();
    const r = await request(makeApp())
      .get('/api/users/alice/ledger/aggregate?range=invalid');
    expect(r.status).toBe(400);
  });
});
