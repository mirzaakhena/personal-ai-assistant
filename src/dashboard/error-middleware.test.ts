// src/dashboard/error-middleware.test.ts

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorMiddleware } from './error-middleware.js';
import { BadQueryError } from './filter-builder.js';
import { DbBusyError, UserNotFoundError } from './userdb-pool.js';
import { SkillNotFoundError } from './skills-reader.js';

function makeApp(handler: express.RequestHandler) {
  const app = express();
  app.get('/x', handler);
  app.use(errorMiddleware);
  return app;
}

describe('errorMiddleware', () => {
  it('maps BadQueryError → 400 INVALID_QUERY', async () => {
    const app = makeApp((_req, _res, next) => next(new BadQueryError('bad', { k: 'v' })));
    const r = await request(app).get('/x');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_QUERY');
    expect(r.body.error.details).toEqual({ k: 'v' });
  });

  it('maps UserNotFoundError → 404 USER_NOT_FOUND', async () => {
    const app = makeApp((_req, _res, next) => next(new UserNotFoundError('alice')));
    const r = await request(app).get('/x');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('maps DbBusyError → 503 DB_BUSY', async () => {
    const app = makeApp((_req, _res, next) => next(new DbBusyError()));
    const r = await request(app).get('/x');
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('DB_BUSY');
  });

  it('maps unknown error → 500 INTERNAL', async () => {
    const app = makeApp((_req, _res, next) => next(new Error('boom')));
    const r = await request(app).get('/x');
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL');
  });

  it('maps SkillNotFoundError to 404 SKILL_NOT_FOUND', async () => {
    const app = makeApp((_req, _res, next) => next(new SkillNotFoundError('foo')));
    const r = await request(app).get('/x');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('SKILL_NOT_FOUND');
  });
});
