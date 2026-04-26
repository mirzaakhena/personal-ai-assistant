// src/dashboard/routes/users.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountUsersRoute } from './users.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'users-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeUser(uid: string) {
  const db = createUserDb(uid, baseDir);
  db.close();
}

function makeApp() {
  const pool = createUserDbPool({ baseDir });
  const app = express();
  mountUsersRoute(app, { pool });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users', () => {
  it('returns empty list when no users on disk', async () => {
    const r = await request(makeApp()).get('/api/users');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ users: [] });
  });

  it('returns each user on disk', async () => {
    makeUser('alice'); makeUser('bob');
    const r = await request(makeApp()).get('/api/users');
    expect(r.status).toBe(200);
    expect(r.body.users.map((u: { userId: string }) => u.userId).sort())
      .toEqual(['alice', 'bob']);
  });
});
