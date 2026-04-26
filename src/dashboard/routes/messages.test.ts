// src/dashboard/routes/messages.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { mountMessagesRoutes } from './messages.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'msg-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeApp() {
  const app = express();
  mountMessagesRoutes(app, { pool: createUserDbPool({ baseDir }) });
  app.use(errorMiddleware);
  return app;
}

function seed(uid: string) {
  const db = createUserDb(uid, baseDir);
  for (let i = 0; i < 3; i++) {
    db.messages.insert({
      id: `m${i}`, gateway: 'console', session_id: 'S1', sender: 'user',
      timestamp: 1000 + i, type: 'text',
      body: i === 1 ? 'I love coffee' : `n${i}`,
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null,
      quoted_msg_id: null, is_forwarded: 0, raw_json: null,
    });
  }
  db.close();
}

describe('messages routes', () => {
  it('search hits FTS', async () => {
    seed('alice');
    const r = await request(makeApp())
      .get('/api/users/alice/messages/search?q=coffee');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.hits[0].snippet).toContain('coffee');
  });

  it('search 400 when q missing', async () => {
    seed('alice');
    const r = await request(makeApp()).get('/api/users/alice/messages/search');
    expect(r.status).toBe(400);
  });

  it('thread returns all session messages', async () => {
    seed('alice');
    const r = await request(makeApp())
      .get('/api/users/alice/messages/thread/S1');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(3);
    expect(r.body.rows.length).toBe(3);
  });
});
