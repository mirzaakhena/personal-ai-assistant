// src/dashboard/auth.test.ts

import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createAuthMiddleware, mountAuthRoutes, COOKIE_NAME } from './auth.js';

function makeApp(token: string) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  mountAuthRoutes(app, { token, secureCookie: false });
  app.use('/api/protected', createAuthMiddleware({ token }));
  app.get('/api/protected/ping', (_req, res) => res.json({ pong: true }));
  return app;
}

describe('auth', () => {
  it('rejects request without cookie', async () => {
    const app = makeApp('s3cret');
    const r = await request(app).get('/api/protected/ping');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('login with wrong token → 401', async () => {
    const app = makeApp('s3cret');
    const r = await request(app).post('/api/auth').send({ token: 'wrong' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('login with correct token sets cookie and lets request through', async () => {
    const app = makeApp('s3cret');
    const agent = request.agent(app);
    const login = await agent.post('/api/auth').send({ token: 's3cret' });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ ok: true });
    const setCookie = login.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toMatch(new RegExp(`^${COOKIE_NAME}=`));
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);

    const ping = await agent.get('/api/protected/ping');
    expect(ping.status).toBe(200);
    expect(ping.body).toEqual({ pong: true });
  });

  it('logout clears cookie', async () => {
    const app = makeApp('s3cret');
    const agent = request.agent(app);
    await agent.post('/api/auth').send({ token: 's3cret' });
    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);
    const setCookie = out.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toMatch(new RegExp(`^${COOKIE_NAME}=;`));
    const ping = await agent.get('/api/protected/ping');
    expect(ping.status).toBe(401);
  });
});
