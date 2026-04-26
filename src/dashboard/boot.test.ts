// src/dashboard/boot.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createUserDb } from '../db/user-db.js';
import { createDashboardServer, type DashboardServer } from './boot.js';

let baseDir: string;
let server: DashboardServer | null = null;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'boot-'));
});
afterEach(async () => {
  if (server) await server.stop();
  server = null;
  rmSync(baseDir, { recursive: true, force: true });
});

describe('createDashboardServer', () => {
  it('returns null when token is empty (fail-soft)', () => {
    const s = createDashboardServer({
      port: 0, token: '', baseDir,
    });
    expect(s).toBeNull();
  });

  it('starts an Express app responding to /api/meta after auth', async () => {
    const db = createUserDb('alice', baseDir);
    db.close();

    server = createDashboardServer({
      port: 0, token: 's3cret', baseDir,
    })!;
    expect(server).not.toBeNull();
    const url = await server.start();
    const agent = request.agent(url);
    const login = await agent.post('/api/auth').send({ token: 's3cret' });
    expect(login.status).toBe(200);
    const meta = await agent.get('/api/meta');
    expect(meta.status).toBe(200);
    expect(Object.keys(meta.body.stores).length).toBe(11);
  });

  it('serves users + stores end-to-end', async () => {
    const db = createUserDb('alice', baseDir);
    db.knowledge.saveMany([{ category: 'person', key: 'k', value: 'v' }]);
    db.close();
    server = createDashboardServer({
      port: 0, token: 't', baseDir,
    })!;
    const url = await server.start();
    const agent = request.agent(url);
    await agent.post('/api/auth').send({ token: 't' });
    const users = await agent.get('/api/users');
    expect(users.body.users[0].userId).toBe('alice');
    const stores = await agent.get('/api/users/alice/stores');
    const k = stores.body.stores.find((s: { name: string }) => s.name === 'knowledge');
    expect(k.count).toBe(1);
  });

  it('rejects unauthenticated requests on /api/users', async () => {
    server = createDashboardServer({
      port: 0, token: 't', baseDir,
    })!;
    const url = await server.start();
    const r = await request(url).get('/api/users');
    expect(r.status).toBe(401);
  });

  it('healthz works without auth', async () => {
    server = createDashboardServer({
      port: 0, token: 't', baseDir,
    })!;
    const url = await server.start();
    const r = await request(url).get('/api/healthz');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });
});
